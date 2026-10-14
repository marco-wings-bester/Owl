// Run SQL against your own habit data, entirely on the phone, using SQLite (sql.js).
// A fresh in-memory database is built from the current data on every run,
// so queries can never change or delete your real habits.

let sqlReady = null;

function loadSqlJs() {
  sqlReady ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vendor/sql-wasm.js';
    script.onload = () => window.initSqlJs({ locateFile: f => `vendor/${f}` }).then(resolve, reject);
    script.onerror = () => reject(new Error('Could not load the SQL engine. Are you offline?'));
    document.head.appendChild(script);
  });
  return sqlReady;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EMOJI = { tick: '✅', avg: '😐', cross: '❌' };
const SCORE = { tick: 1, avg: 0.5, cross: 0 };

export const SCHEMA = `habit_list (
  habit_id  TEXT
  habit     TEXT
  type      TEXT     -- 'check', 'yesno', 'scale' (1–10), 'score' (0–100) or 'number'
  active    INTEGER  -- 1 = tracked, 0 = removed
)

sleep (    -- shortcut for the Sleep score habit
  date      TEXT     -- morning date; the score is for the night before
  weekday   TEXT
  score     INTEGER  -- 0–100
)

habits (
  date      TEXT  -- '2026-10-11'
  weekday   TEXT  -- 'Monday' … 'Sunday'
  habit     TEXT  -- 'No Sugar', 'Exercise', …
  habit_id  TEXT  -- 'sugar', 'exercise', …
  type      TEXT  -- 'check', 'yesno', 'scale', 'score' or 'number'
  status    TEXT  -- 'tick', 'avg' or 'cross' (tap types)
  emoji     TEXT  -- ✅ 😐 ❌ (tap types)
  score     REAL  -- 1, 0.5 or 0 (tap types)
  value     REAL  -- the number for scale/score/number types; 1, 0.5 or 0 otherwise
)`;

export const EXAMPLES = [
  { label: 'Everything', sql: 'SELECT date, habit, COALESCE(emoji, value) AS entry\nFROM habits\nORDER BY date DESC, habit;' },
  { label: 'Ticks per habit', sql: "SELECT habit, COUNT(*) AS ticks\nFROM habits\nWHERE status = 'tick'\nGROUP BY habit\nORDER BY ticks DESC;" },
  { label: 'Last 30 days', sql: "SELECT habit,\n  ROUND(100.0 * SUM(status = 'tick') / COUNT(*)) AS pct_done,\n  COUNT(*) AS days_logged\nFROM habits\nWHERE date >= date('now', 'localtime', '-30 days')\nGROUP BY habit;" },
  { label: 'Best weekday', sql: 'SELECT weekday, ROUND(AVG(score) * 100) AS score_pct\nFROM habits\nGROUP BY weekday\nORDER BY score_pct DESC;' },
  { label: 'Sleep by week', sql: "SELECT strftime('%Y-W%W', date) AS week,\n  ROUND(AVG(score)) AS avg_sleep, MIN(score) AS worst, MAX(score) AS best\nFROM sleep\nGROUP BY week\nORDER BY week DESC;" },
  { label: 'Sleep after habits', sql: "-- Average sleep the night after each habit was done vs not\nSELECT h.habit,\n  ROUND(AVG(CASE WHEN h.status = 'tick' THEN s.score END)) AS sleep_if_done,\n  ROUND(AVG(CASE WHEN h.status <> 'tick' THEN s.score END)) AS sleep_if_not\nFROM habits h\nJOIN sleep s ON s.date = date(h.date, '+1 day')\nWHERE h.status IS NOT NULL\nGROUP BY h.habit;" },
  { label: 'Perfect days', sql: "SELECT date\nFROM habits\nWHERE habit_id IN (SELECT habit_id FROM habit_list WHERE active = 1 AND type IN ('check', 'yesno'))\nGROUP BY date\nHAVING SUM(status = 'tick') = (SELECT COUNT(*) FROM habit_list WHERE active = 1 AND type IN ('check', 'yesno'))\nORDER BY date DESC;" },
];

// Returns { columns, rows } for the last statement that produced results.
export async function runQuery(sql, data, habits) {
  const SQL = await loadSqlJs();
  const db = new SQL.Database();
  try {
    db.run(`CREATE TABLE habits (date TEXT, weekday TEXT, habit TEXT, habit_id TEXT, type TEXT,
                                 status TEXT, emoji TEXT, score REAL, value REAL)`);
    db.run('CREATE TABLE habit_list (habit_id TEXT, habit TEXT, type TEXT, active INTEGER)');
    for (const h of habits) db.run('INSERT INTO habit_list VALUES (?, ?, ?, ?)', [h.id, h.name, h.type || 'check', h.archived ? 0 : 1]);
    db.run("CREATE VIEW sleep AS SELECT date, weekday, CAST(value AS INTEGER) AS score FROM habits WHERE habit_id = '_sleep'");
    const byId = Object.fromEntries(habits.map(h => [h.id, h]));
    const insert = db.prepare('INSERT INTO habits VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const [date, entries] of Object.entries(data)) {
      const [y, m, d] = date.split('-').map(Number);
      const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
      for (const [habitId, entry] of Object.entries(entries)) {
        const h = byId[habitId];
        const name = h?.name || (habitId === '_sleep' ? 'Sleep score' : habitId);
        if (typeof entry === 'number') {
          insert.run([date, weekday, name, habitId, h?.type || 'score', null, null, null, entry]);
        } else {
          const emoji = h?.emoji?.[entry] || EMOJI[entry] || '';
          insert.run([date, weekday, name, habitId, h?.type || 'check', entry, emoji, SCORE[entry] ?? null, SCORE[entry] ?? null]);
        }
      }
    }
    insert.free();

    const last = db.exec(sql).at(-1);
    return { columns: last?.columns || [], rows: last?.values || [] };
  } finally {
    db.close();
  }
}

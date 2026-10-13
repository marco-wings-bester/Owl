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

export const SCHEMA = `sleep (
  date      TEXT     -- morning date; the score is for the night before
  weekday   TEXT
  score     INTEGER  -- 0–100
)

habit_list (
  habit_id  TEXT
  habit     TEXT
  active    INTEGER  -- 1 = tracked, 0 = removed
)

habits (
  date      TEXT  -- '2026-10-11'
  weekday   TEXT  -- 'Monday' … 'Sunday'
  habit     TEXT  -- 'No Sugar', 'Exercise', …
  habit_id  TEXT  -- 'sugar', 'exercise', …
  status    TEXT  -- 'tick', 'avg' or 'cross'
  emoji     TEXT  -- ✅ 😐 ❌
  score     REAL  -- 1, 0.5 or 0
)`;

export const EXAMPLES = [
  { label: 'Everything', sql: 'SELECT date, habit, emoji\nFROM habits\nORDER BY date DESC, habit;' },
  { label: 'Ticks per habit', sql: "SELECT habit, COUNT(*) AS ticks\nFROM habits\nWHERE status = 'tick'\nGROUP BY habit\nORDER BY ticks DESC;" },
  { label: 'Last 30 days', sql: "SELECT habit,\n  ROUND(100.0 * SUM(status = 'tick') / COUNT(*)) AS pct_done,\n  COUNT(*) AS days_logged\nFROM habits\nWHERE date >= date('now', 'localtime', '-30 days')\nGROUP BY habit;" },
  { label: 'Best weekday', sql: 'SELECT weekday, ROUND(AVG(score) * 100) AS score_pct\nFROM habits\nGROUP BY weekday\nORDER BY score_pct DESC;' },
  { label: 'Sleep by week', sql: "SELECT strftime('%Y-W%W', date) AS week,\n  ROUND(AVG(score)) AS avg_sleep, MIN(score) AS worst, MAX(score) AS best\nFROM sleep\nGROUP BY week\nORDER BY week DESC;" },
  { label: 'Sleep after habits', sql: "-- Average sleep the night after each habit was done vs not\nSELECT h.habit,\n  ROUND(AVG(CASE WHEN h.status = 'tick' THEN s.score END)) AS sleep_if_done,\n  ROUND(AVG(CASE WHEN h.status <> 'tick' THEN s.score END)) AS sleep_if_not\nFROM habits h\nJOIN sleep s ON s.date = date(h.date, '+1 day')\nGROUP BY h.habit;" },
  { label: 'Perfect days', sql: "SELECT date\nFROM habits\nWHERE habit_id IN (SELECT habit_id FROM habit_list WHERE active = 1)\nGROUP BY date\nHAVING SUM(status = 'tick') = (SELECT COUNT(*) FROM habit_list WHERE active = 1)\nORDER BY date DESC;" },
];

// Returns { columns, rows } for the last statement that produced results.
export async function runQuery(sql, data, habits) {
  const SQL = await loadSqlJs();
  const db = new SQL.Database();
  try {
    db.run(`CREATE TABLE habits (date TEXT, weekday TEXT, habit TEXT, habit_id TEXT,
                                 status TEXT, emoji TEXT, score REAL)`);
    db.run('CREATE TABLE habit_list (habit_id TEXT, habit TEXT, active INTEGER)');
    for (const h of habits) db.run('INSERT INTO habit_list VALUES (?, ?, ?)', [h.id, h.name, h.archived ? 0 : 1]);
    const names = Object.fromEntries(habits.map(h => [h.id, h.name]));
    db.run('CREATE TABLE sleep (date TEXT, weekday TEXT, score INTEGER)');
    const insert = db.prepare('INSERT INTO habits VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const [date, entries] of Object.entries(data)) {
      const [y, m, d] = date.split('-').map(Number);
      const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
      for (const [habitId, status] of Object.entries(entries)) {
        if (habitId === '_sleep') {
          db.run('INSERT INTO sleep VALUES (?, ?, ?)', [date, weekday, status]);
          continue;
        }
        insert.run([date, weekday, names[habitId] || habitId, habitId, status, EMOJI[status] || '', SCORE[status] ?? null]);
      }
    }
    insert.free();

    const last = db.exec(sql).at(-1);
    return { columns: last?.columns || [], rows: last?.values || [] };
  } finally {
    db.close();
  }
}

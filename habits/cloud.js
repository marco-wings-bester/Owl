// Optional Google sign-in and cloud sync using Firebase.
// Each user's data is one Firestore document:
//   users/{uid} = { days: { "2026-10-11": { sugar: "tick" } }, habits: [{ id: "sugar", name: "No Sugar" }] }
// The phone's local copy is still kept, so the app works offline and without signing in.
import { firebaseConfig } from './firebase-config.js?v=18';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

export async function startCloud({ getData, setData, getHabits, setHabits }) {
  if (!firebaseConfig) return null;

  let initializeApp, auth, fs;
  try {
    [{ initializeApp }, auth, fs] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-firestore.js`),
    ]);
  } catch {
    return null; // offline or blocked: the app keeps working with on-phone data only
  }

  const app = initializeApp(firebaseConfig);
  const authInstance = auth.getAuth(app);
  const db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache() });

  const box = document.getElementById('account');
  const status = document.getElementById('account-status');
  const btn = document.getElementById('account-btn');
  box.style.display = 'flex';

  const warning = document.getElementById('sync-warning');
  let docRef = null;
  let unsubscribe = null;

  // Sync problems are shown in Settings and on the main screen, so they're never silent.
  function reportError(err) {
    const message = `⚠️ Sync error: ${err.code || err.message}`;
    status.textContent = message;
    warning.textContent = `${message} · your taps are saved on this phone`;
    warning.hidden = false;
  }
  function clearError(user) {
    warning.hidden = true;
    if (user) status.textContent = `☁️ Synced · ${user.email}`;
  }

  // Taps made before the first sync finishes are uploaded once it's done.
  const pending = new Map();
  let habitsPending = false;
  function upload(day, habitId, value) {
    const path = new fs.FieldPath('days', day, habitId);
    const empty = value === '' || value == null; // note: a sleep score of 0 is a real value
    return fs.updateDoc(docRef, path, empty ? fs.deleteField() : value);
  }

  // Google One Tap: a small "Continue as …" sheet instead of a full-page sign-in.
  // Falls back to the regular popup if One Tap isn't set up, can't load, or Google skips it.
  const oneTap = await loadOneTap(firebaseConfig.googleClientId, async idToken => {
    try {
      await auth.signInWithCredential(authInstance, auth.GoogleAuthProvider.credential(idToken));
    } catch (err) {
      showSignedOut(`Sign-in failed: ${err.code || err.message}`);
    }
  });

  let oneTapSkipped = false;

  async function signInWithPopup() {
    try {
      await auth.signInWithPopup(authInstance, new auth.GoogleAuthProvider());
    } catch (err) {
      if (err.code === 'auth/popup-blocked') showSignedOut('Tap “Sign in with Google” again');
      else if (err.code !== 'auth/popup-closed-by-user') showSignedOut(`Sign-in failed: ${err.code || err.message}`);
    }
  }

  function signIn() {
    if (!oneTap || oneTapSkipped) return signInWithPopup();
    oneTap.prompt(notification => {
      if (notification.isSkippedMoment()) {
        // Google chose not to show One Tap (e.g. recently dismissed): use the popup from now on.
        oneTapSkipped = true;
        signInWithPopup();
      }
    });
  }

  function showSignedOut(message) {
    status.textContent = message || 'Sign in to back up and sync';
    btn.textContent = 'Sign in with Google';
    btn.className = '';
    btn.onclick = signIn;
  }

  function showSignedIn(user) {
    status.textContent = `☁️ Synced · ${user.email}`;
    btn.textContent = 'Sign out';
    btn.className = 'secondary';
    btn.onclick = () => {
      oneTap?.disableAutoSelect(); // so One Tap doesn't sign you straight back in
      auth.signOut(authInstance);
    };
  }

  auth.onAuthStateChanged(authInstance, async user => {
    unsubscribe?.();
    unsubscribe = null;
    docRef = null;
    if (!user) {
      showSignedOut();
      oneTap?.prompt(); // offer "Continue as …" straight away; Google rate-limits this if dismissed
      return;
    }

    showSignedIn(user);
    const ref = fs.doc(db, 'users', user.uid);
    try {
      // First sync on this device: combine what's in the cloud with what's on the phone.
      // Where both have a value for the same day and habit, the phone's value wins.
      const snap = await fs.getDoc(ref);
      const merged = structuredClone(snap.data()?.days || {});
      for (const [day, habits] of Object.entries(getData())) {
        merged[day] = { ...merged[day], ...habits };
      }
      // Habit list: the cloud's wins if it has one (e.g. set up on another phone), otherwise upload this phone's.
      // (getHabits/setHabits are optional so an older cached page can't break syncing.)
      const cloudHabits = snap.data()?.habits;
      const habits = cloudHabits && !habitsPending ? cloudHabits : getHabits?.() || cloudHabits;
      await fs.setDoc(ref, habits ? { days: merged, habits } : { days: merged });
      if (habits) setHabits?.(habits);
      docRef = ref;
      for (const [cell, value] of pending) upload(...cell.split('|'), value).catch(reportError);
      pending.clear();
      habitsPending = false;
      clearError(user);

      // From now on the cloud copy is the source of truth; changes from other devices show up live.
      unsubscribe = fs.onSnapshot(ref, s => {
        setData(s.data()?.days || {});
        if (s.data()?.habits) setHabits?.(s.data().habits);
      }, reportError);
    } catch (err) {
      reportError(err);
    }
  });

  return {
    saveHabits(habits) {
      if (!authInstance.currentUser) return;
      if (!docRef) {
        habitsPending = true;
        return;
      }
      fs.updateDoc(docRef, { habits }).then(() => clearError(authInstance.currentUser), reportError);
    },

    saveCell(day, habitId, value) {
      if (!authInstance.currentUser) return;
      if (!docRef) {
        pending.set(`${day}|${habitId}`, value);
        return;
      }
      try {
        upload(day, habitId, value).then(() => clearError(authInstance.currentUser), reportError);
      } catch (err) {
        reportError(err);
      }
    },
  };
}

// Loads Google Identity Services and returns its One Tap API, or null if unavailable.
async function loadOneTap(clientId, onIdToken) {
  if (!clientId) return null;
  try {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  } catch {
    return null;
  }
  const id = window.google.accounts.id;
  id.initialize({
    client_id: clientId,
    callback: response => onIdToken(response.credential),
    auto_select: true, // returning users are signed in without a tap
    cancel_on_tap_outside: true,
    use_fedcm_for_prompt: true, // Chrome's native account sheet
    context: 'signin',
  });
  return id;
}

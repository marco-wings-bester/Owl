// Optional Google sign-in and cloud sync using Firebase.
// Each user's habits are stored in one Firestore document: users/{uid} = { days: { "2026-10-11": { sugar: "tick" } } }
// The phone's local copy is still kept, so the app works offline and without signing in.
import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

export async function startCloud({ getData, setData }) {
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

  let docRef = null;
  let unsubscribe = null;

  function showSignedOut(message) {
    status.textContent = message || 'Sign in to back up and sync';
    btn.textContent = 'Sign in with Google';
    btn.className = '';
    btn.onclick = async () => {
      try {
        await auth.signInWithPopup(authInstance, new auth.GoogleAuthProvider());
      } catch (err) {
        if (err.code !== 'auth/popup-closed-by-user') showSignedOut(`Sign-in failed: ${err.code || err.message}`);
      }
    };
  }

  function showSignedIn(user) {
    status.textContent = `☁️ Synced · ${user.email}`;
    btn.textContent = 'Sign out';
    btn.className = 'secondary';
    btn.onclick = () => auth.signOut(authInstance);
  }

  auth.onAuthStateChanged(authInstance, async user => {
    unsubscribe?.();
    unsubscribe = null;
    docRef = null;
    if (!user) return showSignedOut();

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
      await fs.setDoc(ref, { days: merged });
      docRef = ref;

      // From now on the cloud copy is the source of truth; changes from other devices show up live.
      unsubscribe = fs.onSnapshot(ref, s => setData(s.data()?.days || {}));
    } catch (err) {
      status.textContent = `⚠️ Sync error: ${err.code || err.message}`;
    }
  });

  return {
    saveCell(day, habitId, value) {
      if (!docRef) return;
      const path = new fs.FieldPath('days', day, habitId);
      fs.updateDoc(docRef, path, value || fs.deleteField()).catch(err => {
        status.textContent = `⚠️ Sync error: ${err.code || err.message}`;
      });
    },
  };
}

// Firebase web app config (Firebase console → Project settings → Your apps).
// This is not secret: access to data is controlled by the Firestore security rules.
// Set it to null to run the app without accounts or cloud sync.
export const firebaseConfig = {
  apiKey: 'AIzaSyAY-B_DheJtF8BDEkgUzTBNQrF_6BUd89o',
  authDomain: 'habits-fa3a8.firebaseapp.com',
  projectId: 'habits-fa3a8',
  storageBucket: 'habits-fa3a8.firebasestorage.app',
  messagingSenderId: '275085881186',
  appId: '1:275085881186:web:ffba8127a8f23a3f37063b',
  // Web client ID for Google One Tap (Firebase → Authentication → Sign-in method → Google →
  // Web SDK configuration). Leave null to use the regular full-page Google sign-in.
  googleClientId: null,
};

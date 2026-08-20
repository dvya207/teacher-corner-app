/**
 * Firebase web config for this app.
 *
 * These values are NOT secrets. The Firebase web config is compiled into the
 * client bundle by design and is readable by anyone who loads the app. Access
 * control comes from Firebase Auth and the rules in firestore.rules, never
 * from keeping this object private.
 */
export const environment = {
  production: false,
  firebase: {
    apiKey: 'AIzaSyC0nuQihB_HdmNtJPKF-CQPL1aaLRTvwj0',
    authDomain: 'helix-staging-india.firebaseapp.com',
    projectId: 'helix-staging-india',
    storageBucket: 'helix-staging-india.firebasestorage.app',
    messagingSenderId: '446667097540',
    appId: '1:446667097540:web:87a6261d275508808bd091'
  }
};

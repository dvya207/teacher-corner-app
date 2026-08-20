import { FirebaseApp, initializeApp } from 'firebase/app';
import { Auth, getAuth } from 'firebase/auth';
import { Firestore, getFirestore } from 'firebase/firestore';

import { environment } from '../../environments/environment';

const PLACEHOLDER = 'PENDING_FIREBASE_CLI_LOGIN';

/**
 * True once environment.ts holds a real config. Kept after the config landed
 * because the login page still reads it, and a future contributor cloning this
 * repo into a different project will hit the placeholder path again.
 */
export const firebaseConfigured = !Object.values(environment.firebase).includes(PLACEHOLDER);

if (!firebaseConfigured) {
  console.error(
    'TeacherCorner: src/environments/environment.ts still contains placeholder ' +
      'Firebase values. Run "firebase apps:sdkconfig WEB <appId> --project ' +
      '<project-id>" and paste the real config in before signing in.'
  );
}

export const firebaseApp: FirebaseApp = initializeApp(environment.firebase);
export const auth: Auth = getAuth(firebaseApp);

/**
 * Teacher Corner's OWN Firestore database.
 *
 * The project holds several databases. This app owns 'teacher-corner-dev'
 * and shares it with nobody.
 *
 * WHY A SEPARATE DATABASE, having previously shared one.
 *
 * Firestore SECURITY RULES ARE PER-DATABASE, and a deploy REPLACES the whole
 * ruleset rather than merging into it. Sharing a database therefore meant one
 * rules file serving two apps in two repositories: this app could only be
 * granted access by editing and redeploying the other app's rules, and either repo
 * deploying could silently revoke the other's access. Isolation had to be
 * maintained by discipline — namespaced collections, a client-side path guard,
 * a test that failed the build if anything reached across.
 *
 * A separate database replaces all of that with a boundary the platform
 * enforces. `firebase deploy --only firestore:teacher-corner-dev` cannot reach
 * BugPulse's rules or data, and BugPulse's deploys cannot reach this app's.
 * No namespacing is required for correctness any more, and no amount of
 * client-side carelessness can cross the line.
 *
 * The '-dev' suffix is deliberate: this is a development database. A production
 * one would be provisioned separately rather than by promoting this.
 *
 * Dropping the second argument below would silently point the app at (default),
 * where four other apps live and nothing grants this app access.
 */
export const FIRESTORE_DATABASE_ID = 'teacher-corner-dev';

export const db: Firestore = getFirestore(firebaseApp, FIRESTORE_DATABASE_ID);

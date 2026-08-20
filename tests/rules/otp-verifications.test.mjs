/**
 * Firestore rule tests for OTPVerifications.
 *
 * This collection is the login challenge store: `salt`, `hashedOtp`, and the
 * send counters. It is server-owned, written and read only by tcDevSendOtp and
 * tcDevVerifyOtp through the Admin SDK, which bypasses rules.
 *
 * WHY THIS SUITE EXISTS SEPARATELY. Every other assertion in this repo checks
 * that a user reaches their own data and not another user's. Here there is no
 * owner: the correct answer for EVERY client is no. A read hands an attacker
 * salt + hash to brute-force a six-digit code offline; a write lets them store
 * the hash of a code they picked and take over any phone number without its
 * owner doing anything. So the second-user pattern is replaced by a
 * no-user-at-all pattern, and authenticated access is asserted denied too.
 *
 * Nothing is deployed by running these.
 */

import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc
} from 'firebase/firestore';

const ALICE = 'alice-uid';

/** The document key the functions use: one per normalized phone number. */
const CHALLENGE = 'OTPVerifications/+919999999999';

/** Shaped like the real thing, so a rule that inspected fields would still be tested. */
const challenge = () => ({
  hashedOtp: 'a'.repeat(64),
  salt: 'b'.repeat(32),
  attempts: 0,
  maxAttempts: 5,
  requestCount: 1
});

let testEnv;
let alice;
let anon;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'teacher-corner-otp-rules-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080
    }
  });

  alice = testEnv.authenticatedContext(ALICE).firestore();
  anon = testEnv.unauthenticatedContext().firestore();
});

after(async () => {
  await testEnv?.cleanup();
});

describe('OTPVerifications is closed to every client', () => {

  /**
   * Seeded with rules disabled, the way the Admin SDK writes it. Without this the
   * read tests would pass for the wrong reason: a missing document is denied too,
   * so the assertion would hold even if the rule were wide open.
   */
  before(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), CHALLENGE), challenge());
    });
  });

  it('denies an anonymous read of the salt and hash', async () => {
    await assertFails(getDoc(doc(anon, CHALLENGE)));
  });

  /** The one that matters: every signed-in teacher would otherwise be able to
   *  take over any other account. */
  it('denies an AUTHENTICATED read of the salt and hash', async () => {
    await assertFails(getDoc(doc(alice, CHALLENGE)));
  });

  it('denies an anonymous write of a chosen hash', async () => {
    await assertFails(setDoc(doc(anon, CHALLENGE), challenge()));
  });

  it('denies an AUTHENTICATED write of a chosen hash', async () => {
    await assertFails(setDoc(doc(alice, CHALLENGE), challenge()));
  });

  /** Resetting attempts would restore a brute-force budget on a live challenge. */
  it('denies an authenticated client resetting the attempt counter', async () => {
    await assertFails(updateDoc(doc(alice, CHALLENGE), { attempts: 0 }));
  });

  /** Deleting would clear the send counters and with them the rate limit. */
  it('denies an authenticated client deleting a challenge', async () => {
    await assertFails(deleteDoc(doc(alice, CHALLENGE)));
  });

  it('denies writing a challenge for a phone number that has none', async () => {
    await assertFails(
      setDoc(doc(alice, 'OTPVerifications/+918888888888'), challenge())
    );
  });
});

describe('Configuration is readable by any signed-in user and writable by none', () => {

  before(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'Configuration/GradeList'), {
        docId: 'GradeList',
        grades: ['1', '2', '3']
      });
    });
  });

  it('lets a signed-in teacher read an option list', async () => {
    await assertSucceeds(getDoc(doc(alice, 'Configuration/GradeList')));
  });

  /** Every form needs the whole collection, so the unfiltered list must be allowed. */
  it('lets a signed-in teacher list the collection', async () => {
    await assertSucceeds(getDocs(collection(alice, 'Configuration')));
  });

  it('denies an anonymous read', async () => {
    await assertFails(getDoc(doc(anon, 'Configuration/GradeList')));
  });

  /**
   * The one that matters. A client write here changes what EVERY teacher can select,
   * and an empty array would blank a dropdown for all of them.
   */
  it('denies an authenticated client editing an option list', async () => {
    await assertFails(
      updateDoc(doc(alice, 'Configuration/GradeList'), { grades: ['only-mine'] })
    );
    await assertFails(setDoc(doc(alice, 'Configuration/GradeList'), { grades: [] }));
    await assertFails(deleteDoc(doc(alice, 'Configuration/GradeList')));
  });

  it('denies an authenticated client adding a new option list', async () => {
    await assertFails(setDoc(doc(alice, 'Configuration/Invented'), { values: ['x'] }));
  });
});

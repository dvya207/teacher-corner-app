import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { DocumentReference, FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

import { EXOTEL_SENDER, sendOtpSms } from './exotel';
import {
  MAX_OTP_REQUESTS_PER_WINDOW,
  MAX_VERIFICATION_ATTEMPTS,
  OTP_EXPIRY_SECONDS,
  RATE_LIMIT_WINDOW_SECONDS,
  buildOtpSms,
  generateSalt,
  generateSecureOtp,
  hashOtp,
  normalizePhone,
  parseTestPhones,
  safePlatformName,
  timingSafeCompare
} from './otp';

/**
 * Phone-OTP sign-in for Teacher Corner Dev.
 *
 * Implemented from the Exotel OTP guide. Gen2 onCall,
 * asia-south1, credentials from Secret Manager, code generated hashed and
 * verified entirely server-side.
 *
 * THREE DELIBERATE DEPARTURES FROM THE GUIDE, all for isolation on a project
 * that hosts more than one application.
 *
 *   1. NAMES. The guide exports `sendOtp` / `verifyOtp`. Those are generic
 *      enough that another app in this project could want them, and function
 *      names are per-project. Prefixed here so nothing can collide and so the
 *      owner of any function in the console is obvious.
 *
 *   2. DATABASE. The guide uses admin.firestore(), which is the (default)
 *      database — shared with four other apps, and whose rules a deploy from
 *      this repo must never replace. This app owns the NAMED
 *      'teacher-corner-dev' database outright, so OTPVerifications lives there
 *      and the rules deploy is scoped to it.
 *
 *   3. RATE-LIMIT PERSISTENCE. See the comment on clearChallenge below. The
 *      guide deletes the whole document on expiry, on attempt-exhaustion and on
 *      success, which also discards requestCount and windowStart and so resets
 *      the send cap. Preserved here instead.
 *
 * Everything else — the DLT values, the template body, the constants, the
 * document shape, the field names, the error codes — is the guide's, unchanged.
 */

initializeApp();

/**
 * NOT (default). Omitting the id here would write OTP challenges into the
 * database four other apps share, and would put this app's collection under a
 * ruleset this repo has no business deploying.
 */
const DATABASE_ID = 'teacher-corner-dev';

/** Guide's collection name and document key: one doc per normalized phone. */
const COLLECTION = 'OTPVerifications';

const db = getFirestore(DATABASE_ID);

// Declared so a deploy fails loudly if either is missing, rather than the
// function starting and reading an empty credential.
const EXOTEL_AUTH_KEY = defineSecret('EXOTEL_AUTH_KEY');
const EXOTEL_AUTH_TOKEN = defineSecret('EXOTEL_AUTH_TOKEN');

const REGION = 'asia-south1';

interface Challenge {
  hashedOtp: string;
  salt: string;
  expiresAt: Timestamp;
  attempts: number;
  maxAttempts: number;
  createdAt: Timestamp;
  requestCount: number;
  windowStart: Timestamp;
}

/**
 * Retires a challenge without forgetting how many sends the number has had.
 *
 * THE ONE SECURITY DEVIATION FROM THE GUIDE, and the reason for it: the guide
 * calls otpRef.delete() on expiry, on attempt-exhaustion and on success. That
 * document is also where requestCount and windowStart live, so deleting it
 * resets the 3-per-10-minutes send cap.
 *
 * On the success path that is harmless — reaching it required a valid code. On
 * the attempt-exhaustion path it is a bypass: submit five wrong codes, the
 * document is deleted, the cap is clear, request three more, repeat. The cap is
 * the only thing standing between this endpoint and an unbounded bill on an
 * Exotel account whose credentials cannot be rotated, so it is not left
 * resettable by an unauthenticated caller.
 *
 * The challenge material is cleared, which is what deletion was for. Revert to
 * a plain delete() if the guide's exact behaviour is required.
 */
async function clearChallenge(ref: DocumentReference): Promise<void> {
  await ref.update({
    hashedOtp: FieldValue.delete(),
    salt: FieldValue.delete(),
    expiresAt: FieldValue.delete(),
    attempts: FieldValue.delete(),
    maxAttempts: FieldValue.delete(),
    consumedAt: Timestamp.now()
  });
}

// ===========================================================================
// tcDevSendOtp
// ===========================================================================

export const tcDevSendOtp = onCall(
  {
    region: REGION,
    // REQUIRED. A provisioned secret is not in process.env until it is bound to
    // the function; without this the credential reads '' and Exotel answers 401
    // with no SMS and nothing obviously wrong.
    secrets: [EXOTEL_AUTH_KEY, EXOTEL_AUTH_TOKEN]
  },
  async request => {
    const { phone } = (request.data ?? {}) as { phone?: string };

    if (!phone || typeof phone !== 'string') {
      throw new HttpsError('invalid-argument', 'Phone number is required.');
    }

    const platformName = safePlatformName((request.data as { platformName?: unknown })?.platformName);
    const normalizedPhone = normalizePhone(phone);
    const ref = db.collection(COLLECTION).doc(normalizedPhone);
    const now = Timestamp.now();

    // ---- Rate limit: 3 sends per phone per rolling 10 minutes ----
    const snapshot = await ref.get();
    const existing = snapshot.exists ? (snapshot.data() as Partial<Challenge>) : undefined;

    let requestCount = 1;
    let windowStart = now;

    if (existing?.windowStart) {
      const elapsedSeconds = (now.toMillis() - existing.windowStart.toMillis()) / 1000;

      if (elapsedSeconds < RATE_LIMIT_WINDOW_SECONDS) {
        if ((existing.requestCount ?? 0) >= MAX_OTP_REQUESTS_PER_WINDOW) {
          throw new HttpsError(
            'resource-exhausted',
            'Too many OTP requests. Please try again in a few minutes.'
          );
        }

        requestCount = (existing.requestCount ?? 0) + 1;
        windowStart = existing.windowStart;
      }
      // Window elapsed: fall through, which restarts it at 1 send from now.
    }

    // ---- Generate, hash, store. The plaintext code is never persisted. ----
    const otp = generateSecureOtp();
    const salt = generateSalt();

    await ref.set({
      hashedOtp: hashOtp(otp, salt),
      salt,
      expiresAt: Timestamp.fromMillis(now.toMillis() + OTP_EXPIRY_SECONDS * 1000),
      attempts: 0,
      maxAttempts: MAX_VERIFICATION_ATTEMPTS,
      createdAt: now,
      requestCount,
      windowStart
    });

    // ---- Log the code and skip the send, when it would be wrong to send ----
    //
    // Two cases, and the emulator one is not in the guide.
    //
    // TEST_PHONES is the guide's allowlist. It is the only safe way to exercise a
    // DEPLOYED function, because these credentials reach real handsets and bill a
    // production account with no sandbox.
    //
    // FUNCTIONS_EMULATOR covers every number when running locally. The emulator
    // has no business calling Exotel at all: the credentials it holds are the
    // placeholders in .secret.local, so a send can only ever 401, and the failure
    // reads as "the code could not be sent" rather than "you are running locally
    // and this number is not in TEST_PHONES". Worse, if someone runs the emulator
    // WITHOUT .secret.local, firebase-tools fetches the real credentials and a
    // local test would fire a real, billed SMS. Skipping the send locally removes
    // both. Set by the Functions emulator itself and never present in production.
    const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

    if (isEmulator || parseTestPhones(process.env.TEST_PHONES).has(normalizedPhone)) {
      logger.info(`[TEST-OTP] phone=${normalizedPhone} otp=${otp}`);
      return { success: true, expiresInSeconds: OTP_EXPIRY_SECONDS };
    }

    try {
      await sendOtpSms(
        normalizedPhone,
        buildOtpSms(otp, platformName),
        // Read INSIDE the handler. At module scope these are not yet populated
        // and would resolve to empty strings.
        EXOTEL_AUTH_KEY.value(),
        EXOTEL_AUTH_TOKEN.value()
      );
    } catch (error) {
      logger.error('OTP send failed', { to: normalizedPhone, sender: EXOTEL_SENDER });
      throw new HttpsError('internal', 'Failed to send SMS. Please try again.');
    }

    // The code is never returned to the caller.
    return { success: true, expiresInSeconds: OTP_EXPIRY_SECONDS };
  }
);

// ===========================================================================
// tcDevVerifyOtp
// ===========================================================================

export const tcDevVerifyOtp = onCall(
  // No Exotel secrets: nothing here sends anything.
  { region: REGION },
  async request => {
    const { phone, otp } = (request.data ?? {}) as { phone?: string; otp?: string };

    if (!phone || !otp) {
      throw new HttpsError('invalid-argument', 'Phone number and OTP are required.');
    }

    const normalizedPhone = normalizePhone(phone);
    const ref = db.collection(COLLECTION).doc(normalizedPhone);
    const snapshot = await ref.get();
    const challenge = snapshot.exists ? (snapshot.data() as Partial<Challenge>) : undefined;

    if (!challenge?.hashedOtp || !challenge.salt || !challenge.expiresAt) {
      throw new HttpsError('not-found', 'No OTP found. Please request a new one.');
    }

    if (Timestamp.now().toMillis() > challenge.expiresAt.toMillis()) {
      await clearChallenge(ref);
      throw new HttpsError('deadline-exceeded', 'OTP has expired. Please request a new one.');
    }

    const attempts = challenge.attempts ?? 0;
    const maxAttempts = challenge.maxAttempts ?? MAX_VERIFICATION_ATTEMPTS;

    // A six-digit code is a million possibilities, which a script walks in
    // minutes if nothing counts the failures.
    if (attempts >= maxAttempts) {
      await clearChallenge(ref);
      throw new HttpsError('resource-exhausted', 'Too many failed attempts. Request a new OTP.');
    }

    if (!timingSafeCompare(hashOtp(String(otp), challenge.salt), challenge.hashedOtp)) {
      await ref.update({ attempts: FieldValue.increment(1) });
      const remaining = maxAttempts - attempts - 1;
      throw new HttpsError('permission-denied', `Invalid OTP. ${remaining} attempt(s) remaining.`);
    }

    // ---- Correct. Mint the session. ----
    //
    // The guide stops at { success: true } and leaves "mint a custom token" as
    // the caller's business. A login flow needs the token, so it is minted here.
    //
    // TWO PREREQUISITES, neither of which this code can satisfy on its own:
    //   - the runtime service account needs roles/iam.serviceAccountTokenCreator
    //     on itself, or createCustomToken fails with a permission error;
    //   - createUser fires this project's EXISTING beforeCreate blocking Auth
    //     trigger, sendWelcomeEmail, which belongs to another app. Whether it
    //     tolerates a user with no email address is unverified.
    const token = await mintToken(normalizedPhone);

    // Cleared only AFTER the token exists, so a failure above does not strand
    // the user having spent a valid code.
    await clearChallenge(ref);

    return { success: true, token };
  }
);

/**
 * Finds or creates the Auth user for a phone number and mints a custom token.
 *
 * Keyed on the phone number: getUserByPhoneNumber first, so a returning teacher
 * keeps their uid and everything stored under it. Creating first and catching
 * the already-exists error would work too, but it fires the project's
 * beforeCreate trigger on every sign-in rather than only on registration.
 */
async function mintToken(phoneNumber: string): Promise<string> {
  const auth = getAuth();

  let uid: string;

  try {
    uid = (await auth.getUserByPhoneNumber(phoneNumber)).uid;
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') {
      throw error;
    }

    try {
      uid = (await auth.createUser({ phoneNumber })).uid;
    } catch (createError) {
      logger.error('Could not create the Auth user for a verified phone number', {
        code: (createError as { code?: string }).code
      });
      throw new HttpsError('internal', 'Verified, but the account could not be created.');
    }
  }

  try {
    return await auth.createCustomToken(uid);
  } catch (error) {
    logger.error('createCustomToken failed. Check serviceAccountTokenCreator on the runtime SA.', {
      code: (error as { code?: string }).code
    });
    throw new HttpsError('internal', 'Verified, but the login token could not be issued.');
  }
}

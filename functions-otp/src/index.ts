import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { DocumentReference, FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

import { EXOTEL_SENDER, sendOtpSms } from './exotel';
import {
  AUDIT_COLLECTION,
  MAX_PASSCODE_ATTEMPTS,
  PASSCODE_WINDOW_SECONDS,
  datePassword,
  timingSafeEqual,
  toE164
} from './impersonation';
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

/* ==========================================================================
   Impersonation — signing in AS a teacher, for support
   ========================================================================== */

/**
 * Mints a session for another user's account, from a mobile number and today's
 * date.
 *
 * NO CALLER AUTHENTICATION. This is the app owner's stated requirement and it is
 * worth being blunt about at the top of the function rather than burying it: the
 * endpoint can be called by anyone who knows its URL. Two things gate it, and
 * that is all — the passcode, and the number already existing in `users` or
 * `teachers`. See the note inside on section 1.
 *
 * HOW IT STILL DIFFERS FROM PRODUCTION, which is now a shorter list than it was:
 *
 *   1. The PASSCODE IS CHECKED HERE, against the server's own clock. Production
 *      compares it in the browser (`if (this.password != this.getPassword())`),
 *      in a bundle anyone can read, in front of an endpoint that does not check
 *      it at all — so production's can be skipped entirely and this one cannot.
 *
 *   2. Wrong passcodes are THROTTLED, per target number.
 *
 *   3. The number must be in this app's own data. Production's mints a token for
 *      any number it is given.
 *
 *   4. Every attempt is AUDITED, allowed or refused, with the caller's IP, before
 *      the token exists. Production records nothing.
 *
 * The minted token carries `impersonated` / `impersonatedBy` claims, so a rule or
 * a later function can tell a borrowed session apart from the user's own.
 */
export const tcDevImpersonate = onCall(
  { region: REGION },
  async request => {
    const auth = getAuth();

    /* ---- 1. Arguments ------------------------------------------------------
     *
     * THERE IS NO CALLER CHECK. Not a session, not a claim, not an allowlist.
     * The app owner's decision, in their words: "just that number should already
     * be there in users or teachers collection, no needed of loged in another tab
     * of this webiste".
     *
     * So the whole gate is today's passcode plus the number existing in this app's
     * own data. That is production's own posture for this page, and it means
     * anyone who knows this endpoint's URL can obtain a working session for any
     * teacher in the database, since the date is derivable from a calendar. It was
     * raised twice and confirmed twice; this comment is the record, not an
     * argument.
     *
     * WHAT IS LEFT, precisely:
     *   - the passcode must be right, and wrong guesses are throttled per number
     *   - the number must already be in `users` or `teachers`; no account is
     *     conjured for an arbitrary number
     *   - an account holding the `admin: true` claim cannot be impersonated
     *   - every attempt is audited WITH THE CALLER'S IP, which is now the only
     *     identifying information that exists about who did it
     */
    const { countryCode, phoneNumber, password } = (request.data ?? {}) as {
      countryCode?: string;
      phoneNumber?: string;
      password?: string;
    };

    const target = toE164(countryCode ?? '+91', phoneNumber ?? '');

    /*
     * A session is no longer required, but it is still RECORDED when one happens
     * to be present — the page can be used either way, and knowing which is the
     * difference between an audit entry naming a person and one naming an address.
     */
    const callerUid = request.auth?.uid ?? null;
    const callerEmail = String(request.auth?.token?.email ?? '') || null;
    const callerIp = String(request.rawRequest?.ip ?? '') || null;
    const via = callerUid ? 'signed-in' : 'anonymous';

    if (!target) {
      throw new HttpsError('invalid-argument', 'A mobile number is required.');
    }

    if (!password || typeof password !== 'string') {
      throw new HttpsError('invalid-argument', "Today's passcode is required.");
    }

    /* ---- 2. The passcode, throttled ----------------------------------------
     *
     * KEYED ON THE TARGET NUMBER, because there is no caller left to key on. That
     * bounds guessing against any ONE teacher to five tries per quarter hour.
     *
     * ITS LIMIT, stated rather than hidden: an attacker willing to rotate through
     * numbers is not bounded by this at all, because each number carries its own
     * budget. With no caller identity there is nothing better available short of a
     * global counter, and a global counter would let one bad actor lock every
     * legitimate user out. This is the less-bad of the two.
     *
     * CHECKED BEFORE THE TARGET IS RESOLVED, deliberately. The other order lets
     * anyone enumerate which numbers exist in the database by reading whether they
     * got 'not found' or 'wrong passcode', without ever knowing the passcode.
     */
    const attemptRef = db
      .collection(AUDIT_COLLECTION)
      .doc(`attempts_${target.replace('+', '')}`);
    const attemptSnapshot = await attemptRef.get();
    const attemptData = attemptSnapshot.exists
      ? (attemptSnapshot.data() as { failures?: number; windowStart?: Timestamp })
      : undefined;

    const now = Timestamp.now();
    const windowOpen =
      attemptData?.windowStart !== undefined &&
      (now.toMillis() - attemptData.windowStart.toMillis()) / 1000 < PASSCODE_WINDOW_SECONDS;
    const failures = windowOpen ? attemptData?.failures ?? 0 : 0;

    if (failures >= MAX_PASSCODE_ATTEMPTS) {
      await recordImpersonation({
        callerUid,
        callerEmail,
        callerIp,
        via,
        outcome: 'denied-throttled',
        targetPhone: target,
        targetUid: null
      });
      throw new HttpsError(
        'resource-exhausted',
        'Too many incorrect passcodes. Try again in 15 minutes.'
      );
    }

    if (!timingSafeEqual(password.replace(/\D/g, ''), datePassword(new Date()))) {
      await attemptRef.set(
        {
          failures: failures + 1,
          windowStart: windowOpen ? attemptData?.windowStart ?? now : now
        },
        { merge: true }
      );
      await recordImpersonation({
        callerUid,
        callerEmail,
        callerIp,
        via,
        outcome: 'denied-bad-passcode',
        targetPhone: target,
        targetUid: null
      });
      throw new HttpsError('permission-denied', "That is not today's passcode.");
    }

    // A correct passcode clears the run of failures, so a typo earlier in the
    // window does not shorten the next legitimate attempt.
    await attemptRef.set({ failures: 0, windowStart: now }, { merge: true });

    // ---- 3. The target account ---------------------------------------------
    const resolved = await resolveTarget(target, phoneNumber ?? '');

    if (!resolved) {
      await recordImpersonation({
        callerUid,
        callerEmail,
        callerIp,
        via,
        outcome: 'denied-no-such-user',
        targetPhone: target,
        targetUid: null
      });
      throw new HttpsError(
        'not-found',
        'That mobile number is not in the users or teachers list.'
      );
    }

    const targetUser = await auth.getUser(resolved.uid);

    // Another administrator's account is out of bounds. Allowing it would mean a
    // seed-list address could take over a claim-holder's session and, through
    // it, this same function — so one compromised support account would escalate
    // to all of them. Yourself is allowed: it is the harmless case and the
    // obvious way to try the flow out.
    if (targetUser.customClaims?.admin === true && targetUser.uid !== callerUid) {
      await recordImpersonation({
        callerUid,
        callerEmail,
        callerIp,
        via,
        outcome: 'denied-target-is-admin',
        targetPhone: target,
        targetUid: targetUser.uid
      });
      throw new HttpsError('permission-denied', 'Administrator accounts cannot be impersonated.');
    }

    // ---- 4. Audit BEFORE the token, then mint ------------------------------
    //
    // The order matters. A token minted first and audited second leaves no trace
    // at all if the audit write fails, and an unrecorded support session is the
    // one thing this whole feature must not produce.
    //
    // `targetVia` is on the record because the four routes are not equally
    // ordinary: 'created' means this call brought an Auth account into existence,
    // and a run of those is worth being able to find.
    await recordImpersonation({
      callerUid,
      callerEmail,
      callerIp,
      via,
      outcome: 'allowed',
      targetPhone: target,
      targetUid: targetUser.uid,
      targetVia: resolved.via
    }, true);

    let token: string;

    try {
      token = await auth.createCustomToken(targetUser.uid, {
        // Claims, so the session itself says what it is. A banner driven only by
        // client state disappears on reload; this does not.
        impersonated: true,
        // '' rather than null for an anonymous caller: a custom claim set to null
        // is not the same as an absent one to every consumer, and the client reads
        // these with String(), which would render the word "null".
        impersonatedBy: callerUid ?? '',
        impersonatedByEmail: callerEmail ?? ''
      });
    } catch (error) {
      logger.error('createCustomToken failed for an impersonation.', {
        code: (error as { code?: string }).code
      });
      throw new HttpsError('internal', 'Authorised, but the session token could not be issued.');
    }

    logger.info('Impersonation granted', { callerUid, via, targetUid: targetUser.uid });

    return {
      success: true,
      token,
      target: {
        uid: targetUser.uid,
        phoneNumber: targetUser.phoneNumber ?? target,
        displayName: targetUser.displayName ?? ''
      }
    };
  }
);

/*
 * callerIsKnown() USED TO LIVE HERE and is gone with the caller check itself.
 * It read `users/{uid}` and then `teachers` by `teacherMeta.uid` to decide
 * whether the person calling belonged to this app. Nothing calls it now: the only
 * membership test left is on the TARGET number, in resolveTarget below.
 */

/**
 * Finds the account behind a mobile number — ANYONE ALREADY IN users OR teachers.
 *
 * WHY THIS IS NOT JUST getUserByPhoneNumber, which is all it used to be. That
 * asks Firebase Auth, and Auth only knows a number if the account was created
 * BY a phone sign-in. Three groups of real teachers are therefore invisible to
 * it, and all three exist in this project today:
 *
 *   1. Registered by Google, phone number typed into their profile. `users/{uid}`
 *      holds it; the Auth record has no phoneNumber at all. Several of these.
 *   2. Registered by an administrator into `teachers`, and has since signed in —
 *      so `teacherMeta.uid` names their account, but Auth may still not hold the
 *      number.
 *   3. Registered by an administrator and has NEVER signed in. No Auth account
 *      exists at all.
 *
 * The order below is deliberate: cheapest and most authoritative first, and the
 * account-creating branch last and only for a teacher the organisation has
 * already recorded.
 *
 * THE NUMBER IS STORED IN MORE THAN ONE FORMAT, which is why each query runs
 * twice. `users.phone` holds bare digits for most rows and E.164 for a few;
 * `teachers.teacherMeta.phoneNumber` holds digits. Querying one format finds one
 * subset, silently, which is precisely the failure this function is meant to stop
 * being.
 *
 * A NOTE ON THE REVERSAL. The previous version refused to create an account and
 * said so at length: "impersonating a number nobody has registered would conjure
 * the account it then signs into". That reasoning still holds for an ARBITRARY
 * number, and case 3 is not one — a `teachers` document is the organisation
 * asserting this person is theirs. The account created here is the same one their
 * own first sign-in would have created (mintToken keys on the phone number too),
 * so it is materialised early rather than invented.
 */
async function resolveTarget(
  e164: string,
  typedDigits: string
): Promise<{ uid: string; via: 'auth' | 'users' | 'teachers' | 'created' } | null> {
  const auth = getAuth();
  const digits = typedDigits.replace(/\D/g, '') || e164.replace(/\D/g, '');

  // 1. Auth, by phone number. The authoritative answer when it has one.
  try {
    const user = await auth.getUserByPhoneNumber(e164);
    return { uid: user.uid, via: 'auth' };
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') {
      throw error;
    }
  }

  // 2. users/{uid}. THE DOCUMENT ID IS THE UID, so a hit here needs no account
  //    creation and no second lookup — which is what makes the Google-registered
  //    teachers of case 1 reachable.
  for (const value of [digits, e164]) {
    const found = await db.collection('users').where('phone', '==', value).limit(1).get();

    if (!found.empty) {
      return { uid: found.docs[0].id, via: 'users' };
    }
  }

  // 3. teachers/{docId}. The uid is a FIELD here, not the id — the document id is
  //    the teacher record's own, and teacherMeta.uid is filled in on their first
  //    sign-in.
  for (const field of ['teacherMeta.phoneNumber', 'teacherMeta.phone']) {
    for (const value of [digits, e164]) {
      const found = await db.collection('teachers').where(field, '==', value).limit(1).get();

      if (found.empty) {
        continue;
      }

      const meta = (found.docs[0].data() as { teacherMeta?: Record<string, unknown> }).teacherMeta;
      const linkedUid = String(meta?.['uid'] ?? '').trim();

      if (linkedUid) {
        // Guard against a stale link: the record names a uid, the account is gone.
        // Falling through to creation would then make a SECOND account for the
        // same person, so the record is trusted only if the account still exists.
        try {
          await auth.getUser(linkedUid);
          return { uid: linkedUid, via: 'teachers' };
        } catch (error) {
          if ((error as { code?: string }).code !== 'auth/user-not-found') {
            throw error;
          }
          logger.warn('A teacher record names a uid with no Auth account.', {
            teacherDocId: found.docs[0].id
          });
        }
      }

      // Case 3: recorded by the organisation, has never signed in.
      const name = [meta?.['firstName'], meta?.['lastName']]
        .map(part => String(part ?? '').trim())
        .filter(Boolean)
        .join(' ');

      const created = await auth.createUser({
        phoneNumber: e164,
        ...(name ? { displayName: name } : {})
      });

      logger.info('Created an Auth account for a teacher who had never signed in.', {
        teacherDocId: found.docs[0].id,
        uid: created.uid
      });

      return { uid: created.uid, via: 'created' };
    }
  }

  return null;
}

/**
 * One audit document per attempt.
 *
 * `required` DECIDES WHETHER A FAILED WRITE IS FATAL, and the two callers want
 * opposite answers. On the allowed path it is fatal: an unrecorded support
 * session is the one outcome this feature must not produce, so a failed audit
 * refuses the impersonation. On the refusal paths it is not: the caller is being
 * turned away regardless, and replacing 'that is not today's passcode' with a
 * storage error would hide the reason they actually need.
 *
 * Auto-id, and the `attempts_{uid}` throttle documents share this collection —
 * they are told apart by having no `outcome` field.
 */
async function recordImpersonation(
  entry: {
    callerUid: string | null;
    callerEmail: string | null;
    /**
     * The request's source address.
     *
     * ADDED WHEN THE CALLER CHECK WAS REMOVED. With no session required, most
     * attempts carry no uid and no email, and this is the only thing left that
     * says anything about who made the call.
     */
    callerIp: string | null;
    via: string;
    outcome: string;
    targetPhone: string | null;
    targetUid: string | null;
    /** Which of the four lookups found the account. Absent on a refusal. */
    targetVia?: string;
  },
  required = false
): Promise<void> {
  try {
    await db.collection(AUDIT_COLLECTION).add({
      ...entry,
      at: FieldValue.serverTimestamp()
    });
  } catch (error) {
    logger.error('Could not write the impersonation audit record.', {
      outcome: entry.outcome,
      code: (error as { code?: string }).code
    });

    if (required) {
      throw new HttpsError('internal', 'Could not record the impersonation, so it was refused.');
    }
  }
}

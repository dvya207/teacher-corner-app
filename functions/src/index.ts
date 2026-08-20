import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';

import {
  CODE_TTL_MS,
  Challenge,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  generateCode,
  inCooldown,
  judge,
  messageFor,
  newChallenge
} from './codes';
import { sendLoginCode } from './email';

/**
 * Email sign-in codes for Teacher Corner.
 *
 * THE FLOW, and why it is in this order:
 *
 *   1. The client signs in with email and password. Firebase verifies the
 *      password — this code never sees it, and no password is stored anywhere.
 *   2. The client calls requestLoginCode. It is an AUTHENTICATED callable, so the
 *      uid arrives in the request context and the address is read from the Auth
 *      record. Neither is taken from the request body, so a caller cannot ask for
 *      somebody else's code by typing their address into a form.
 *   3. The client signs out immediately, so no usable session exists while the
 *      code is outstanding.
 *   4. The client calls verifyLoginCode with the opaque challengeId and the code.
 *      That one is UNauthenticated, because by then there is deliberately no
 *      session to authenticate with.
 *   5. On success it mints a custom token, and the client exchanges it for a real
 *      session.
 *
 * WHAT THIS IS AND IS NOT. It is a genuine second step: the code goes to the
 * registered address, is single-use, expires, and is rate limited. It is NOT
 * Firebase-enforced multi-factor auth — anyone holding the password can call the
 * Firebase SDK directly and get a session without ever asking this function for a
 * code. Closing that requires Firebase's own MFA (TOTP or SMS) via Identity
 * Platform, which enforces the second factor at the token level. This gates the
 * application's own sign-in path, which is what was asked for.
 */

initializeApp();

/**
 * The app's Firestore is a NAMED database, not (default). Omitting the id here
 * would write challenges into a database this project does not use.
 */
const DATABASE_ID = 'teacher-corner-dev';

/** Admin-only. The client rules deny this collection outright — see firestore.rules. */
const COLLECTION = 'loginCodes';

const db = getFirestore(DATABASE_ID);

// Declared so deploys prompt for anything missing rather than failing at runtime.
const SMTP_HOST = defineString('SMTP_HOST');
const SMTP_PORT = defineString('SMTP_PORT', { default: '587' });
const SMTP_USER = defineString('SMTP_USER');
const MAIL_FROM = defineString('MAIL_FROM');
const SMTP_PASSWORD = defineSecret('SMTP_PASSWORD');

const OPTIONS = {
  region: 'asia-south1',
  secrets: [SMTP_PASSWORD]
} as const;

/** Values read by email.ts, which knows nothing about Functions params. */
function exportConfig(): void {
  process.env['SMTP_HOST'] = SMTP_HOST.value();
  process.env['SMTP_PORT'] = SMTP_PORT.value();
  process.env['SMTP_USER'] = SMTP_USER.value();
  process.env['MAIL_FROM'] = MAIL_FROM.value();
  process.env['SMTP_PASSWORD'] = SMTP_PASSWORD.value();
}

interface StoredChallenge extends Challenge {
  /** For the resend cooldown, which is per account rather than per challenge. */
  email: string;
}

export const requestLoginCode = onCall(OPTIONS, async request => {
  const uid = request.auth?.uid;

  if (!uid) {
    // Reached only if the client skipped the password step.
    throw new HttpsError('unauthenticated', 'Sign in with your password first.');
  }

  const user = await getAuth().getUser(uid);
  const email = user.email;

  if (!email) {
    throw new HttpsError(
      'failed-precondition',
      'This account has no email address, so a code cannot be sent to it.'
    );
  }

  const now = Date.now();

  // Cooldown is keyed on the ACCOUNT, so requesting repeatedly cannot be used to
  // flood an inbox by simply starting a new challenge each time.
  const recent = await db
    .collection(COLLECTION)
    .where('uid', '==', uid)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();

  const last = recent.docs[0]?.data() as StoredChallenge | undefined;

  if (inCooldown(last?.createdAt ?? null, now)) {
    throw new HttpsError(
      'resource-exhausted',
      'A code was just sent. Wait for the timer before asking for another.'
    );
  }

  const code = generateCode();
  const challenge = newChallenge(uid, code, now);

  await db.collection(COLLECTION).doc(challenge.challengeId).set({ ...challenge, email });

  try {
    await sendLoginCode(email, code);
  } catch (error) {
    // The challenge is useless without the email, so remove it rather than leave
    // a code nobody received counting against the cooldown.
    await db.collection(COLLECTION).doc(challenge.challengeId).delete();

    logger.error('Could not send a login code', { uid, error });

    throw new HttpsError(
      'internal',
      'Could not send the code. Check your connection and try again.'
    );
  }

  // The code itself is NEVER returned, and never logged.
  return {
    challengeId: challenge.challengeId,
    expiresAt: challenge.expiresAt,
    resendAfterMs: RESEND_COOLDOWN_MS,
    ttlMs: CODE_TTL_MS,
    /** Masked, so the UI can say where it went without printing the address. */
    sentTo: maskEmail(email)
  };
});

export const verifyLoginCode = onCall({ region: OPTIONS.region }, async request => {
  const challengeId = String(request.data?.challengeId ?? '');
  const code = String(request.data?.code ?? '');

  if (!challengeId || !/^\d{6}$/.test(code)) {
    throw new HttpsError('invalid-argument', 'Enter the 6-digit code from the email.');
  }

  const reference = db.collection(COLLECTION).doc(challengeId);
  const snapshot = await reference.get();
  const stored = snapshot.exists ? (snapshot.data() as StoredChallenge) : null;

  const verdict = judge(stored, code, Date.now());

  if (!verdict.ok) {
    if (verdict.countsAsAttempt && stored) {
      // Counted BEFORE responding, so a client that hangs up cannot retry free.
      await reference.update({ attempts: stored.attempts + 1 });

      const left = MAX_ATTEMPTS - (stored.attempts + 1);

      throw new HttpsError(
        'permission-denied',
        left > 0
          ? `That code is not correct. ${left} attempt${left === 1 ? '' : 's'} left.`
          : 'Too many incorrect attempts. Request a new code.'
      );
    }

    throw new HttpsError('permission-denied', messageFor(verdict.reason));
  }

  // Single use: consumed before the token is minted, so a replay of the same
  // request cannot produce a second session.
  await reference.update({ consumedAt: Date.now() });

  const token = await getAuth().createCustomToken(stored!.uid);

  return { token };
});

/** a…z@example.com — enough to recognise, not enough to harvest. */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');

  if (!domain) {
    return email;
  }

  const head = local.slice(0, 1);
  const tail = local.length > 1 ? local.slice(-1) : '';

  return `${head}${'•'.repeat(Math.max(1, local.length - 2))}${tail}@${domain}`;
}

// Config is exported once per instance rather than per request.
exportConfig();

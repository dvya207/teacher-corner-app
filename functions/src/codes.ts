import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Login-code rules, kept free of Firebase and of I/O.
 *
 * Everything security-relevant about the OTP lives here — generation, hashing,
 * comparison, expiry, attempt limits — so it can be tested directly rather than
 * through a deployed function. index.ts holds the Firestore and email plumbing
 * and no rules of its own.
 */

/** Digits in the emailed code. Six is what the popup renders. */
export const CODE_LENGTH = 6;

/** How long a code stays usable. Short: it is emailed, not carried around. */
export const CODE_TTL_MS = 10 * 60 * 1000;

/**
 * Wrong guesses allowed before the challenge is dead.
 *
 * Five, not unlimited: a six-digit code is only a million possibilities, which a
 * script can walk in minutes if nothing counts the failures.
 */
export const MAX_ATTEMPTS = 5;

/** Minimum gap between sends for one account, so Resend cannot be used to spam. */
export const RESEND_COOLDOWN_MS = 45 * 1000;

export interface Challenge {
  /** Opaque id handed to the client. Not the uid, so it reveals nothing. */
  challengeId: string;
  uid: string;
  /** SHA-256 of the code. The code itself is never stored. */
  codeHash: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  /** Set once verified, so a code cannot be replayed. */
  consumedAt: number | null;
}

/**
 * A cryptographically random code.
 *
 * randomInt, not Math.random: Math.random is seeded predictably enough that
 * codes drawn from it can be guessed from earlier ones.
 */
export function generateCode(): string {
  let code = '';

  for (let i = 0; i < CODE_LENGTH; i++) {
    code += String(randomInt(0, 10));
  }

  return code;
}

/** An unguessable id for the challenge, so knowing one tells you nothing about others. */
export function generateChallengeId(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * SHA-256 of the code.
 *
 * Plain SHA-256 rather than a password hash: the input is six digits with a
 * ten-minute life, so a slow KDF buys nothing a brute-force limit does not, and
 * the point is only that a database leak does not hand over live codes.
 */
export function hashCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

/**
 * Constant-time comparison.
 *
 * A plain === leaks how many leading digits were right through timing. The
 * difference is small, but it is free to avoid.
 */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

export function newChallenge(uid: string, code: string, now: number): Challenge {
  return {
    challengeId: generateChallengeId(),
    uid,
    codeHash: hashCode(code),
    createdAt: now,
    expiresAt: now + CODE_TTL_MS,
    attempts: 0,
    consumedAt: null
  };
}

export type VerdictReason =
  | 'ok'
  | 'not-found'
  | 'expired'
  | 'already-used'
  | 'too-many-attempts'
  | 'wrong-code';

export interface Verdict {
  ok: boolean;
  reason: VerdictReason;
  /** True when the caller should record the failed attempt. */
  countsAsAttempt: boolean;
}

/**
 * Judges a submitted code.
 *
 * Order matters. Expiry and consumption are checked BEFORE the code itself, so a
 * dead challenge cannot be used as an oracle to test digits against.
 */
export function judge(
  challenge: Challenge | null,
  submitted: string,
  now: number
): Verdict {
  if (!challenge) {
    return { ok: false, reason: 'not-found', countsAsAttempt: false };
  }

  if (challenge.consumedAt !== null) {
    return { ok: false, reason: 'already-used', countsAsAttempt: false };
  }

  if (now > challenge.expiresAt) {
    return { ok: false, reason: 'expired', countsAsAttempt: false };
  }

  if (challenge.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: 'too-many-attempts', countsAsAttempt: false };
  }

  if (!hashesMatch(challenge.codeHash, hashCode(submitted))) {
    return { ok: false, reason: 'wrong-code', countsAsAttempt: true };
  }

  return { ok: true, reason: 'ok', countsAsAttempt: false };
}

/** True while a fresh send would be too soon after the last one. */
export function inCooldown(lastSentAt: number | null, now: number): boolean {
  return lastSentAt !== null && now - lastSentAt < RESEND_COOLDOWN_MS;
}

/**
 * What the client is told.
 *
 * 'wrong-code' and 'not-found' deliberately collapse into one message, so the
 * response cannot be used to discover which challenge ids exist.
 */
export function messageFor(reason: VerdictReason): string {
  switch (reason) {
    case 'expired':
      return 'That code has expired. Request a new one.';
    case 'already-used':
      return 'That code has already been used. Request a new one.';
    case 'too-many-attempts':
      return 'Too many incorrect attempts. Request a new code.';
    default:
      return 'That code is not correct.';
  }
}

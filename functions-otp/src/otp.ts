import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * OTP rules, kept free of Firebase and of I/O so they can be read and tested
 * without a deployment.
 *
 * Every value here comes from the Exotel OTP guide for helix-staging-india and
 * is not tuned. The guide is the source of truth for this flow.
 */

/** Digits in the code. */
export const OTP_LENGTH = 6;

/** How long a code stays valid. Also the {{timeout}} the SMS promises, in minutes. */
export const OTP_EXPIRY_SECONDS = 300;

/** Wrong guesses allowed before the challenge is destroyed. */
export const MAX_VERIFICATION_ATTEMPTS = 5;

/** Sends allowed per phone per window. This is what stands between the Exotel
 *  account and an unbounded bill. */
export const MAX_OTP_REQUESTS_PER_WINDOW = 3;

export const RATE_LIMIT_WINDOW_SECONDS = 600;

/**
 * The DLT-registered login template, verbatim.
 *
 * DO NOT EDIT. OTP_TEMPLATE_ID is registered with the telecom DLT registry
 * against the organisation's DLT entity, and DLT rejects any message whose body
 * differs from the registered text by even one character, with valid
 * credentials and a 2xx-looking request. A different message needs a new
 * template registered first, which takes days.
 *
 * Only the three {{...}} placeholders may be substituted. The trailing
 * "-ThinkTac" and every space are fixed text.
 */
export const OTP_SMS_TEMPLATE =
  '{{otp}} is your OTP to log in to the {{platformName}} platform. ' +
  'Your OTP is valid for {{timeout}} minutes. -ThinkTac';

/**
 * Substitution, never concatenation.
 *
 * Built by replacing into the registered string so the fixed text cannot drift.
 * Assembling the same sentence by joining fragments produces something that
 * looks right and fails the DLT match.
 */
export function buildOtpSms(otp: string, platformName: string): string {
  return OTP_SMS_TEMPLATE
    .replace('{{otp}}', otp)
    .replace('{{platformName}}', platformName)
    .replace('{{timeout}}', String(OTP_EXPIRY_SECONDS / 60));
}

/**
 * Tolerates the shapes a phone number arrives in and produces the one form used
 * as both the Exotel recipient and the Firestore document id.
 *
 * The document id matters: two spellings of one number that normalise
 * differently would each get their own rate-limit counter, which is a way
 * around the cap rather than a cosmetic issue.
 */
export function normalizePhone(phone: string): string {
  const stripped = phone.replace(/[\s\-()]/g, '');
  return stripped.startsWith('+') ? stripped : `+${stripped}`;
}

/**
 * randomInt, NOT Math.random. Math.random is seeded predictably enough that
 * codes drawn from it can be derived from earlier ones, which turns a six-digit
 * secret into no secret at all.
 */
export function generateSecureOtp(): string {
  const min = 10 ** (OTP_LENGTH - 1);
  const max = 10 ** OTP_LENGTH - 1;
  return randomInt(min, max + 1).toString();
}

export function generateSalt(): string {
  return randomBytes(16).toString('hex');
}

/** sha256(otp + salt), matching the guide's field order. The plaintext code is
 *  never stored, so a leaked document cannot be read back into a usable code
 *  without brute force. */
export function hashOtp(otp: string, salt: string): string {
  return createHash('sha256').update(otp + salt).digest('hex');
}

/**
 * Constant-time comparison.
 *
 * A plain === leaks how many leading characters matched through how long the
 * comparison took, which over enough attempts recovers the hash.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * The label substituted into {{platformName}}.
 *
 * VALIDATED, not passed through. The guide allows the client to supply this and
 * warns that "a long or punctuation-heavy value can push the message over a
 * segment boundary or trip the template match". Since the client is the one
 * place an attacker controls, that warning is enforced here rather than
 * trusted: letters and single spaces only, and short. Anything else falls back
 * to the default instead of being sent to DLT.
 */
export function safePlatformName(value: unknown, fallback = 'ThinkTac'): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();

  return /^[A-Za-z][A-Za-z ]{0,23}$/.test(trimmed) ? trimmed : fallback;
}

/** Comma-separated allowlist from the TEST_PHONES env var. */
export function parseTestPhones(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean)
  );
}

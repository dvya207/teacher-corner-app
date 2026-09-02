/**
 * Impersonation — helpers, kept out of index.ts so they can be tested alone.
 *
 * The gate this file exists to get right is NOT the date password. See the note
 * on `datePassword` for why that is a confirmation step and not an authorisation.
 */

/**
 * Today's date as DDMMYYYY — production's impersonation password.
 *
 * WHAT THIS IS FOR, AND WHAT IT IS NOT. Production's impersonation page asks for
 * this string and compares it IN THE BROWSER:
 *
 *   if (this.password != this.getPassword()) { return; }
 *
 * That is not a secret. It is derivable from a calendar, the comparison is in a
 * JS bundle anyone can read, and the endpoint behind it mints a token for any
 * phone number — so calling it directly skips the check entirely.
 *
 * It is kept here because it is the flow the team knows, and because a
 * deliberate second step is a real guard against the wrong number being typed.
 * It is checked SERVER-SIDE, where it cannot be bypassed, and it is checked
 * AFTER the admin claim, which is the thing actually doing the authorising.
 *
 * UTC, and that is a decision. A caller in Asia/Kolkata just after midnight is
 * on a different date from a function running in UTC. Server time is the only
 * clock both sides can agree on without trusting the client, so the page tells
 * the user which date to type rather than guessing from their locale.
 */
export function datePassword(now: Date): string {
  const day = String(now.getUTCDate()).padStart(2, '0');
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');

  return `${day}${month}${now.getUTCFullYear()}`;
}

/**
 * Constant-time string comparison.
 *
 * Reused reasoning from otp.ts: a `===` on a secret leaks its length and its
 * matching prefix through timing. The date is not much of a secret, but the
 * habit is worth keeping consistent across both entry points.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let mismatch = 0;

  for (let index = 0; index < a.length; index++) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return mismatch === 0;
}

/**
 * An E.164 number from a country code and a subscriber number.
 *
 * The page sends the two separately, as production's does. Everything
 * non-numeric is stripped and a single leading '+' re-added, so '+91' / '98765
 * 43210' and '91' / '9876543210' produce the same result.
 */
export function toE164(countryCode: string, phoneNumber: string): string {
  const code = String(countryCode ?? '').replace(/\D/g, '');
  const digits = String(phoneNumber ?? '').replace(/\D/g, '');

  if (!code || !digits) {
    return '';
  }

  return `+${code}${digits}`;
}

/**
 * Collection holding one document per impersonation attempt, allowed or not.
 *
 * Now that the gate is database membership rather than an allowlist, this is no
 * longer supporting evidence — it is the only record of who borrowed whose
 * account, and the only thing that would show a misuse after the fact.
 */
export const AUDIT_COLLECTION = 'ImpersonationAudit';

/**
 * Wrong passcodes tolerated per caller per window before the door shuts.
 *
 * The date is eight digits with only ~365 live values, so an unthrottled form is
 * walkable by hand by anyone holding a session who does not know the scheme.
 *
 * THIS MATTERS MORE THAN IT USED TO. The comment here said the throttle was not
 * the primary defence because the claim was; the claim is no longer the gate, so
 * for a caller who is in the database but does not know the passcode scheme, this
 * counter is the only thing standing between them and guessing it.
 */
export const MAX_PASSCODE_ATTEMPTS = 5;

/** Rolling window for the count above, in seconds. */
export const PASSCODE_WINDOW_SECONDS = 15 * 60;

/*
 * authoriseCaller() WAS HERE, AND IS GONE. There is no caller to authorise.
 *
 * It went through three shapes as the policy moved: an email allowlist, then
 * email plus phone, then an `admin: true` claim over a database-membership check.
 * All three are now moot — the endpoint requires no session at all, so nothing
 * about the caller is inspected. Recorded here rather than deleted silently,
 * because "why is there no caller check" is the first question anyone reading
 * tcDevImpersonate will have, and the answer is a deliberate decision rather than
 * an omission. See the note on section 1 of that function.
 *
 * One piece of reasoning worth keeping for whoever restores an address check:
 * `email_verified` should NOT be required. These are Workspace accounts, where
 * the address is asserted by the provider rather than by a confirmation link, and
 * Firebase does not always set the flag for them.
 */

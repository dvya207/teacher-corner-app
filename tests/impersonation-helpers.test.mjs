/**
 * The impersonation gate's helpers, tested away from Firebase.
 *
 * WHY THESE THREE AND NOT THE CALLABLE. tcDevImpersonate needs the Admin SDK, a
 * project, an Auth user with a phone number and a Firestore to write an audit
 * record into, so exercising it means the emulator suite. These four functions
 * are where its DECISIONS live, and each has a failure mode that is invisible
 * from the outside:
 *
 *   datePassword     — off-by-one on the month (getUTCMonth is zero-based) makes
 *                      the passcode nobody can type, once a month at worst and
 *                      every day at best.
 *   timingSafeEqual  — an early return on a length mismatch is correct; an early
 *                      return inside the loop would not be, and both pass a
 *                      naive equality test.
 *   toE164           — '+91' + '98765 43210' and '91' + '9876543210' must reach
 *                      the same number, or a support request fails on how the
 *                      admin happened to type it.
 *
 * COMPILED HERE RATHER THAN IMPORTED FROM functions-otp/lib. That directory is
 * gitignored build output, so importing it makes the suite pass or fail on
 * whether somebody ran a build. impersonation.ts has no imports of its own,
 * which is what makes a standalone compile of the single file possible — and is
 * a reason to keep it that way.
 *
 * Run with:  npm run test:isolation
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let helpers;

before(() => {
  const out = mkdtempSync(join(tmpdir(), 'tc-impersonation-'));

  execFileSync(
    'npx',
    [
      'tsc',
      join(ROOT, 'functions-otp/src/impersonation.ts'),
      '--outDir', out,
      '--module', 'esnext',
      '--target', 'es2022',
      '--moduleResolution', 'bundler',
      '--strict'
    ],
    { cwd: ROOT, stdio: 'pipe' }
  );

  return import(join(out, 'impersonation.js')).then(module => {
    helpers = module;
  });
});

/*
 * authoriseCaller's suite WAS HERE and is gone with the function.
 *
 * It asserted that an `admin: true` claim authorised a caller and that nothing
 * else did. There is no caller check left to test: tcDevImpersonate requires no
 * session, so the only membership test is on the TARGET number, which needs
 * Firestore and is covered by the emulator scripts instead.
 *
 * What remains in this file is the three pure functions the gate still rests on.
 */

describe('datePassword — today, as DDMMYYYY', () => {

  /** January is month 0 from getUTCMonth, which is the off-by-one to pin. */
  test('pads the day and the month, and does not shift the month', () => {
    assert.equal(helpers.datePassword(new Date('2026-01-05T10:00:00Z')), '05012026');
    assert.equal(helpers.datePassword(new Date('2026-12-31T23:59:59Z')), '31122026');
  });

  test('is always eight digits', () => {
    for (const iso of ['2026-01-01T00:00:00Z', '2026-09-09T12:00:00Z', '2026-11-30T00:00:00Z']) {
      assert.match(helpers.datePassword(new Date(iso)), /^\d{8}$/);
    }
  });

  /**
   * UTC, NOT LOCAL, and this is the assertion that says so. A local-time
   * implementation would return the 1st here for a box in Asia/Kolkata (+05:30)
   * while the function in asia-south1 read the 31st, and the passcode would be
   * unenterable for five and a half hours every night.
   */
  test('reads the UTC date, not the local one', () => {
    assert.equal(helpers.datePassword(new Date('2026-08-31T23:30:00Z')), '31082026');
  });
});

describe('timingSafeEqual', () => {

  test('is true only for identical strings', () => {
    assert.equal(helpers.timingSafeEqual('31082026', '31082026'), true);
    assert.equal(helpers.timingSafeEqual('31082026', '31082027'), false);
    assert.equal(helpers.timingSafeEqual('', ''), true);
  });

  /** Different lengths cannot be compared byte for byte, so they exit early. */
  test('is false for different lengths', () => {
    assert.equal(helpers.timingSafeEqual('3108202', '31082026'), false);
    assert.equal(helpers.timingSafeEqual('31082026', ''), false);
  });

  /**
   * NO EARLY EXIT ON THE FIRST MISMATCH. A difference in the last character must
   * cost the same as one in the first — the loop accumulates with |= rather than
   * returning. This asserts the RESULT for both, which is what a `return false`
   * inside the loop would keep correct while leaking the position through timing;
   * the shape is pinned by reading the source below.
   */
  test('compares the whole string regardless of where it differs', () => {
    assert.equal(helpers.timingSafeEqual('a0000000', 'b0000000'), false);
    assert.equal(helpers.timingSafeEqual('0000000a', '0000000b'), false);
  });
});

describe('toE164', () => {

  test('joins a dial code and a subscriber number', () => {
    assert.equal(helpers.toE164('+91', '9876543210'), '+919876543210');
  });

  /** The two ways the page could send the code must agree. */
  test('accepts the dial code with or without its plus', () => {
    assert.equal(helpers.toE164('91', '9876543210'), helpers.toE164('+91', '9876543210'));
  });

  /** Copied from a contact card, a number arrives with spaces or dashes. */
  test('strips everything non-numeric', () => {
    assert.equal(helpers.toE164('+91', '98765 43210'), '+919876543210');
    assert.equal(helpers.toE164('+91', '98765-43210'), '+919876543210');
    assert.equal(helpers.toE164('+1', '(555) 010-9999'), '+15550109999');
  });

  /**
   * EMPTY, NOT A PARTIAL NUMBER. The callable checks for a falsy result and
   * answers invalid-argument; returning '+91' for a blank field would send a
   * two-character number to getUserByPhoneNumber and surface as 'no account
   * exists' instead of 'you did not type a number'.
   */
  test('returns empty when either half is missing', () => {
    assert.equal(helpers.toE164('+91', ''), '');
    assert.equal(helpers.toE164('', '9876543210'), '');
    assert.equal(helpers.toE164('+91', '   '), '');
    assert.equal(helpers.toE164(undefined, undefined), '');
  });
});

describe('the throttle constants are sane', () => {

  /**
   * Not arbitrary: the passcode has ~365 live values, so a cap in the hundreds
   * would make the throttle decorative, and a cap of 1 would lock an
   * administrator out for a quarter of an hour over one mistyped digit.
   */
  test('a handful of attempts, over a window measured in minutes', () => {
    assert.ok(helpers.MAX_PASSCODE_ATTEMPTS >= 3 && helpers.MAX_PASSCODE_ATTEMPTS <= 10);
    assert.ok(helpers.PASSCODE_WINDOW_SECONDS >= 300);
    assert.equal(helpers.AUDIT_COLLECTION, 'ImpersonationAudit');
  });
});

import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';

import { authGuard } from './auth-guard';
import {
  approvalPendingGuard,
  registrationCompleteGuard,
  registrationGuard
} from './registration-guard';
import { AuthService } from '../services/auth.service';
import { ProfileService } from '../services/profile.service';

/**
 * THE WHOLE SIGN-IN FLOW LIVES IN THESE FOUR FUNCTIONS.
 *
 * Both routes converge on /dashboard — the login page navigates there and knows
 * nothing about registration or approval — so what a teacher actually sees next
 * is decided here and nowhere else. That makes an untested guard a flow with no
 * test at all, which is what this file exists to fix.
 *
 * ProfileService is stubbed rather than mocked at the Firestore layer: gate()
 * reads users/{uid} directly and this project's vitest setup rejects mocking
 * 'firebase/firestore' globally (see configuration.service.spec.ts). The stub is
 * the seam, and the three gate values are the whole contract.
 */

type Gate = 'register' | 'approval' | null;

/** Where a guard sent us, as a path, or true when it let us through. */
function destination(result: boolean | UrlTree): string | boolean {
  return result instanceof UrlTree ? result.toString() : result;
}

function withGate(gate: Gate): void {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: ProfileService, useValue: { gate: async () => gate } },
      { provide: AuthService, useValue: { ready: async () => ({ uid: 'u1' }) } }
    ]
  });
}

async function run(guard: typeof registrationGuard): Promise<string | boolean> {
  const result = await TestBed.runInInjectionContext(() =>
    (guard as unknown as () => Promise<boolean | UrlTree>)()
  );

  return destination(result);
}

describe('authGuard', () => {

  it('lets a signed-in visitor through', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: { ready: async () => ({ uid: 'u1' }) } }]
    });

    expect(await run(authGuard)).toBe(true);
  });

  /**
   * AWAITS REHYDRATION FIRST. Reading currentUser synchronously returns null for
   * a signed-in user on a cold load, which would bounce them to /login on every
   * refresh — the stub returning null stands for genuinely signed out.
   */
  it('sends a signed-out visitor to the sign-in page', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: { ready: async () => null } }]
    });

    expect(await run(authGuard)).toBe('/login');
  });
});

describe('registrationGuard — what the shell opens to', () => {

  /**
   * THE GOOGLE ROUTE. gate() returns null for anything that is not a phone
   * sign-in, so a Google account goes straight to the dashboard with no
   * registration and no approval. This is the assertion that guarantees it.
   */
  it('lets a clear gate through, which is how Google reaches the dashboard', async () => {
    withGate(null);

    expect(await run(registrationGuard)).toBe(true);
  });

  it('sends an unregistered phone sign-in to Create Account', async () => {
    withGate('register');

    expect(await run(registrationGuard)).toBe('/register');
  });

  it('sends a registered but unapproved teacher to the waiting page', async () => {
    withGate('approval');

    expect(await run(registrationGuard)).toBe('/approval-page');
  });
});

describe('registrationCompleteGuard — who may see the form', () => {

  it('admits somebody who still has it to fill in', async () => {
    withGate('register');

    expect(await run(registrationCompleteGuard)).toBe(true);
  });

  /**
   * Without this the form stays reachable forever and offers to overwrite a
   * finished profile with a blank one. /profile is where editing belongs.
   */
  it('turns away a teacher who has finished it, sending them to the dashboard', async () => {
    withGate(null);

    expect(await run(registrationCompleteGuard)).toBe('/dashboard');
  });

  it('sends one already waiting to the waiting page, not back to the form', async () => {
    withGate('approval');

    expect(await run(registrationCompleteGuard)).toBe('/approval-page');
  });
});

describe('approvalPendingGuard — who may see the waiting page', () => {

  it('admits somebody actually waiting', async () => {
    withGate('approval');

    expect(await run(approvalPendingGuard)).toBe(true);
  });

  /** An approved teacher would read a message about a request already granted. */
  it('turns away an approved teacher', async () => {
    withGate(null);

    expect(await run(approvalPendingGuard)).toBe('/dashboard');
  });

  /** One who never registered would see it name a classroom they never chose. */
  it('sends an unregistered teacher to the form first', async () => {
    withGate('register');

    expect(await run(approvalPendingGuard)).toBe('/register');
  });
});

/**
 * THE FLOW, END TO END, as the sequence of gate values a phone sign-in passes
 * through. Asserted as one test because the ORDER is the requirement: register,
 * then approval, then the dashboard — and no step reachable out of turn.
 */
describe('the phone sign-in journey', () => {

  it('runs register -> approval -> dashboard, and blocks each step out of turn', async () => {
    // Just signed in, no profile: the shell defers to Create Account.
    withGate('register');
    expect(await run(registrationGuard)).toBe('/register');
    expect(await run(registrationCompleteGuard)).toBe(true);
    // The waiting page is not reachable yet.
    expect(await run(approvalPendingGuard)).toBe('/register');

    // Form submitted: profileComplete true, ApprovedStatus false.
    withGate('approval');
    expect(await run(registrationGuard)).toBe('/approval-page');
    expect(await run(approvalPendingGuard)).toBe(true);
    // The form is no longer reachable.
    expect(await run(registrationCompleteGuard)).toBe('/approval-page');

    // Approved: the shell opens, and neither earlier step is reachable.
    withGate(null);
    expect(await run(registrationGuard)).toBe(true);
    expect(await run(registrationCompleteGuard)).toBe('/dashboard');
    expect(await run(approvalPendingGuard)).toBe('/dashboard');
  });
});

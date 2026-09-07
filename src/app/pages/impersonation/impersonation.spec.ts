import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { AuthService } from '../../services/auth.service';
import { ImpersonationService, PASSCODE_LENGTH } from '../../services/impersonation.service';
import { Impersonation } from './impersonation';

/**
 * The impersonation page.
 *
 * THE LOAD-BEARING ASSERTIONS ARE THE NEGATIVE ONES. This page's whole reason
 * for differing from production's is that production compares the passcode in
 * the browser and this one does not, so what is pinned here is the ABSENCE of a
 * client-side gate:
 *
 *   - a wrong passcode still reaches the server (it is the server's to reject);
 *   - the page never computes what the correct passcode is;
 *   - a refusal does not sign anybody in.
 *
 * The first of those looks like a test asserting a bug. It is the opposite: a
 * component that filtered wrong passcodes locally would be reintroducing the
 * comparison whose bypassability is the reason this was rebuilt, and it would
 * also mean the server's throttle never sees the attempts it is counting.
 */

class StubAuthService {
  impersonationTokens: string[] = [];
  plainTokens: string[] = [];

  /**
   * Whether a session exists. NOTHING ON THE PAGE READS IT any more — kept only
   * so the test below can set it to null and assert that the form still works
   * with nobody signed in, which is the requirement.
   */
  uid: string | null = 'admin-uid';

  async loginByImpersonation(token: string): Promise<void> {
    this.impersonationTokens.push(token);
  }

  /** Present so a call to the WRONG method is a visible failure, not a crash. */
  async loginWithToken(token: string): Promise<void> {
    this.plainTokens.push(token);
  }

  describeImpersonationError(error: unknown): string {
    return (error as { message?: string })?.message ?? 'Refused.';
  }

  describeError(): string {
    return 'Something went wrong.';
  }
}

class StubImpersonationService {
  readonly available = true;

  calls: { countryCode: string; phoneNumber: string; password: string }[] = [];
  error: unknown = null;

  async impersonate(countryCode: string, phoneNumber: string, password: string) {
    this.calls.push({ countryCode, phoneNumber, password });

    if (this.error) {
      throw this.error;
    }

    return {
      token: 'impersonation-token',
      target: { uid: 'teacher-uid', phoneNumber: `${countryCode}${phoneNumber}`, displayName: 'Ada' }
    };
  }
}

describe('Impersonation', () => {

  let fixture: ComponentFixture<Impersonation>;
  let component: Impersonation;
  let auth: StubAuthService;
  let service: StubImpersonationService;
  let navigated: unknown[][];

  /** Any eight digits. Deliberately NOT today's date: the page must not care. */
  const PASSCODE = '01012099';

  function fillNumber(number = '6362398700'): void {
    component.onPhoneInput(number);
    fixture.detectChanges();
  }

  /** A SECOND fixture from the same providers, built after the stub is adjusted. */
  async function mountFresh(): Promise<{
    fixture: ComponentFixture<Impersonation>;
    el: HTMLElement;
  }> {
    const fresh = TestBed.createComponent(Impersonation);
    fresh.detectChanges();
    await fresh.whenStable();
    fresh.detectChanges();

    return { fixture: fresh, el: fresh.nativeElement as HTMLElement };
  }

  function fillPasscode(value = PASSCODE): void {
    // Through the paste path, which is how the row is actually filled and which
    // exercises fillFrom's clamp at the same time.
    component.onDigitInput(0, value);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
    auth = new StubAuthService();
    service = new StubImpersonationService();

    await TestBed.configureTestingModule({
      imports: [Impersonation],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: ImpersonationService, useValue: service }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(Impersonation);
    component = fixture.componentInstance;

    navigated = [];
    vi.spyOn(TestBed.inject(Router), 'navigate').mockImplementation((...args: unknown[]) => {
      navigated.push(args);
      return Promise.resolve(true);
    });

    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
  });

  /* ---- What the page offers ---------------------------------------------- */

  it('asks for a mobile number and today\'s passcode, and nothing else', () => {
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('#mobile')).not.toBeNull();
    expect(el.textContent).toContain('Impersonation Login');
    expect(el.textContent).toContain('Admin Impersonation');

    // No second sign-in route: this is not another front door.
    expect(el.querySelector('.google-btn')).toBeNull();
    expect(el.querySelector('.divider')).toBeNull();
    expect(el.querySelector('#password')).toBeNull();
    expect(el.querySelector('#email')).toBeNull();
  });

  /**
   * REMOVED ON INSTRUCTION, and pinned so a revert is visible. The page had a
   * "Back to dashboard" link under the button; the browser's own Back and the
   * /dashboard URL are the way out now.
   */
  it('offers no link away from the page', () => {
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('.impersonate-actions')).toBeNull();
    expect(el.textContent).not.toContain('Back to dashboard');
  });

  /** Production's page shows the passcode row only once a number is in. */
  it('reveals the passcode row once the number could be real', () => {
    expect(fixture.nativeElement.querySelector('.code-row')).toBeNull();

    fillNumber();

    expect(fixture.nativeElement.querySelectorAll('.digit').length).toBe(PASSCODE_LENGTH);
  });

  it('uses eight boxes, matching DDMMYYYY', () => {
    expect(PASSCODE_LENGTH).toBe(8);
    expect(component.slots.length).toBe(8);
  });

  /* ---- The button --------------------------------------------------------- */

  it('will not submit without both a valid number and a full passcode', () => {
    const button = () =>
      fixture.nativeElement.querySelector('.send-btn') as HTMLButtonElement;

    expect(button().disabled).toBe(true);

    fillNumber('63623');
    expect(component.canSubmit()).toBe(false);

    fillNumber();
    expect(component.canSubmit()).toBe(false);

    fillPasscode('0101209');
    expect(component.canSubmit()).toBe(false);

    fillPasscode();
    expect(component.canSubmit()).toBe(true);
    expect(button().disabled).toBe(false);
  });

  /* ---- No client-side gate ----------------------------------------------- */

  /**
   * THE POINT OF THE REBUILD. A passcode that is not today's date is sent
   * anyway, because deciding that is the server's job — and because the server's
   * throttle counts attempts it never sees otherwise.
   */
  it('sends a wrong passcode to the server rather than judging it locally', async () => {
    fillNumber();
    fillPasscode('99999999');

    await component.submit();

    expect(service.calls).toEqual([
      { countryCode: '+91', phoneNumber: '6362398700', password: '99999999' }
    ]);
  });

  /** Nothing on this page derives the expected value, so nothing can leak it. */
  it('exposes no way to read the correct passcode', () => {
    const surface = component as unknown as Record<string, unknown>;

    for (const name of ['todaysHint', 'todaysPasscode', 'expectedPasscode', 'getPassword']) {
      expect(surface[name]).toBeUndefined();
    }
  });

  /* ---- Success ----------------------------------------------------------- */

  it('exchanges the token through loginByImpersonation and lands on the dashboard', async () => {
    fillNumber();
    fillPasscode();

    await component.submit();

    expect(auth.impersonationTokens).toEqual(['impersonation-token']);
    // NOT loginWithToken: that one stamps the teacher's own users/{uid} record
    // with a sign-in they did not perform.
    expect(auth.plainTokens).toEqual([]);
    expect(navigated).toEqual([[['/dashboard']]]);
  });

  /* ---- Refusals ---------------------------------------------------------- */

  it('shows the server\'s reason and signs nobody in when refused', async () => {
    service.error = Object.assign(new Error('That is not today\'s passcode.'), {
      code: 'functions/permission-denied'
    });

    fillNumber();
    fillPasscode();
    await component.submit();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.form-error')?.textContent)
      .toContain('That is not today\'s passcode.');
    expect(auth.impersonationTokens).toEqual([]);
    expect(navigated).toEqual([]);
  });

  /**
   * The passcode goes, the number stays. A refusal is nearly always the
   * passcode, and clearing both means retyping ten digits for it.
   */
  it('clears the passcode but keeps the number after a refusal', async () => {
    service.error = Object.assign(new Error('nope'), { code: 'functions/permission-denied' });

    fillNumber();
    fillPasscode();
    await component.submit();

    expect(component.passcode()).toBe('');
    expect(component.phoneNumber()).toBe('6362398700');
  });

  it('is not left busy after a refusal', async () => {
    service.error = Object.assign(new Error('nope'), { code: 'functions/internal' });

    fillNumber();
    fillPasscode();
    await component.submit();

    expect(component.pending()).toBe(false);
  });

  /* ---- No session needed ------------------------------------------------- */

  /**
   * THE FORM WORKS WITH NOBODY SIGNED IN. The page had authGuard, then a "you are
   * not signed in" notice, then neither: the callable requires no ID token, so a
   * missing session is not a reason to refuse before asking. Pinned because the
   * pre-check is easy to reintroduce as a "safety" improvement, and it would
   * silently break the only way this page is meant to be used.
   */
  it('submits with no session, and shows no sign-in notice', async () => {
    auth.uid = null;
    const fresh = await mountFresh();
    const page = fresh.fixture.componentInstance;

    expect(fresh.el.querySelector('.notice')).toBeNull();
    expect(fresh.el.textContent).not.toContain('not signed in');

    page.onPhoneInput('6362398700');
    page.onDigitInput(0, PASSCODE);
    await page.submit();

    expect(service.calls).toEqual([
      { countryCode: '+91', phoneNumber: '6362398700', password: PASSCODE }
    ]);
  });

  /* ---- Input handling ---------------------------------------------------- */

  /**
   * Login's rule, carried over WITH the bug it fixes: 9180000000 is a real
   * Indian mobile that begins 91, and treating that as a dial code silently ate
   * its first two digits.
   */
  it('keeps a ten-digit number that happens to start with the dial code', () => {
    component.onPhoneInput('9180000000');

    expect(component.phoneNumber()).toBe('9180000000');
  });

  it('strips a pasted dial code only when the length says it is one', () => {
    component.onPhoneInput('919180000000');

    expect(component.phoneNumber()).toBe('9180000000');
  });

  /** A pasted passcode fills across the boxes rather than into one. */
  it('spreads a pasted passcode across the row and clamps it', () => {
    fillNumber();
    component.onDigitInput(0, '310820260000');

    expect(component.passcode()).toBe('31082026');
  });

  it('clears the number when the country changes', () => {
    fillNumber();
    component.onCountryChange('+1');

    expect(component.phoneNumber()).toBe('');
    expect(component.countryCode()).toBe('+1');
  });
});

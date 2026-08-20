import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { AuthService } from '../../services/auth.service';
import { OtpService } from '../../services/otp.service';
import { Login } from './login';

/**
 * The login page.
 *
 * THE MOBILE CODE LEADS, GOOGLE IS THE "OR". The email and password form was
 * removed on instruction and has not come back, so its absence is still pinned:
 * a half-reverted change that put the fields back without their validators would
 * otherwise ship a form that submits nothing.
 *
 * The load-bearing assertion in here is "does not advance on a rejected send".
 * Every OTP throttle the server owns arrives as a rejection, so a page that
 * reveals the code boxes optimistically shows a countdown for an SMS that was
 * never sent.
 */

class StubAuthService {
  googleCalls = 0;
  tokenCalls: string[] = [];
  fails = false;

  async loginWithGoogle(): Promise<void> {
    this.googleCalls += 1;

    if (this.fails) {
      throw Object.assign(new Error('nope'), { code: 'auth/popup-closed-by-user' });
    }
  }

  async loginWithToken(token: string): Promise<void> {
    this.tokenCalls.push(token);
  }

  describeError(): string {
    return 'Sign-in was cancelled.';
  }

  describeOtpError(error: unknown): string {
    return (error as { message?: string })?.message ?? 'OTP failed.';
  }
}

class StubOtpService {
  requested: { countryCode: string; phoneNumber: string }[] = [];
  verified: string[] = [];
  sendError: unknown = null;
  verifyError: unknown = null;

  async requestOtp(countryCode: string, phoneNumber: string): Promise<void> {
    this.requested.push({ countryCode, phoneNumber });

    if (this.sendError) {
      throw this.sendError;
    }
  }

  async verifyOtp(_c: string, _p: string, code: string): Promise<string> {
    this.verified.push(code);

    if (this.verifyError) {
      throw this.verifyError;
    }

    return 'custom-token';
  }
}

describe('Login', () => {
  let fixture: ComponentFixture<Login>;
  let component: Login;
  let auth: StubAuthService;
  let otp: StubOtpService;
  let navigated: unknown[][];

  /** Gets the form to the point where Send OTP is enabled. */
  function fillValidNumber(): void {
    component.onPhoneInput('9999900004');
    fixture.detectChanges();
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
    auth = new StubAuthService();
    otp = new StubOtpService();

    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: OtpService, useValue: otp }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(Login);
    component = fixture.componentInstance;

    navigated = [];
    vi.spyOn(TestBed.inject(Router), 'navigate').mockImplementation((...args: unknown[]) => {
      navigated.push(args);
      return Promise.resolve(true);
    });

    fixture.detectChanges();
  });

  afterEach(() => {
    // The countdown is a real interval. Left running it bleeds ticks into the
    // next test's signal reads.
    fixture.destroy();
  });

  /* ---- What the page offers ---------------------------------------------- */

  it('leads with the mobile number and offers no email or password field', () => {
    expect(fixture.nativeElement.querySelector('#mobile')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#email')).toBeNull();
    expect(fixture.nativeElement.querySelector('#password')).toBeNull();
  });

  it('offers Google as the second route, under a divider', () => {
    // The divider came back with the second provider. With one route there was
    // nothing to separate and it was removed.
    expect(fixture.nativeElement.querySelector('.divider')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.google-btn').textContent)
      .toContain('Sign in with Google');
  });

  /* ---- Sending the code -------------------------------------------------- */

  it('will not send until the number is valid', () => {
    const button = () => fixture.nativeElement.querySelector('.send-btn') as HTMLButtonElement;

    expect(button().disabled).toBe(true);

    component.onPhoneInput('99999');
    fixture.detectChanges();
    expect(button().disabled).toBe(true);

    component.onPhoneInput('9999900004');
    fixture.detectChanges();
    expect(button().disabled).toBe(false);
  });

  /**
   * The page is authentication only. The production login collects consent for
   * marketing across email, SMS, WhatsApp and Telegram; that was removed on
   * instruction and its absence is pinned here so it cannot drift back in.
   */
  it('carries no consent checkbox or communication copy', () => {
    expect(fixture.nativeElement.querySelector('.consent')).toBeNull();
    expect(fixture.nativeElement.querySelector('input[type="checkbox"]')).toBeNull();

    const text = fixture.nativeElement.textContent as string;
    for (const word of ['Raman', 'WhatsApp', 'Telegram', 'consent', 'withdraw']) {
      expect(text).not.toContain(word);
    }
  });

  it('rejects a number that is not ten digits opening 6 to 9', () => {
    component.onPhoneInput('1234567890');
    expect(component.phoneValid()).toBe(false);

    component.onPhoneInput('99999000');
    expect(component.phoneValid()).toBe(false);

    component.onPhoneInput('9999900004');
    expect(component.phoneValid()).toBe(true);
  });

  it('strips a pasted +91 and any punctuation from the number', () => {
    component.onPhoneInput('+91 99999-00004');
    expect(component.phoneNumber()).toBe('9999900004');
  });

  it('reveals the code step only after the send resolves', async () => {
    fillValidNumber();

    await component.sendCode();
    fixture.detectChanges();

    expect(otp.requested).toEqual([{ countryCode: '+91', phoneNumber: '9999900004' }]);
    expect(component.step()).toBe('code');
    expect(fixture.nativeElement.querySelectorAll('.digit').length).toBe(6);
    // The countdown starts with the step, not before it.
    expect(component.resendIn()).toBeGreaterThan(0);
  });

  /**
   * THE ONE THAT MATTERS. A rejected send means no SMS went out, so showing the
   * code boxes and counting down would be describing something that did not
   * happen.
   */
  it('stays on the number step and shows why when the send is rejected', async () => {
    otp.sendError = Object.assign(new Error('Daily OTP limit reached.'), {
      code: 'functions/resource-exhausted'
    });
    fillValidNumber();

    await component.sendCode();
    fixture.detectChanges();

    expect(component.step()).toBe('phone');
    expect(component.resendIn()).toBe(0);
    expect(fixture.nativeElement.querySelectorAll('.digit').length).toBe(0);
    expect(fixture.nativeElement.querySelector('.form-error').textContent)
      .toContain('Daily OTP limit reached.');
  });

  /* ---- Entering the code ------------------------------------------------- */

  it('spreads a pasted code across the boxes', async () => {
    fillValidNumber();
    await component.sendCode();

    component.onDigitInput(0, '123456');
    fixture.detectChanges();

    expect(component.code()).toBe('123456');
    expect(component.codeComplete()).toBe(true);
  });

  it('verifies the code, exchanges the token and lands on the dashboard', async () => {
    fillValidNumber();
    await component.sendCode();

    component.onDigitInput(0, '123456');
    await component.verifyCode();

    expect(otp.verified).toEqual(['123456']);
    expect(auth.tokenCalls).toEqual(['custom-token']);
    expect(navigated).toEqual([[['/dashboard']]]);
  });

  it('clears the boxes and reports when the code is wrong', async () => {
    otp.verifyError = Object.assign(new Error('Incorrect OTP'), {
      code: 'functions/permission-denied'
    });
    fillValidNumber();
    await component.sendCode();

    component.onDigitInput(0, '000000');
    await component.verifyCode();
    fixture.detectChanges();

    // Left in place, the same wrong value gets resubmitted against a server that
    // counts every attempt and locks the challenge at five.
    expect(component.code()).toBe('');
    expect(navigated).toEqual([]);
    expect(fixture.nativeElement.querySelector('.form-error').textContent)
      .toContain('Incorrect OTP');
  });

  it('goes back to the number, clearing the code behind it', async () => {
    fillValidNumber();
    await component.sendCode();
    component.onDigitInput(0, '123456');

    component.changeNumber();
    fixture.detectChanges();

    expect(component.step()).toBe('phone');
    expect(component.code()).toBe('');
    expect(component.resendIn()).toBe(0);
    expect(fixture.nativeElement.querySelector('#mobile')).not.toBeNull();
  });

  /* ---- Google, still there ---------------------------------------------- */

  it('signs in with Google and lands on the dashboard', async () => {
    (fixture.nativeElement.querySelector('.google-btn') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(auth.googleCalls).toBe(1);
    expect(navigated).toEqual([[['/dashboard']]]);
  });

  it('reports a Google failure and stays put', async () => {
    auth.fails = true;

    await component.signInWithGoogle();
    fixture.detectChanges();

    expect(component.errorMessage()).toBe('Sign-in was cancelled.');
    expect(navigated).toEqual([]);
  });

  /** One action at a time: the union cannot hold two, and every button reads it. */
  it('refuses a second action while one is in flight', async () => {
    component.pending.set('google');
    fixture.detectChanges();

    expect((fixture.nativeElement.querySelector('.google-btn') as HTMLButtonElement).disabled)
      .toBe(true);
    expect((fixture.nativeElement.querySelector('.send-btn') as HTMLButtonElement).disabled)
      .toBe(true);

    await component.signInWithGoogle();
    expect(auth.googleCalls).toBe(0);

    await component.sendCode();
    expect(otp.requested).toEqual([]);
  });

  /* ---- The hero copy ----------------------------------------------------- */

  it('names the three modules the app actually has, as chips', () => {
    const names = Array.from(
      fixture.nativeElement.querySelectorAll('.hero-module') as NodeListOf<HTMLElement>
    ).map(el => el.textContent!.trim());

    expect(names).toEqual(['Institutions', 'Classrooms', 'Programmes']);

    const hero = fixture.nativeElement.querySelector('.hero-panel').textContent as string;

    // The four that were removed on instruction stay removed. They are the
    // production hero's chips, and none of them exists behind this sign-in.
    for (const gone of ['Tactivities', 'Contest Management', 'Progress Analytics',
                        'WhatsApp Sync', 'Smart Classrooms']) {
      expect(hero).not.toContain(gone);
    }
  });

  /**
   * The chips are one line each, so the summaries in HERO_MODULES are not
   * rendered. Pinned as an expectation rather than left implicit: the copy is
   * still in the data file, and a half-restored two-line layout would otherwise
   * show a summary inside a pill sized for a single word.
   */
  it('does not render the module summaries inside the chips', () => {
    const hero = fixture.nativeElement.querySelector('.hero-panel').textContent as string;

    for (const summary of ['schools, boards and locations',
                           'regular classes and STEM clubs',
                           'templates and learning units']) {
      expect(hero).not.toContain(summary);
    }
  });

  it('carries no invented statistics', () => {
    // The four floating stat cards were removed with their hardcoded figures; a
    // signed-out page cannot keep an invented number honest. See hero-content.ts.
    const hero = fixture.nativeElement.querySelector('.hero-panel').textContent as string;

    for (const figure of ['248', '1,240', '4.8', '84,500']) {
      expect(hero).not.toContain(figure);
    }
  });
});

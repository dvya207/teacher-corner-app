import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { AuthService } from '../../services/auth.service';
import { TeacherService } from '../../services/teacher.service';
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

  /** The session the login page reads back to identify who just signed in. */
  uid: string | null = 'uid-1';
  currentUser: { displayName?: string; email?: string; phoneNumber?: string } | null = {
    displayName: 'Divya Jain',
    email: 'divya@example.com'
  };

  currentUid(): string | null {
    return this.uid;
  }
}

/**
 * Records what the login page asks for, so the two sign-in paths can be held to
 * the same promise.
 */
class StubTeacherService {
  ensured: Record<string, unknown>[] = [];
  fails = false;

  async ensureRecordForSignedInUser(identity: Record<string, unknown>): Promise<string | null> {
    this.ensured.push(identity);

    if (this.fails) {
      throw new Error('firestore is unreachable');
    }

    return 'teacher-doc-1';
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
  let teachers: StubTeacherService;
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
    teachers = new StubTeacherService();
    otp = new StubOtpService();

    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: OtpService, useValue: otp },
        { provide: TeacherService, useValue: teachers }
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

  /*
   * A NUMBER THAT LEGITIMATELY BEGINS 91.
   *
   * Indian mobiles start 6-9, so 91xxxxxxxx is a real series. The dial-code
   * strip used to fire on the PREFIX, so with +91 selected these numbers lost
   * their first two digits as they were typed: 9180000000 became 80000000, eight
   * digits, silently. Stripping is now decided by LENGTH — only a number that is
   * exactly dial + a full local number has a dial code on it.
   */
  it('keeps a ten-digit number that starts with 91', () => {
    component.onPhoneInput('9180000000');
    expect(component.phoneNumber()).toBe('9180000000');
    expect(component.phoneValid()).toBe(true);
  });

  it('keeps every digit of 9199887766', () => {
    component.onPhoneInput('9199887766');
    expect(component.phoneNumber()).toBe('9199887766');
  });

  it('still strips the dial code from a pasted 91-prefixed 91 number', () => {
    // Twelve digits: 91 + 9180000000. The only shape that really has a dial code.
    component.onPhoneInput('919180000000');
    expect(component.phoneNumber()).toBe('9180000000');
  });

  it('does not eat the leading 91 of a half-typed number', () => {
    // Eleven digits, mid-typing. Trimmed from the END by maxDigits; the first two
    // digits must survive.
    component.onPhoneInput('91800000001');
    expect(component.phoneNumber()).toBe('9180000000');
  });

  it('builds up 91… digit by digit without losing any', () => {
    // The real failure was per-keystroke, so type it the way a teacher does.
    const typed = '9180000000';
    for (let i = 1; i <= typed.length; i++) {
      component.onPhoneInput(typed.slice(0, i));
      expect(component.phoneNumber()).toBe(typed.slice(0, i));
    }
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

/**
 * EVERY SIGNED-IN ACCOUNT ENDS UP WITH A TEACHER RECORD.
 *
 * This is the precondition for everything stored under `teachers/{docId}` —
 * completion, activity progress, submissions. It was not true before: only the
 * OTP path linked, only against a record an administrator had already
 * registered, so a number matching nothing and every Google sign-in stayed
 * unlinked. Measured on the dev database, 7 of 13 accounts had no record.
 *
 * Both paths are asserted because the Google one is the one that was missing,
 * and a future edit is far more likely to add a third path than to break the
 * first.
 */
describe('Login ensures a teacher record exists', () => {
  let fixture: ComponentFixture<Login>;
  let component: Login;
  let auth: StubAuthService;
  let teachers: StubTeacherService;
  let otp: StubOtpService;
  let navigated: unknown[][];

  beforeEach(async () => {
    TestBed.resetTestingModule();
    auth = new StubAuthService();
    teachers = new StubTeacherService();
    otp = new StubOtpService();

    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: OtpService, useValue: otp },
        { provide: TeacherService, useValue: teachers }
      ]
    }).compileComponents();

    navigated = [];
    const router = TestBed.inject(Router);

    router.navigate = (...args: unknown[]) => {
      navigated.push(args);

      return Promise.resolve(true);
    };

    fixture = TestBed.createComponent(Login);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  async function signInWithOtp(): Promise<void> {
    component.onPhoneInput('9999900004');
    fixture.detectChanges();
    await component.sendCode();
    component.onDigitInput(0, '123456');
    fixture.detectChanges();
    await component.verifyCode();
  }

  it('ensures a record on the OTP path, carrying the number from the form', async () => {
    await signInWithOtp();

    expect(teachers.ensured).toHaveLength(1);
    expect(teachers.ensured[0]['uid']).toBe('uid-1');
    // The FORM's number, which is what an administrator would have registered,
    // not whatever the auth record happens to carry.
    expect(teachers.ensured[0]['phoneNumber']).toBe('9999900004');
  });

  /** The path that used to do nothing at all. */
  it('ensures a record on the GOOGLE path too', async () => {
    await component.signInWithGoogle();

    expect(auth.googleCalls).toBe(1);
    expect(teachers.ensured).toHaveLength(1);
    expect(teachers.ensured[0]['uid']).toBe('uid-1');
    // No number from Google; the email and name are what identify the person.
    expect(teachers.ensured[0]['email']).toBe('divya@example.com');
    expect(teachers.ensured[0]['firstName']).toBe('Divya');
    expect(teachers.ensured[0]['lastName']).toBe('Jain');
  });

  it('still lands on the dashboard when the record cannot be written', async () => {
    // BEST EFFORT. Bookkeeping must never cost somebody their sign-in.
    teachers.fails = true;

    await signInWithOtp();

    expect(navigated).toEqual([[['/dashboard']]]);
  });

  it('still lands on the dashboard when the session has no uid', async () => {
    // Gathering the identity happens inside the try for exactly this reason.
    auth.uid = null;
    auth.currentUser = null;

    await signInWithOtp();

    expect(teachers.ensured).toHaveLength(0);
    expect(navigated).toEqual([[['/dashboard']]]);
  });
});

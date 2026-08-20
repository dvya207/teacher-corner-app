import {
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  viewChildren
} from '@angular/core';
import { Router } from '@angular/router';

import { Icon } from '../../components/icon/icon';
import { Logo } from '../../components/logo/logo';
import { firebaseConfigured } from '../../core/firebase';
import { HERO_MODULES } from '../../data/hero-content';
import { DEFAULT_DIAL, DIAL_CODES } from '../../data/countries';
import { AuthService } from '../../services/auth.service';
import { TeacherService } from '../../services/teacher.service';
import { OTP_CODE_LENGTH, OTP_RESEND_SECONDS, OtpService } from '../../services/otp.service';

/**
 * Indian mobile numbers: ten digits opening 6 to 9.
 *
 * Applied only when +91 is selected. India is the overwhelmingly common case here and
 * a mistyped number costs a real SMS, so it is worth checking properly rather than
 * letting the server's looser rule catch it after the send.
 */
const INDIAN_NUMBER = /^[6-9]\d{9}$/;

/**
 * What the server accepts for every other country: 6 to 15 digits.
 *
 * Deliberately the SAME rule the callable enforces (normalizePhone's /^\d{6,15}$/),
 * because the client has no basis for anything tighter. Guessing at national formats
 * for two hundred countries would reject valid numbers, which is a worse failure than
 * a rejected send.
 */
const INTERNATIONAL_NUMBER = /^\d{6,15}$/;

type Step = 'phone' | 'code';

/**
 * Teacher sign-in.
 *
 * ZONELESS. zone.js is not installed and Angular 21 defaults ZONELESS_ENABLED
 * to true, so change detection only runs when something notifies the scheduler
 * — a template event listener, a signal write, or an explicit markForCheck. A
 * plain field assigned inside a promise continuation notifies nothing, so the
 * write lands in the component and never reaches the DOM.
 *
 * Every submit path does its real work after an `await`, and the resend
 * countdown writes from a timer callback, which is the same situation. The rule
 * applied below: anything the template reads AND anything mutated after an await
 * or inside a timer is a signal.
 */
@Component({
  selector: 'app-login',
  imports: [Icon, Logo],
  templateUrl: './login.html',
  styleUrl: './login.css'
})
export class Login implements OnDestroy {

  // Static presentation data. Read once by the template, never reassigned, so
  // a plain readonly field is enough.
  readonly heroModules = HERO_MODULES;

  /** Drives the setup banner. False until environment.ts holds a real config. */
  readonly configured = firebaseConfigured;

  /**
   * Every distinct dial code, with a flag and a country name.
   *
   * READ FROM THE CONSTANT, not from the Configuration collection, and that is not an
   * oversight: Configuration requires an authenticated reader and this page is the one
   * place in the app where nobody is signed in yet. DIAL_CODES is the same list
   * ConfigurationService falls back to, so the two cannot disagree.
   */
  readonly dialCodes = DIAL_CODES;

  /** The chosen dial code. Defaults to India's, which is what the placeholder assumes. */
  readonly countryCode = signal(DEFAULT_DIAL);

  /** Rendered as one box per digit, so the template needs something to iterate. */
  readonly slots = Array.from({ length: OTP_CODE_LENGTH }, (_, i) => i);

  /**
   * Which step the form is on.
   *
   * The code step is reached ONLY after requestOtp resolves. Revealing it
   * optimistically would show a code box and start a countdown for an SMS the
   * server may have refused to send, which is precisely the failure the server's
   * rate limits are there to report.
   */
  readonly step = signal<Step>('phone');

  readonly phoneNumber = signal('');
  readonly digits = signal<string[]>(Array(OTP_CODE_LENGTH).fill(''));

  /**
   * Which action is in flight, or null. A union rather than three booleans,
   * because they are mutually exclusive and a union cannot represent two at once.
   */
  readonly pending = signal<'send' | 'verify' | 'google' | null>(null);

  readonly errorMessage = signal('');

  /** Seconds until Resend is offered again. Zero means it is available. */
  readonly resendIn = signal(0);

  private auth = inject(AuthService);
  private otp = inject(OtpService);
  private teachers = inject(TeacherService);
  private router = inject(Router);

  private readonly digitInputs = viewChildren<ElementRef<HTMLInputElement>>('digitInput');

  private ticker: ReturnType<typeof setInterval> | null = null;

  /**
   * The countdown outlives the component otherwise. Sign-in succeeds, the router
   * swaps this page out, and the interval keeps firing against a signal nothing
   * renders — once per second, for the rest of the session.
   */
  ngOnDestroy(): void {
    this.stopCountdown();
  }

  constructor() {
    // Focus the first empty box whenever the code step appears, so the teacher
    // types straight into it instead of hunting for it after reading the SMS.
    effect(() => {
      if (this.step() === 'code') {
        this.focusFirstEmpty();
      }
    });
  }

  readonly busy = computed(() => this.pending() !== null);

  readonly isIndia = computed(() => this.countryCode() === '+91');

  readonly phoneValid = computed(() =>
    this.isIndia()
      ? INDIAN_NUMBER.test(this.phoneNumber())
      : INTERNATIONAL_NUMBER.test(this.phoneNumber())
  );

  /** Placeholder and maxlength both follow the selected country. */
  readonly numberHint = computed(() =>
    this.isIndia() ? '10-digit mobile number' : 'Mobile number'
  );

  readonly maxDigits = computed(() => (this.isIndia() ? 10 : 15));

  /**
   * A valid number and nothing in flight. There is no consent checkbox: the code
   * is a transactional SMS the teacher asked for by pressing the button, and the
   * broader marketing consent the production page collects (email, SMS, WhatsApp,
   * Telegram) is not this page's business.
   */
  readonly canSend = computed(() => this.phoneValid() && !this.busy());

  readonly code = computed(() => this.digits().join(''));

  readonly codeComplete = computed(() => this.code().length === OTP_CODE_LENGTH);

  /** What the SMS was sent to, echoed on the code step so a typo is visible. */
  readonly sentTo = computed(() => `${this.countryCode()} ${this.phoneNumber()}`);

  onCountryChange(code: string): void {
    this.countryCode.set(code);
    // A number valid for one country is rarely valid for another, and leaving it in
    // place invites sending to a mangled international number.
    this.phoneNumber.set('');
    this.errorMessage.set('');
  }

  onPhoneInput(value: string): void {
    // Digits only. Paste is the common case: a number copied from a contact card
    // arrives with spaces, dashes or a +91 already on the front.
    const digits = value.replace(/\D/g, '');
        // Strip a pasted dial code only when it matches the SELECTED one, so choosing
    // +1 and pasting a number starting 91 does not silently lose two digits.
    const dial = this.countryCode().replace('+', '');
    const withoutDial = digits.startsWith(dial) ? digits.slice(dial.length) : digits;

    this.phoneNumber.set(withoutDial.slice(0, this.maxDigits()));
    this.errorMessage.set('');
  }

  async sendCode(): Promise<void> {
    if (!this.canSend()) {
      return;
    }

    this.errorMessage.set('');
    this.pending.set('send');

    try {
      await this.otp.requestOtp(this.countryCode(), this.phoneNumber());

      // Only now, after the server confirmed the send.
      this.digits.set(Array(OTP_CODE_LENGTH).fill(''));
      this.step.set('code');
      this.startCountdown();
    } catch (error) {
      this.errorMessage.set(this.auth.describeOtpError(error));
    } finally {
      this.pending.set(null);
    }
  }

  async verifyCode(): Promise<void> {
    if (!this.codeComplete() || this.busy()) {
      return;
    }

    this.errorMessage.set('');
    this.pending.set('verify');

    try {
      const token = await this.otp.verifyOtp(this.countryCode(), this.phoneNumber(), this.code());
      await this.auth.loginWithToken(token);
      this.stopCountdown();
      await this.linkTeacherRecord();
      await this.router.navigate(['/dashboard']);
    } catch (error) {
      this.errorMessage.set(this.auth.describeOtpError(error));
      // Clear the boxes on a rejection. Leaving a wrong code in place invites
      // resubmitting the same value against a server that counts the attempt.
      this.digits.set(Array(OTP_CODE_LENGTH).fill(''));
      this.focusFirstEmpty();
    } finally {
      this.pending.set(null);
    }
  }

  /** Same call as the first send; the server owns the cooldown, not this. */
  async resend(): Promise<void> {
    if (this.resendIn() > 0 || this.busy()) {
      return;
    }

    this.errorMessage.set('');
    this.pending.set('send');

    try {
      await this.otp.requestOtp(this.countryCode(), this.phoneNumber());
      this.digits.set(Array(OTP_CODE_LENGTH).fill(''));
      this.startCountdown();
      this.focusFirstEmpty();
    } catch (error) {
      this.errorMessage.set(this.auth.describeOtpError(error));
    } finally {
      this.pending.set(null);
    }
  }

  /** Back to the number, so a typo does not require a page reload to fix. */
  changeNumber(): void {
    this.stopCountdown();
    this.errorMessage.set('');
    this.digits.set(Array(OTP_CODE_LENGTH).fill(''));
    this.step.set('phone');
  }

  async signInWithGoogle(): Promise<void> {
    if (this.busy()) {
      return;
    }

    this.errorMessage.set('');
    this.pending.set('google');

    try {
      await this.auth.loginWithGoogle();
      await this.router.navigate(['/dashboard']);
    } catch (error) {
      this.errorMessage.set(this.auth.describeError(error));
    } finally {
      this.pending.set(null);
    }
  }

  // ==========================================================================
  // Code entry: six boxes behaving as one field
  // ==========================================================================

  onDigitInput(index: number, value: string): void {
    const typed = value.replace(/\D/g, '');

    if (!typed) {
      this.writeDigit(index, '');
      return;
    }

    // A paste into any box fills from that box onwards, rather than dropping
    // five of the six characters.
    if (typed.length > 1) {
      this.fillFrom(index, typed);
      return;
    }

    this.writeDigit(index, typed);
    this.focusSlot(index + 1);
  }

  onDigitKeydown(index: number, event: KeyboardEvent): void {
    if (event.key === 'Backspace' && !this.digits()[index]) {
      // Already empty, so move back and clear the previous box. Without this,
      // backspace on an empty box does nothing and the row feels stuck.
      event.preventDefault();
      this.writeDigit(index - 1, '');
      this.focusSlot(index - 1);
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.focusSlot(index - 1);
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.focusSlot(index + 1);
      return;
    }

    if (event.key === 'Enter' && this.codeComplete()) {
      void this.verifyCode();
    }
  }

  onDigitPaste(index: number, event: ClipboardEvent): void {
    const pasted = event.clipboardData?.getData('text')?.replace(/\D/g, '') ?? '';

    if (!pasted) {
      return;
    }

    // Handled here rather than letting the input event see it, because the
    // native paste would put all six characters into one box first.
    event.preventDefault();
    this.fillFrom(index, pasted);
  }

  private fillFrom(index: number, characters: string): void {
    const next = [...this.digits()];

    for (let i = 0; i < characters.length && index + i < OTP_CODE_LENGTH; i++) {
      next[index + i] = characters[i];
    }

    this.digits.set(next);
    this.focusFirstEmpty();
  }

  private writeDigit(index: number, value: string): void {
    if (index < 0 || index >= OTP_CODE_LENGTH) {
      return;
    }

    const next = [...this.digits()];
    next[index] = value;
    this.digits.set(next);
  }

  private focusSlot(index: number): void {
    this.digitInputs()[index]?.nativeElement.focus();
  }

  private focusFirstEmpty(): void {
    const first = this.digits().findIndex(digit => !digit);
    this.focusSlot(first === -1 ? OTP_CODE_LENGTH - 1 : first);
  }

  // ==========================================================================
  // Resend countdown
  // ==========================================================================

  private startCountdown(): void {
    this.stopCountdown();
    this.resendIn.set(OTP_RESEND_SECONDS);

    this.ticker = setInterval(() => {
      const left = this.resendIn() - 1;
      this.resendIn.set(Math.max(0, left));

      if (left <= 0) {
        this.stopCountdown();
      }
    }, 1000);
  }

  /**
   * Clears the timer AND the value it was counting.
   *
   * Clearing only the timer leaves whatever second it stopped on in the signal,
   * and the template shows "Resend available in Ns" whenever that is above zero.
   * Stopping at 43 with no ticker behind it renders a countdown that never
   * counts and a Resend button that never appears.
   */
  /**
   * Fills in teacherMeta.uid on the record an admin registered for this number.
   *
   * AFTER the session exists, because the uid being recorded is this session's.
   *
   * SWALLOWED ON FAILURE, deliberately. This is bookkeeping that links a record to
   * an account; a refused write or a dropped network must not turn a successful
   * sign-in into an error the teacher can do nothing about. The next sign-in tries
   * again, since the field is only filled when blank.
   */
  private async linkTeacherRecord(): Promise<void> {
    try {
      await this.teachers.linkSignedInUid(this.phoneNumber(), this.auth.currentUid() ?? '');
    } catch (error) {
      console.error('Signed in, but could not link the teacher record to this account.', error);
    }
  }

  private stopCountdown(): void {
    if (this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }

    this.resendIn.set(0);
  }
}

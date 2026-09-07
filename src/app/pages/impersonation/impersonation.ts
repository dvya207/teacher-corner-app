import {
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChildren
} from '@angular/core';
import { Router } from '@angular/router';

import { Icon } from '../../components/icon/icon';
import { Logo } from '../../components/logo/logo';
import { HERO_MODULES } from '../../data/hero-content';
import { DEFAULT_DIAL, DIAL_CODES } from '../../data/countries';
import { AuthService } from '../../services/auth.service';
import { ImpersonationService, PASSCODE_LENGTH } from '../../services/impersonation.service';

/** Indian mobile numbers: ten digits opening 6 to 9. Login's rule, unchanged. */
const INDIAN_NUMBER = /^[6-9]\d{9}$/;

/** What the server accepts for everywhere else: 6 to 15 digits. */
const INTERNATIONAL_NUMBER = /^\d{6,15}$/;

/**
 * Admin impersonation — signing in AS a teacher, to see what they see.
 *
 * ONE STEP, not two. The sign-in page reveals its code boxes only after the
 * server confirms an SMS went out, because showing them earlier would be a lie
 * about something having been sent. Nothing is sent here: the passcode is a date
 * the administrator already knows, so both fields belong on screen together and
 * the passcode row simply waits for a plausible number, which is what
 * production's page does.
 *
 * WHAT THIS PAGE DELIBERATELY DOES NOT DO. Production compares the passcode in
 * the browser:
 *
 *   if (this.password != this.getPassword()) { return; }
 *
 * There is no comparison in this component at all, and the expected value is
 * never computed on this side either — the field is labelled with its FORMAT
 * ("today's date as DDMMYYYY") and nothing else. The passcode is sent to
 * tcDevImpersonate and checked there, against the server's clock, after the
 * caller's admin claim has been checked, so a reader of this bundle learns the
 * format and gains nothing else. It also means the two clocks cannot disagree:
 * only one of them is consulted.
 *
 * NO ROUTE GUARD AND NO SESSION AT ALL, so typing /impersonation always lands
 * here and the form works with nobody signed in — production's page is the same.
 * It briefly had authGuard, and then a session notice in its place; both went when
 * the requirement did. The only thing the caller must supply is a number that is
 * already in `users` or `teachers`, plus today's date, and the server is what
 * checks both. Nothing on this page decides anything.
 *
 * ZONELESS, so everything the template reads after an await is a signal — the
 * same rule the sign-in page documents at length.
 */
@Component({
  selector: 'app-impersonation',
  imports: [Icon, Logo],
  templateUrl: './impersonation.html',
  /**
   * SHARES THE SIGN-IN PAGE'S STYLESHEET rather than copying it.
   *
   * The two pages are the same split layout down to the hero decorations —
   * production's are too — and 560 lines of duplicated CSS would drift the first
   * time either was touched. Ordered so the local file comes second and can
   * override; it holds only what is specific to this page.
   */
  styleUrls: ['../login/login.css', './impersonation.css']
})
export class Impersonation {

  readonly heroModules = HERO_MODULES;
  readonly dialCodes = DIAL_CODES;

  /** One box per digit of DDMMYYYY. */
  readonly slots = Array.from({ length: PASSCODE_LENGTH }, (_unused, index) => index);

  readonly countryCode = signal(DEFAULT_DIAL);
  readonly phoneNumber = signal('');
  readonly digits = signal<string[]>(Array(PASSCODE_LENGTH).fill(''));

  readonly pending = signal(false);
  readonly errorMessage = signal('');

  /*
   * NO SESSION STATE HERE ANY MORE.
   *
   * This held a `signedIn` signal and a `hadSession` flag, to render "you are not
   * signed in" and to tell that apart from "your session has ended". Both are
   * gone: the endpoint requires no session, so there is nothing to report and
   * nothing to pre-check. The only requirement is on the NUMBER, and the server
   * is what knows whether it is in the users or teachers list.
   */

  private auth = inject(AuthService);
  private impersonation = inject(ImpersonationService);
  private router = inject(Router);

  private readonly digitInputs = viewChildren<ElementRef<HTMLInputElement>>('digitInput');

  readonly busy = computed(() => this.pending());

  readonly isIndia = computed(() => this.countryCode() === '+91');

  readonly phoneValid = computed(() =>
    this.isIndia()
      ? INDIAN_NUMBER.test(this.phoneNumber())
      : INTERNATIONAL_NUMBER.test(this.phoneNumber())
  );

  readonly numberHint = computed(() => (this.isIndia() ? '98XXXXXXXX' : 'Mobile number'));

  readonly maxDigits = computed(() => (this.isIndia() ? 10 : 15));

  readonly passcode = computed(() => this.digits().join(''));

  readonly passcodeComplete = computed(() => this.passcode().length === PASSCODE_LENGTH);

  /**
   * The passcode row appears once the number could plausibly be real.
   *
   * Not a security measure — nothing on this page is. It keeps the form to one
   * field until there is a number to impersonate, which is the order the two
   * fields are actually filled in and what the reference screenshots show.
   */
  readonly showPasscode = computed(() => this.phoneValid());

  readonly canSubmit = computed(
    () => this.phoneValid() && this.passcodeComplete() && !this.busy()
  );

  /** False until tcDevImpersonate is deployed; drives the banner. */
  readonly provisioned = this.impersonation.available;

  onCountryChange(code: string): void {
    this.countryCode.set(code);
    this.phoneNumber.set('');
    this.errorMessage.set('');
  }

  /**
   * Digits only, with a pasted dial code stripped only when the length says it
   * is one. Login's rule, copied WITH its reasoning intact: "starts with 91"
   * also matches a real Indian mobile beginning 91, and treating that as a dial
   * code silently ate the first two digits of valid numbers.
   */
  onPhoneInput(value: string): void {
    const digits = value.replace(/\D/g, '');
    const dial = this.countryCode().replace('+', '');
    const withoutDial =
      digits.length === dial.length + this.maxDigits() && digits.startsWith(dial)
        ? digits.slice(dial.length)
        : digits;

    this.phoneNumber.set(withoutDial.slice(0, this.maxDigits()));
    this.errorMessage.set('');
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }

    /*
     * NO SESSION PRE-CHECK. There was one, and it went with the requirement: the
     * callable no longer needs an ID token, so a missing session is not a reason
     * to refuse before asking. The only refusals left come from the server — wrong
     * passcode, throttled, or a number that is in neither collection.
     */
    this.errorMessage.set('');
    this.pending.set(true);

    try {
      const result = await this.impersonation.impersonate(
        this.countryCode(),
        this.phoneNumber(),
        this.passcode()
      );

      /*
       * loginByImpersonation, NOT loginWithToken.
       *
       * The latter stamps the teacher's own users/{uid} record with a sign-in
       * that did not happen, which would make a support visit indistinguishable
       * from the teacher's own activity in the one place anyone would look.
       */
      await this.auth.loginByImpersonation(result.token);
      await this.router.navigate(['/dashboard']);
    } catch (error) {
      this.errorMessage.set(this.auth.describeImpersonationError(error));
      // Clear the passcode, keep the number. A refusal is nearly always the
      // passcode, and retyping a ten-digit number for it is a needless step.
      this.digits.set(Array(PASSCODE_LENGTH).fill(''));
      this.focusFirstEmpty();
    } finally {
      this.pending.set(false);
    }
  }

  // ==========================================================================
  // The passcode boxes: eight inputs behaving as one field
  //
  // Same behaviour as the sign-in page's code row — arrows and backspace move
  // between boxes, a paste fills across them — because it is the same control
  // with a different length, and an administrator who has used one should not
  // have to discover that the other behaves differently.
  // ==========================================================================

  onDigitInput(index: number, value: string): void {
    const typed = value.replace(/\D/g, '');

    if (!typed) {
      this.writeDigit(index, '');
      return;
    }

    if (typed.length > 1) {
      this.fillFrom(index, typed);
      return;
    }

    this.writeDigit(index, typed);
    this.focusSlot(index + 1);
  }

  onDigitKeydown(index: number, event: KeyboardEvent): void {
    if (event.key === 'Backspace' && !this.digits()[index]) {
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

    if (event.key === 'Enter' && this.canSubmit()) {
      void this.submit();
    }
  }

  onDigitPaste(index: number, event: ClipboardEvent): void {
    const pasted = event.clipboardData?.getData('text')?.replace(/\D/g, '') ?? '';

    if (!pasted) {
      return;
    }

    event.preventDefault();
    this.fillFrom(index, pasted);
  }

  private fillFrom(index: number, characters: string): void {
    const next = [...this.digits()];

    for (let i = 0; i < characters.length && index + i < PASSCODE_LENGTH; i++) {
      next[index + i] = characters[i];
    }

    this.digits.set(next);
    this.focusFirstEmpty();
  }

  private writeDigit(index: number, value: string): void {
    if (index < 0 || index >= PASSCODE_LENGTH) {
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
    this.focusSlot(first === -1 ? PASSCODE_LENGTH - 1 : first);
  }
}

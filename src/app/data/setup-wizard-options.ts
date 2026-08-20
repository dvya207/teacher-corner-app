/**
 * The Set Up Wizard's own vocabulary.
 *
 * SEPARATE FROM `WIZARD_STEPS` in institution-options.ts, which is a different
 * wizard: that one is the three-step Add Institution MODAL (Institution Info →
 * Programme Template → Review). This one is the page at /setup-wizard, which
 * starts by PICKING an existing institution and then fills it with people. Two
 * constants rather than one shared list, because the only thing they have in
 * common is being rendered by a stepper.
 *
 * TWO STEPS, DOWN FROM FIVE. Production's stepper also shows "Add STEM Club
 * Teachers", "Add Students" and "Add STEM Club Students"; all three were removed
 * on instruction. They were never built — each rendered a stub saying so — so
 * nothing was lost but the stepper no longer advertises work that does not exist.
 * Restoring one means adding it back here and giving it a branch in
 * setup-wizard.html; nothing else in the wizard is hard-coded to a step count.
 *
 * Labels are production's verbatim, so the two products read the same to a
 * teacher moving between them.
 */

export interface SetupStep {
  /** 1-based, and what the circle renders when the step is neither done nor current. */
  readonly index: number;
  readonly label: string;
}

export const SETUP_WIZARD_STEPS: readonly SetupStep[] = [
  { index: 1, label: 'Institution Selection' },
  { index: 2, label: 'Add Teachers' }
] as const;

export const FIRST_STEP = 1;
export const LAST_STEP = SETUP_WIZARD_STEPS.length;

/**
 * The order step 1's controls unlock in.
 *
 * Shared with form-flow.ts's `isFieldLocked`, which is how every other create
 * form in this app gates its fields — so the wizard unlocks top to bottom for the
 * same reason and by the same code, rather than with a hand-written condition per
 * control.
 *
 * Country is first and starts populated, so pincode is open on first paint.
 */
export const STEP_ONE_FIELDS = ['country', 'pincode', 'board', 'school'] as const;

export type StepOneField = (typeof STEP_ONE_FIELDS)[number];

/** The message shown under a control the user left empty. */
export const STEP_ONE_ERRORS: Readonly<Record<StepOneField, string>> = {
  country: 'Country is required',
  pincode: 'Pincode is required',
  board: 'Board is required',
  // Production's wording, which is not "School is required." with a full stop.
  school: 'School is required'
};

/**
 * Whether the pincode is finished being typed, and so worth filtering schools on.
 *
 * Checked rather than merely non-empty because the School list is DERIVED from
 * this value: a half-typed "577" matches nothing, and a form that silently shows
 * an empty School list is indistinguishable from one whose lookup is broken.
 *
 * COUNTRY-AWARE, because the Country select above it is not fixed to India. An
 * Indian PIN is exactly six digits and never starts with zero; for anywhere else
 * this app has no format to assert, so any non-empty value counts as complete
 * rather than being rejected against a rule that does not apply to it.
 */
export function isCompletePincode(raw: string, country: string): boolean {
  const value = (raw ?? '').trim();

  if (country === 'India') {
    return /^[1-9][0-9]{5}$/.test(value);
  }

  return value.length > 0;
}

/**
 * What the pincode input accepts as you type.
 *
 * Digits only and capped at six for India, matching the format asserted above.
 * Elsewhere postal codes contain letters and spaces — "SW1A 1AA" — so the value
 * is passed through untouched apart from trimming the length to something sane.
 */
export function toPincodeDigits(raw: string, country: string): string {
  const value = raw ?? '';

  if (country === 'India') {
    return value.replace(/\D/g, '').slice(0, 6);
  }

  return value.slice(0, 12);
}

/**
 * Controlled vocabulary and validation for the Set Up Wizard's Add Teachers step.
 *
 * Static rather than a Firestore lookup, for the same reason the institution
 * vocabularies are: these change with a code release, not with user data.
 *
 * ONE ENTRY IS NOT A TEACHER DOCUMENT. This is what the FORM collects — four
 * fields the user types. The Firestore shape a teacher is eventually stored in is
 * deliberately not modelled here, because nothing writes one yet; when it is,
 * this becomes the input to that draft rather than being replaced by it.
 */

/**
 * One class a teacher takes.
 *
 * A TEACHER TAKES MANY. The reference's ⊕ appends another of these under the one
 * set of contact details, not another teacher — so this is the repeated unit and
 * the teacher above it is not.
 */
export interface TeacherClassroomEntry {
  /**
   * Stored bare — '1', not 'Class 1'. `gradeLabel()` in classroom-options.ts is
   * what the control shows; prettifying the stored value would write something no
   * other screen and no imported row would match.
   */
  grade: string;
  /** A–Z, or production's 'NA' for a school that does not section its grades. */
  section: string;
  /**
   * A programmes/{docId} from the chosen institution's catalogue.
   *
   * NOT A CLASSROOM. This briefly asked for one instead, which production's own
   * Add Teachers step does not: it collects grade, section and programme, and the
   * classroom is resolved from them. Reverted to match.
   */
  programmeId: string;
}



/**
 * The shape the form needs to recognise a number it has seen before.
 *
 * A structural subset of `Teacher`, declared here rather than importing the model
 * so the form stays a form: it matches on a phone and copies four fields, and
 * knows nothing about institutions, trash or timestamps. A real Teacher satisfies
 * it, so the wizard passes its list straight through.
 */
export interface KnownTeacher {
  docId: string;
  countryCode: string;
  phoneNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

export interface TeacherEntry {
  /** Subscriber digits only — no dial code, no separators, exactly as the institution forms store phone. */
  phone: string;
  /** The one OPTIONAL field. Everything else is required. */
  email: string;
  firstName: string;
  lastName: string;
  role: string;

  /** The classrooms this teacher takes. At least one, and the ⊕ adds more. */
  classrooms: TeacherClassroomEntry[];

  /**
   * The teachers/{docId} this phone number already belongs to, or ''.
   *
   * SET BY LOOKUP, never typed. Its presence is what tells the wizard to append
   * these classrooms to somebody who exists rather than writing a second teacher
   * with the same phone number.
   */
  existingId: string;
}

/**
 * PRODUCTION'S LIST, confirmed from the opened control.
 *
 * TWO ROLES, AND THAT IS THE WHOLE VOCABULARY. An earlier version of this file
 * inferred five from a screenshot that only showed the control at rest; the
 * dropdown was later opened and holds exactly these. Anything longer is a guess
 * being reintroduced.
 *
 * "ThinkTac Coach" is not a school employee — it is ThinkTac's own person
 * attached to the school — which is why the pair is not two flavours of teacher
 * and why neither can be derived from the other.
 */
export const TEACHER_ROLES = [
  'School Teacher',
  'ThinkTac Coach'
] as const;

export type TeacherRole = (typeof TEACHER_ROLES)[number];

/**
 * What the Teacher Role control opens on.
 *
 * A REAL DEFAULT, not an empty placeholder. The reference shows "School Teacher"
 * in the resting control, and rendering that as a placeholder ABOVE a list that
 * also contains "School Teacher" put the same words in the dropdown twice — one
 * of them unselectable. Role is not a required field, so defaulting it costs
 * nothing and the commonest answer is already correct.
 */
export const DEFAULT_TEACHER_ROLE: TeacherRole = 'School Teacher';

/**
 * What the Grade control opens on.
 *
 * A real default for the same reason the role has one: the reference shows
 * "Class 1" in the resting control rather than a placeholder. Section and
 * Programme get NO default — the reference shows "Select" and an empty box, and
 * guessing either would be guessing which class a teacher takes.
 */
export const DEFAULT_TEACHER_GRADE = '1';

/**
 * A blank class row.
 *
 * Grade opens on Class 1 as the reference does; Section and Programme get no
 * default, because guessing either would be guessing which class a teacher takes.
 */
export function emptyClassroomEntry(): TeacherClassroomEntry {
  return { grade: DEFAULT_TEACHER_GRADE, section: '', programmeId: '' };
}

/**
 * A blank teacher, WITH NO CLASS ROWS.
 *
 * The Grade/Section/Programme controls are hidden until the ⊕ is pressed, so a
 * fresh form starts with an empty list rather than one blank row. A teacher can
 * therefore be registered without a class — see isCompleteEntry.
 */
export function emptyTeacherEntry(): TeacherEntry {
  return {
    phone: '',
    email: '',
    firstName: '',
    lastName: '',
    role: DEFAULT_TEACHER_ROLE,
    classrooms: [],
    existingId: ''
  };
}

/**
 * The registered teacher this number belongs to, or undefined.
 *
 * Matched on the SUBSCRIBER DIGITS ALONE, not on the dial code too. The form's
 * prefix is fixed by step 1's country, so a stored teacher on a different dial
 * code cannot be reached from here anyway — and requiring both would silently
 * fail to recognise rows written before a country was ever varied.
 *
 * Only a COMPLETE number matches: a lookup on three digits would prefill from
 * whoever happened to share them.
 */
export function findKnownTeacher(
  known: readonly KnownTeacher[],
  phone: string
): KnownTeacher | undefined {
  if (!isValidPhone(phone)) {
    return undefined;
  }

  return known.find(teacher => teacher.phoneNumber === phone.trim());
}

/**
 * Digits only, capped at ten.
 *
 * The dial code is a separate, non-editable prefix, so a country code typed into
 * the field would store the country twice — the same rule the institution form's
 * `toSubscriberDigits` enforces, applied as you type rather than on save.
 */
export function toPhoneDigits(raw: string): string {
  return (raw ?? '').replace(/\D/g, '').slice(0, 10);
}

/** Exactly ten digits, which is what the reference's placeholder asks for. */
export function isValidPhone(raw: string): boolean {
  return /^[0-9]{10}$/.test((raw ?? '').trim());
}

/**
 * Email is OPTIONAL, so empty is valid and only a non-empty value is checked.
 *
 * Deliberately a loose shape check rather than a full RFC 5322 pattern: the
 * strict expression rejects addresses that genuinely deliver, and the only thing
 * this can honestly catch is a typo obvious enough to see.
 */
export function isValidEmail(raw: string): boolean {
  const value = (raw ?? '').trim();

  if (value === '') {
    return true;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Whether a row is complete enough to submit.
 *
 * SIX REQUIRED FIELDS, one optional. The reference asterisks Phone, First Name,
 * Last Name, Grade, Section and Programme; Email is explicitly "(optional)" and
 * Teacher Role carries no marker and has a default. Requiring more than the
 * reference does would block a form it accepts; requiring less would let a
 * teacher be filed against no class at all.
 */
export function isCompleteEntry(entry: TeacherEntry): boolean {
  return (
    isValidPhone(entry.phone) &&
    /*
     * EMAIL IS OPTIONAL AGAIN. It was briefly required, which contradicted both
     * this form's own label ("Email (optional)") and production's — so a blank
     * one held Submit dead while the label said it was fine to skip. A field that
     * blocks must say so.
     *
     * isValidEmail() passes '' by design, so this validates format only.
     */
    isValidEmail(entry.email) &&
    entry.firstName.trim() !== '' &&
    entry.lastName.trim() !== '' &&
    /**
     * AT LEAST ONE CLASS IS REQUIRED, on instruction.
     *
     * This reverses an earlier decision, and the reason it was optional still
     * applies: the Grade/Section/Programme controls are hidden until the ⊕ is
     * pressed, so a user who never presses it sees a form that looks finished
     * with a dead Submit. `classroomsMissing()` on the component exists to say so
     * out loud rather than leaving them to guess.
     *
     * A blank row is still tolerated — that is what a ⊕ pressed one time too
     * many leaves behind, and submit() drops it — but it does not satisfy the
     * requirement on its own. A half-filled row is a genuine mistake and blocks.
     */
    entry.classrooms.some(row => isCompleteClassroom(row)) &&
    entry.classrooms.every(row => isBlankClassroom(row) || isCompleteClassroom(row))
  );
}

/** Every one of a row's three controls answered. */
export function isCompleteClassroom(row: TeacherClassroomEntry): boolean {
  return row.grade !== '' && row.section !== '' && row.programmeId !== '';
}

/** A class row nobody has touched beyond its defaulted grade. */
export function isBlankClassroom(row: TeacherClassroomEntry): boolean {
  return row.section === '' && row.programmeId === '';
}


/**
 * Whether the row is still untouched, and so safe to skip on submit.
 *
 * THE DEFAULTED FIELDS ARE NOT CONSULTED. Role and Grade open on real values, so
 * including them would make every fresh row read as non-blank and a form nobody
 * typed into would refuse to submit. Section and Programme start empty and are
 * genuine evidence of typing, so they do count.
 */
export function isBlankEntry(entry: TeacherEntry): boolean {
  return (
    entry.phone === '' &&
    entry.email === '' &&
    entry.firstName === '' &&
    entry.lastName === '' &&
    entry.classrooms.every(isBlankClassroom)
  );
}

/** first + last, collapsed — the same denormalisation institutions use for their representative. */
export function teacherName(entry: TeacherEntry): string {
  return `${(entry.firstName ?? '').trim()} ${(entry.lastName ?? '').trim()}`.trim();
}

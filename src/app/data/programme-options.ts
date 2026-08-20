import { Programme, ProgrammeDraft, ProgrammeStatus, ProgrammeType } from '../models/teaching.model';

/**
 * Controlled vocabularies and pure helpers for the programme forms.
 *
 * Static rather than a Firestore lookup, for the same reason
 * institution-options.ts is: these change with a release, not with user data.
 */

/**
 * The statuses production's form offers, in its order.
 *
 * 'DEVELOPEMENT' is production's misspelling and is preserved — see the note on
 * ProgrammeStatus. The LABEL is spelled correctly, because that is display text
 * and nothing compares against it.
 */
export const PROGRAMME_STATUSES: readonly { value: ProgrammeStatus; label: string }[] = [
  { value: 'LIVE', label: 'Live' },
  { value: 'DEVELOPEMENT', label: 'In development' }
] as const;

export const PROGRAMME_TYPES: readonly { value: ProgrammeType; label: string }[] = [
  { value: 'REGULAR', label: 'Regular' },
  { value: 'STEM-CLUB', label: 'STEM Club' }
] as const;

/**
 * Grades 1–10 then the three pre-primary years.
 *
 * The same list classroom-options.ts uses, deliberately NOT imported from it.
 * A programme's grade vocabulary and a classroom's happen to coincide today;
 * tying them together would mean a change to one silently changing the other,
 * and production keeps them separate too (add-new-programme builds its own
 * gradeList, and only prepends the pre-primary years for one specific
 * institution).
 */
export const PROGRAMME_GRADES: readonly string[] = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  'Pre-primary 1', 'Pre-primary 2', 'Pre-primary 3'
] as const;

/** Production's age slider runs 1 to 16. */
export const PROGRAMME_AGES: readonly string[] = Array.from(
  { length: 16 },
  (_, index) => String(index + 1)
);

/** Whether a programme is scoped by grade or by age. */
export type ProgrammeScope = 'grade' | 'age';

export function statusLabel(status: string): string {
  return PROGRAMME_STATUSES.find(option => option.value === status)?.label ?? status;
}

export function programmeTypeLabel(type: string): string {
  return PROGRAMME_TYPES.find(option => option.value === type)?.label ?? type;
}

/**
 * Whether a status counts as Active for the stat cards and the filter pills.
 *
 * Case-insensitive, and accepts BOTH 'live' and 'active', exactly as
 * production's `isActive` does. Production data contains both spellings, so
 * testing only for 'LIVE' would file real live programmes under Draft.
 *
 * Everything that is not one of those two is a draft — including a status this
 * app has never heard of, which is the safe direction to be wrong in: an
 * unrecognised programme shows up somewhere rather than vanishing from both
 * filters.
 */
export function isActiveStatus(status: string | undefined | null): boolean {
  const normalised = (status ?? '').toLowerCase();

  return normalised === 'live' || normalised === 'active';
}

/**
 * Every value between two endpoints, inclusive.
 *
 * Production's `getAllclsInArray` — a range of grades or ages is STORED
 * EXPANDED, so 4-to-6 becomes ['4','5','6'] rather than its endpoints. Storing
 * the expansion is what lets the classroom picker ask a flat
 * `grades.includes(grade)` question instead of parsing a range at every call
 * site.
 *
 * Non-numeric endpoints (the pre-primary years) cannot form a range, so they are
 * returned as the single value they are.
 */
export function expandRange(from: string, to: string): string[] {
  const start = Number.parseInt(from, 10);
  const end = Number.parseInt(to, 10);

  if (Number.isNaN(start)) {
    return from ? [from] : [];
  }

  if (Number.isNaN(end) || end <= start) {
    return [String(start)];
  }

  return Array.from({ length: end - start + 1 }, (_, index) => String(start + index));
}

/**
 * How the list column renders a stored range: "4 - 6", or "8" for a single.
 *
 * Production shows first and last with a dash and never the values between,
 * which is why the expansion above is safe to store — nothing displays it
 * verbatim.
 */
export function rangeLabel(values: string[] | undefined | null): string {
  if (!values || values.length === 0) {
    return '';
  }

  if (values.length === 1) {
    return values[0];
  }

  return `${values[0]} - ${values[values.length - 1]}`;
}

/** Which of the two scopes a stored programme uses. Grade wins if both are set. */
export function scopeOf(programme: Pick<Programme, 'grades' | 'age'>): ProgrammeScope {
  return programme.grades?.length ? 'grade' : programme.age?.length ? 'age' : 'grade';
}

/* ==========================================================================
   The programme code sequence
   ========================================================================== */

/** Production's codes are 'P' then five digits. */
export const PROGRAMME_CODE_PREFIX = 'P';
const CODE_DIGITS = 5;

/**
 * The first code allocated when a teacher has no counter and no programmes.
 *
 * Five digits from 10001 rather than 00001, so every code this app writes has
 * the same width as production's P11697 — a code that changes length partway
 * through a sequence sorts wrongly as a string, which is how the list orders it.
 */
export const FIRST_PROGRAMME_NUMBER = 10001;

/**
 * The numeric part of a code, or null if there isn't one.
 *
 * Tolerant of the prefix being absent or different, because a row imported from
 * elsewhere may carry any convention and the sequence still has to advance past
 * it rather than restart at 1 and collide.
 */
export function programmeCodeNumber(code: string | undefined | null): number | null {
  const digits = /(\d+)\s*$/.exec(code ?? '');

  if (!digits) {
    return null;
  }

  const value = Number.parseInt(digits[1], 10);

  return Number.isNaN(value) ? null : value;
}

/** 10001 -> 'P10001'. Never truncates a number that has outgrown the width. */
export function formatProgrammeCode(value: number): string {
  return `${PROGRAMME_CODE_PREFIX}${String(value).padStart(CODE_DIGITS, '0')}`;
}

/**
 * Increments a code, carrying properly.
 *
 * Production's `addOne` walks the string backwards adding one with carry, which
 * works on the digits but does something undefined on the leading 'P':
 * `parseInt('P')` is NaN, `NaN + 1 < 10` is false, so it emits '0' and keeps
 * carrying. It only survives in practice because the carry stops at the first
 * digit below 9 and never reaches the letter. This splits the prefix off first
 * instead, which is the same answer for every input production actually
 * produces and a defined one for the inputs it does not.
 */
export function incrementProgrammeCode(code: string): string {
  const value = programmeCodeNumber(code);

  return formatProgrammeCode((value ?? FIRST_PROGRAMME_NUMBER - 1) + 1);
}

/**
 * The highest number already used across a teacher's programmes.
 *
 * The floor the counter is seeded from the first time a teacher creates a
 * programme. Without it, a teacher whose catalogue was imported — and so has
 * codes but no counter — would start allocating from the bottom and hand out
 * codes that already exist.
 */
export function highestProgrammeNumber(programmes: Programme[]): number {
  return programmes.reduce((max, programme) => {
    const value = programmeCodeNumber(programme.programmeCode);

    return value !== null && value > max ? value : max;
  }, FIRST_PROGRAMME_NUMBER - 1);
}

/**
 * A blank draft.
 *
 * Status defaults to LIVE because that is the only status the classroom pickers
 * offer, so a programme created any other way is invisible until it is edited —
 * and a form that defaults to a state where its own output cannot be used is a
 * trap. Production leaves it empty and requires a choice; this pre-selects the
 * useful one and still lets it be changed.
 */
export function emptyProgrammeDraft(): ProgrammeDraft {
  return {
    programmeName: '',
    displayName: '',
    programmeDescription: '',
    institutionId: '',
    institutionName: '',
    grades: [],
    age: [],
    type: 'REGULAR',
    programmeStatus: 'LIVE',
    programmeImagePath: '',
    learningUnitsIds: [],
    assignmentIds: []
  };
}

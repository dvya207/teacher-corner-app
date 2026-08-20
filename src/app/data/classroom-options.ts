import { Classroom, ClassroomDraft, ClassroomType, ProgrammeType } from '../models/teaching.model';
import { DEFAULT_COUNTRY } from './countries';

/**
 * Controlled vocabularies for the classroom forms.
 *
 * Static for the same reason institution-options.ts is: these change with a
 * release, not with user data, and reading them from Firestore would cost a
 * collection, a rule block and a round trip before the form could render.
 */

/**
 * The two kinds of classroom, with the label each one shows.
 *
 * The stored value is production's SCREAMING form and the label is title case,
 * so the table can read "Classroom" / "Stem-Club" without anything downstream
 * having to compare against display text.
 */
export const CLASSROOM_TYPES: readonly { value: ClassroomType; label: string }[] = [
  { value: 'CLASSROOM', label: 'Classroom' },
  { value: 'STEM-CLUB', label: 'STEM Club' }
] as const;

/**
 * Grades 1–10 then the three pre-primary years, in production's order.
 *
 * Strings throughout, including the numeric ones. Production stores grade as a
 * number for 1–10 and a string for 'Pre-primary 1', and every comparison in
 * that codebase has to test the type first. One type here costs a `String()`
 * on any imported row and removes the branch everywhere else.
 */
export const GRADES: readonly string[] = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  'Pre-primary 1', 'Pre-primary 2', 'Pre-primary 3'
] as const;

/** A–Z, then production's 'NA' for a school that does not section its grades. */
export const SECTIONS: readonly string[] = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'NA'
] as const;

/**
 * "Class 1" for a stored '1', and the pre-primary years unchanged.
 *
 * DISPLAY ONLY. The stored value stays '1' — production stores the bare grade
 * and labels it in the control, so prettifying on the way in would write a value
 * no other screen and no imported row would match.
 *
 * Lives here next to GRADES rather than in the form that needed it first, so a
 * second control labelling a grade cannot invent a different wording.
 */
export function gradeLabel(grade: string): string {
  return /^\d+$/.test(grade) ? `Class ${grade}` : grade;
}

/** Which catalogue programmes a given kind of classroom may be given. */
export function programmeTypeFor(type: ClassroomType): ProgrammeType {
  return type === 'STEM-CLUB' ? 'STEM-CLUB' : 'REGULAR';
}

/** "Classroom" / "STEM Club" for a stored type. */
export function classroomTypeLabel(type: ClassroomType): string {
  return CLASSROOM_TYPES.find(option => option.value === type)?.label ?? type;
}

/**
 * What the table shows in its first column.
 *
 * One helper rather than `cls.classroomName || cls.stemClubName` repeated at
 * every call site, because the two variants are never both filled and forgetting
 * the fallback shows a blank row rather than an error.
 */
export function classroomTitle(classroom: Pick<Classroom, 'classroomName' | 'stemClubName'>): string {
  return classroom.classroomName?.trim() || classroom.stemClubName?.trim() || '';
}

/**
 * "8 B" — how production composes a classroom's name.
 *
 * A pre-primary grade carries no section, so it stands alone rather than
 * becoming "Pre-primary 1 A".
 */
export function composeClassroomName(grade: string, section: string): string {
  if (!grade) {
    return '';
  }

  if (grade.startsWith('Pre-primary')) {
    return grade;
  }

  return `${grade} ${section}`.trim();
}

/**
 * The next per-institution sequence number, zero-padded to three digits.
 *
 * Derived from the classrooms already in hand rather than read from the
 * institution's `classroomCounter`. Production keeps that counter and then
 * recomputes from the classrooms anyway (getNextClassroomCode), because the
 * counter drifts whenever a classroom is deleted — this skips the field that
 * cannot be trusted and asks the rows.
 *
 * NOT a uniqueness guarantee. Two tabs creating a classroom for the same school
 * at the same moment can both compute the same code. It is a human-facing label,
 * not a key — the document id is the key — so a rare duplicate is cosmetic.
 */
export function nextClassroomCode(existing: Classroom[], institutionId: string): string {
  const highest = existing
    .filter(classroom => classroom.institutionId === institutionId)
    .reduce((max, classroom) => Math.max(max, Number.parseInt(classroom.classroomCode, 10) || 0), 0);

  return String(highest + 1).padStart(3, '0');
}

/**
 * Sections already taken for a grade at one school.
 *
 * The Add form removes these from its Section list, which is what stops a
 * second "8 B" being created at the same school. It is a UI guard and nothing
 * more — nothing in the rules enforces it, and a stale list can still collide.
 */
export function takenSections(
  existing: Classroom[],
  institutionId: string,
  grade: string
): Set<string> {
  return new Set(
    existing
      .filter(classroom =>
        classroom.type === 'CLASSROOM' &&
        classroom.institutionId === institutionId &&
        classroom.grade === grade
      )
      .map(classroom => classroom.section)
  );
}

/**
 * A blank draft.
 *
 * Country is the only field that starts populated, defaulting to India exactly
 * as production's form opens. Country is NOT stored on the classroom — it only
 * narrows the board list — so it lives on the form's own state rather than here.
 */
export function emptyClassroomDraft(): ClassroomDraft {
  return {
    type: 'CLASSROOM',
    classroomName: '',
    stemClubName: '',
    grade: '',
    section: '',
    board: '',
    institutionId: '',
    institutionName: '',
    programmes: {}
  };
}

/** The form's own starting country, separate from the draft. */
export const DEFAULT_CLASSROOM_COUNTRY = DEFAULT_COUNTRY;

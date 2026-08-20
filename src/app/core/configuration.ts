/**
 * The Configuration collection: every option list this app used to hardcode.
 *
 * ONE DOCUMENT PER OPTION SET, in a collection named `Configuration`, which is the
 * shape thinktac-india-production uses. Its documents were read directly before this
 * file was written, and the conventions copied rather than invented:
 *
 *   - the payload sits under a NAMED KEY, not at the document root, so a document can
 *     carry more than one list later without a migration (`Languages.langTypes`,
 *     `typeofSchools.typeofSchools`);
 *   - every document repeats its own id in a `docId` field, so an exported row is
 *     self-describing without its path.
 *
 * WHERE PRODUCTION'S NAMES FIT, THEY ARE USED — CountryCodes, Languages,
 * typeofSchools, BoardListAll. Where its document holds something else, a new name
 * follows the same convention instead. Three worth knowing about, because "mirror
 * production" would have been wrong:
 *
 *   - production's `grades` holds ['3','4'], not a grade vocabulary;
 *   - production's `genderList` is Male/Female/Others, which is a PERSON's gender,
 *     not the Boys/Girls/Co-ed a school is classified by;
 *   - production's `classrooms` and `programmes` are default-seeding maps keyed by
 *     board and grade, not dropdown options.
 *
 * SEEDED FROM THIS APP'S OWN CONSTANTS, deliberately. Those are what it renders today
 * and are known correct; production's equivalents differ (five school types to this
 * app's two, a longer language list) and adopting them would be a behaviour change
 * dressed as a refactor. Widening a list is now a Firestore edit, which is the point.
 */

/** Collection name. Capitalised, as production has it. */
export const CONFIGURATION_COLLECTION = 'Configuration';

/**
 * Document ids, and the key each one's payload sits under.
 *
 * Held as data rather than as scattered string literals so the loader can walk them
 * and the seed script can be checked against the same list — a document seeded under
 * a name nothing reads is the failure mode this prevents.
 */
export const CONFIGURATION_DOCS = {
  countryCodes:       { id: 'CountryCodes',       key: 'countryCodes' },
  boards:             { id: 'BoardListAll',       key: 'boards' },
  languages:          { id: 'Languages',          key: 'langTypes' },
  schoolTypes:        { id: 'typeofSchools',      key: 'typeofSchools' },
  genderTypes:        { id: 'SchoolGenderTypes',  key: 'genderTypes' },
  classroomTypes:     { id: 'ClassroomTypes',     key: 'classroomTypes' },
  grades:             { id: 'GradeList',          key: 'grades' },
  sections:           { id: 'SectionList',        key: 'sections' },
  programmeStatuses:  { id: 'ProgrammeStatuses',  key: 'statuses' },
  programmeTypes:     { id: 'ProgrammeTypes',     key: 'types' },
  programmeAges:      { id: 'ProgrammeAges',      key: 'ages' },
  /**
   * SEPARATE from GradeList on purpose. programme-options.ts keeps its own grade list
   * and says why: a programme's grade vocabulary and a classroom's coincide today, and
   * tying them together would make a change to one silently change the other.
   */
  programmeGrades:    { id: 'ProgrammeGrades',    key: 'grades' },
  pincodeRules:       { id: 'PincodeRules',       key: 'rules' },
  customerSchool:     { id: 'CustomerSchool',     key: 'options' },
  teacherRoles:       { id: 'TeacherRoles',       key: 'roles' }
} as const;

export type ConfigurationName = keyof typeof CONFIGURATION_DOCS;

/* ==========================================================================
   Payload shapes.

   Each mirrors the constant it replaces, so a consumer switching from the constant
   to the service needs no other change.
   ========================================================================== */

/** CountryCodes. `dial` carries the leading '+', as the app's own list does. */
export interface ConfiguredCountry {
  iso2: string;
  name: string;
  dial: string;
}

/** BoardListAll, Languages: a code and something to show for it. */
export interface CodedOption {
  code: string;
  label: string;
}

/** ClassroomTypes, ProgrammeStatuses, ProgrammeTypes: a stored value and a label. */
export interface ValuedOption {
  value: string;
  label: string;
}

/** typeofSchools. `short` is what the institutions table abbreviates to. */
export interface ConfiguredSchoolType {
  value: string;
  short: string;
}

/**
 * PincodeRules, keyed by country name.
 *
 * A PATTERN AS A STRING, compiled by the reader. This is the one entry that carries
 * behaviour rather than options: isCompletePincode() hardcoded India's six digits in
 * an `if`, so a new country meant a code change. `digits` is what the input filter
 * truncates to.
 */
export interface PincodeRule {
  country: string;
  pattern: string;
  digits: number;
}

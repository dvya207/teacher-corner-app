/**
 * The Configuration collection: every option list this app used to hardcode.
 *
 * ONE DOCUMENT PER OPTION SET, in a collection named `Configuration`, which is the
 * shape the production app uses. Its documents were read directly before this
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

/*
 * The collection name lives in core/firestore-paths.ts with every other one, as
 * COLLECTIONS.configuration, and is reached through configurationCollection().
 * It was here, and that made this the only place outside the path builder that
 * named a collection — which is what let the read be built inline from `db`.
 */

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
  teacherRoles:       { id: 'TeacherRoles',       key: 'roles' },

  /**
   * The learning-unit taxonomy — production's document id and key, unchanged.
   *
   * THE ONLY ENTRY HERE WHOSE NAME AND SHAPE ARE PRODUCTION'S RATHER THAN THIS
   * APP'S. Everywhere else this file says "where production's names fit, they are
   * used"; here they fit exactly, because the document was read out of production
   * and seeded verbatim, so keeping the id makes the two directly comparable.
   *
   * `domains`, THE ARRAY, not `domainMap`. The document carries both — the same 44
   * rows as an array and as a map keyed by composite code. The array is what the
   * generic list loader in configuration.service.ts can consume, and the lookup
   * this app does (find the row whose two letters match) needs no key-based access.
   * The seed writes both so the document matches production field for field.
   */
  learningUnitDomains: { id: 'learningUnitDomains', key: 'domains' },

  /**
   * The maturity ladder — production's id and key, unchanged.
   *
   * `maturity` IS A MAP, NOT AN ARRAY, keyed by the lowercase level name
   * ('silver', 'gold', 'platinum', 'diamond'). Every other entry in this table
   * points at an array, which is why the generic list loader cannot read this one
   * — see applyMaturities() in configuration.service.ts.
   *
   * A map rather than an array is production's choice and worth keeping: the whole
   * point of the document is to be looked up BY LEVEL, and a unit stores its level
   * as a string, so a map is a direct hit where an array would be a scan.
   */
  learningUnitMaturity: { id: 'learningUnitMaturity', key: 'maturity' },

  /**
   * The empty resource skeleton — production's id and key, unchanged.
   *
   * FOUR LEVELS DEEP under `resources`: type -> maturity -> category -> sub-category.
   * Deeper than anything else this collection holds, and the only entry the generic
   * list loader could not read even in principle.
   *
   * THIS DOCUMENT DOES NOT FOLLOW THE `docId` CONVENTION. Every other document in the
   * collection repeats its own id in a `docId` field, as the note at the top of this
   * file describes; this one calls that field `resourceSchemaId` instead. It is
   * generated by a Cloud Function from a Google Sheet rather than written by the app,
   * which is presumably how it came to differ. The seed writes BOTH, so the document
   * is readable either way — see the note in scripts/seed-configuration.mjs.
   */
  learningUnitResourceSchema: { id: 'learningUnitResourceSchema', key: 'resources' },

  /**
   * The subject vocabulary — { code, name } per subject, five of them.
   *
   * `name`, NOT `label`, which is why this cannot reuse CodedOption. Production's
   * document says name and the taxonomy rows say subjectName, so name it is.
   */
  subjectTypes: { id: 'subjectTypes', key: 'subjectTypes' },

  /**
   * TWO ENTRIES POINTING AT ONE DOCUMENT, `subjects`, which carries two unrelated
   * arrays. Splitting them here rather than adding a second key field keeps every
   * entry in this table the same shape, and the loader reads the collection whole
   * anyway — so naming the document twice costs nothing at read time.
   */
  subjectNames: { id: 'subjects', key: 'subjectsNames' },
  subjectDomainCodes: { id: 'subjects', key: 'domainCodesToInclude' },

  /**
   * The OLDER maturity document — a bare array of names, capital-M id.
   *
   * SEEDED, BUT NOT THE SOURCE OF TRUTH. learningUnitMaturity above carries the
   * cumulative ladder and is what the app orders by; this one's order is wrong
   * (Diamond before Platinum). See LEGACY_MATURITY_NAMES for the detail.
   */
  legacyMaturity: { id: 'Maturity', key: 'maturity' },

  /**
   * The learning-unit search facets — board, grade, subject, topic.
   *
   * `SubjectDomain` IS THE PAYLOAD, and its field names are PascalCase, alone in this
   * collection. Its "Subject" means what every other document calls a DOMAIN and its
   * "Topic" means a composite code, so do not wire it to anything expecting
   * subjectCode. See src/app/data/tacs-search-configuration.ts.
   *
   * The document also carries BoardDomain and GradeDomain, read through their own
   * entries below for the same reason `subjects` is named twice.
   */
  tacsSearchSubjects: { id: 'TACsSearchConfiguration', key: 'SubjectDomain' },
  tacsSearchBoards: { id: 'TACsSearchConfiguration', key: 'BoardDomain' },
  tacsSearchGrades: { id: 'TACsSearchConfiguration', key: 'GradeDomain' },

  /**
   * The thirteen learning unit types.
   *
   * `Types` IS A MAP KEYED BY CODE — `Types.TA = { code: 'TA', name: 'TACtivity' }` —
   * so the generic list loader cannot read it. See applyTypes in
   * configuration.service.ts.
   *
   * The code is the first segment of every `learningUnitId` this app mints, which is
   * why this document is worth reading rather than assuming: a wrong code here is a
   * wrong id on every unit created afterwards.
   */
  learningUnitTypes: { id: 'LearningUnitTypes', key: 'Types' },

  /**
   * The learning unit LANGUAGE list. SEPARATE from `Languages` above, deliberately.
   *
   * `Languages` is a SCHOOL'S MEDIUM OF INSTRUCTION and carries a seventh entry, OT
   * 'Other', which the institution form needs and a learning unit must not have: a
   * unit's `isoCode` becomes a segment of its `learningUnitId`, so offering OT mints
   * ids like 'TA-AE04-OT-V10' for a language nobody can name.
   *
   * Same reasoning as GradeList versus ProgrammeGrades below — the two vocabularies
   * coincide on six of seven entries today, and tying them together would make a change
   * to one silently change the other.
   *
   * The KEY is `langTypes`, matching the shape of the medium document, so a reader that
   * handles one handles the other.
   */
  learningUnitLanguages: { id: 'LearningUnitLanguages', key: 'langTypes' },

  /**
   * Difficulty levels for the learning unit form.
   *
   * A NEW DOCUMENT NAME. Production keeps `difficultyLevel` as a field on the unit and
   * has no configuration document behind it, so this follows the convention this file's
   * header describes: where production has no name that fits, invent one in the same
   * style rather than overload an existing document.
   *
   * Stored as STRINGS, because Production types `difficultyLevel` as `number | string`
   * and stores both — see DIFFICULTY_LEVELS.
   */
  learningUnitDifficulty: { id: 'LearningUnitDifficulty', key: 'levels' }
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

/**
 * One row of `learningUnitDomains.domains`, AS FIRESTORE SPELLS IT.
 *
 * Deliberately NOT TaxonomyRow. The stored field is `subdomainName` with a lowercase
 * d, while every one of this app's six taxonomy fields and its whole TaxonomyRow
 * interface use `subDomainName`. Production's own import function writes the
 * lowercase spelling, so it is not a typo to be fixed at source — it is the wire
 * format.
 *
 * Declaring the wire shape separately is what makes the mismatch impossible to miss:
 * a blind cast from the document to TaxonomyRow compiles perfectly and yields rows
 * whose `subDomainName` is undefined, which surfaces as a blank Sub-Domain Name field
 * rather than as an error. configuration.service.ts translates between the two, and
 * accepts either spelling so a hand-edited document works whichever way it was typed.
 */
export interface ConfiguredDomainRow {
  subjectCode: string;
  subjectName: string;
  domainCode: string;
  domainName: string;
  subDomainCode: string;
  /** Firestore's spelling. */
  subdomainName?: string;
  /** This app's spelling, accepted if a hand edit used it. */
  subDomainName?: string;
  /** Stored, and equal to domainCode + subDomainCode. Recomputed, never trusted. */
  compositeCode?: string;
}

/**
 * One value of `learningUnitMaturity.maturity`, AS FIRESTORE STORES IT.
 *
 * Every field optional, because this is the wire shape and the document is
 * hand-editable. MaturityLevel in learning-unit-taxonomy.ts is the shape the app
 * works with; configuration.service.ts fills the gaps between them.
 */
export interface ConfiguredMaturity {
  level?: string;
  upgradeable?: boolean;
  availableUpgrades?: string[];
  cumulativeMaturity?: string[];
}

/**
 * One leaf of the resource skeleton: a stored path.
 *
 * TWO SHAPES, and which one a slot uses is fixed by the schema rather than by the
 * upload. A plain string is one path for the unit. The object form marks a
 * GRADE-DEPENDENT slot, where production's sheet set isGradeDependent on the field.
 */
export type ConfiguredResourceSlot = string | { universalGradeBoardResourcePath: string };

/** category -> sub-category -> slot. A category may also BE a slot; see the schema. */
export type ConfiguredResourceCategory =
  Record<string, ConfiguredResourceSlot | Record<string, ConfiguredResourceSlot>>;

/** `resources` in full: type -> maturity -> category -> ... */
export type ConfiguredResourceSchema =
  Record<string, Record<string, ConfiguredResourceCategory>>;

/** subjectTypes: a subject's one-letter code and its display name. */
export interface ConfiguredSubjectType {
  code: string;
  name: string;
}

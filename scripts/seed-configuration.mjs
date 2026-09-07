/**
 * Seeds the Configuration collection in teacher-corner-dev.
 *
 * WRITES WHAT THE APP ALREADY RENDERS. Every list here is copied from the constant it
 * replaces, so seeding changes no behaviour: the app shows the same options, it just
 * reads them from Firestore afterwards. Widening a list becomes a console edit.
 *
 * Follows the conventions read out of the production app's own Configuration
 * collection: payload under a named key, and a `docId` field repeating the id.
 *
 * IDEMPOTENT. Each document is written whole with set(), so running twice leaves the
 * same state and a hand edit is overwritten — which is the point of a seed rather than
 * a migration. Pass --dry-run to print what it would write and touch nothing.
 *
 * Usage:
 *   node scripts/seed-configuration.mjs --dry-run
 *   node scripts/seed-configuration.mjs --only learningUnitDomains --dry-run
 *   node scripts/seed-configuration.mjs --only learningUnitDomains
 *   node scripts/seed-configuration.mjs                        # all 16 documents
 *
 * --only NARROWS THE WRITE. Without it every document is rewritten, which is right for
 * a seed and wrong when the job is to add or refresh one.
 *
 * The write path needs firebase-admin and Application Default Credentials.
 *
 * NODE_PATH DOES NOT WORK HERE. This header used to say
 *   NODE_PATH=functions-otp/node_modules node scripts/seed-configuration.mjs
 * and that advice was wrong: NODE_PATH is honoured by CommonJS require(), not by ESM,
 * and this is an .mjs file whose firebase-admin import is a dynamic `import()`. It
 * fails with ERR_MODULE_NOT_FOUND however NODE_PATH is set.
 *
 * ESM resolves a bare specifier by walking node_modules directories UP FROM THE
 * IMPORTING FILE, so firebase-admin has to be reachable from scripts/ or a parent.
 * firebase-admin is a dependency of functions-otp, not of the Angular app, so link it
 * into the root node_modules once — which is gitignored, so this is a machine setup
 * step and not a repo change:
 *
 *   ln -sfn "$PWD/functions-otp/node_modules/firebase-admin" node_modules/firebase-admin
 *
 * The same applies to any throwaway script that reads this database: it must live
 * inside the repo, because one run from /tmp cannot resolve the package either.
 */

// firebase-admin is IMPORTED LAZILY, inside the write path. It is not a dependency of
// the Angular app — it lives in functions-otp — so a top-level import made even
// --dry-run fail with ERR_MODULE_NOT_FOUND on a clean checkout. Nothing needs it to
// print what would be written.

const PROJECT_ID = 'helix-staging-india';
const DATABASE_ID = 'teacher-corner-dev';
const COLLECTION = 'Configuration';

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * --json prints the documents and nothing else, so another tool can upload them.
 *
 * The write path below needs firebase-admin and Application Default Credentials. On a
 * machine with neither, this keeps ONE source of truth for the values: they are still
 * derived here, from the same constants, and something else does the transport.
 */
const AS_JSON = process.argv.includes('--json');

/**
 * --only <id>[,<id>] narrows the write to named documents.
 *
 * WHY IT EXISTS. Every document here is written whole with set(), so a full run
 * overwrites all sixteen — which is correct for a seed, and wrong when the job is
 * "add one document" and somebody has since edited another in the console. Without
 * this flag the only way to add a document was to rewrite the other fifteen.
 *
 * An id that matches nothing is an ERROR rather than a silent no-op: a typo would
 * otherwise report success having written nothing at all.
 */
const ONLY = (() => {
  const index = process.argv.indexOf('--only');

  if (index === -1) {
    return null;
  }

  const value = process.argv[index + 1];

  if (!value || value.startsWith('--')) {
    throw new Error('--only needs a document id, e.g. --only learningUnitDomains');
  }

  return value.split(',').map(id => id.trim()).filter(Boolean);
})();


/* ==========================================================================
   The values. Copied verbatim from src/app/data/*.ts — see each comment for the
   constant it mirrors. Keep them in step until the constants become fallback-only.
   ========================================================================== */

/**
 * learning-unit-options.ts LEARNING_UNIT_LANGUAGES — SIX, not the seven mediums.
 *
 * Deliberately not `langTypes` below. That list is a school's medium of instruction and
 * carries OT 'Other'; a learning unit's isoCode becomes part of its learningUnitId, so
 * 'TA-AE04-OT-V10' is not a language anyone can name. See the note on
 * CONFIGURATION_DOCS.learningUnitLanguages.
 */
const luLangTypes = [
  { code: 'EN', label: 'English' },
  { code: 'HI', label: 'Hindi' },
  { code: 'KN', label: 'Kannada' },
  { code: 'MR', label: 'Marathi' },
  { code: 'TA', label: 'Tamil' },
  { code: 'TE', label: 'Telugu' }
];

/**
 * assignment-options.ts ASSIGNMENT_TYPE_OPTIONS — ALL FIVE, verified field for field
 * against production's own Configuration/AssignmentTypes.
 *
 * FIVE HERE THOUGH THE APP CREATES THREE. This document mirrors production's, and
 * production's has five; the restriction to Quiz, Upload and Form lives in
 * ASSIGNMENT_TYPES in the model, which is what the Create menu reads. Seeding all
 * five means a row already stored as GAME or TEXTBLOCK is labelled 'Game' or
 * 'Text Block' in the table rather than shown as a raw SCREAMING_SNAKE value.
 *
 * `displayName` and `type`, in that order and with those names — production's.
 */
const assignmentsTypes = [
  { displayName: 'Quiz', type: 'QUIZ' },
  { displayName: 'Upload', type: 'UPLOAD' },
  { displayName: 'Game', type: 'GAME' },
  { displayName: 'Form', type: 'FORM' },
  { displayName: 'Text Block', type: 'TEXTBLOCK' }
];

/**
 * assignment-options.ts FORM_QUESTION_TYPES — the seven a form's fields can be.
 *
 * `display` and `key`, NOT `label` and `code`: this document has its own field
 * names and they are what the reader looks up. Two are worth noticing — 'none' is
 * "Display Only", a block of text with no input, and `text` and `textBox` are a
 * single line and a multi-line box rather than synonyms.
 */
/*
 * 'checkBoxGroup' AND 'radioGroup' ARE THIS APP'S OWN, the two form question
 * types here that production's `questionTypesForm` does not carry. Its seven are
 * all above them.
 *
 * WHY IT EXISTS. Every option list a form could ask for was single-select:
 * `dropDown` picks exactly one and the three dropDown variants differ only in
 * where their options come from. A question like "which of these did the class
 * struggle with" has no honest answer in that vocabulary, and the workaround was
 * one dropDown per option.
 *
 * IT REUSES `dropDownOptions` rather than adding a field of its own. The value is
 * the same thing in both cases, a comma separated list of choices, and whether
 * one or several may be picked is what the TYPE says, not what the field says.
 * A `checkBoxGroupOptions` beside it would also have to be written on all 209 existing
 * questions, because this collection stores every field on every question
 * regardless of type.
 *
 * A checkBoxGroup's ANSWER IS AN ARRAY, which is the one place it is not like
 * `dropDown`. A radioGroup's is a single string, exactly like a dropdown's. See
 * FormSubmissionService.AnsweredFormQuestion.answer.
 *
 * WHY `radioGroup` WHEN `dropDown` ALREADY PICKS ONE. A dropdown hides its
 * choices until tapped, which is wrong for the case these were added for: a
 * teacher answering with a class in front of them, who needs to see what is on
 * offer without opening anything. It also authors its options as rows, so one of
 * them may contain a comma.
 */
const questionTypesForm = [
  { display: 'Display Only', key: 'none' },
  { display: 'Text Field', key: 'text' },
  { display: 'Text Box', key: 'textBox' },
  { display: 'Drop Down', key: 'dropDown' },
  { display: 'Star Rating', key: 'starRating' },
  { display: 'Drop Down (Dynamic)', key: 'dropDownDynamic' },
  { display: 'Drop Down (Dependent)', key: 'dropDownDependent' },
  { display: 'Checkboxes (Multi-Select)', key: 'checkBoxGroup' },
  { display: 'Radio Buttons (Single-Select)', key: 'radioGroup' }
];

/**
 * assignment-options.ts UPLOAD_FILE_TYPES — what a student may be asked to upload.
 *
 * A MAP, NOT AN ARRAY, which is production's shape for this one and the reason
 * ConfigurationService reads it with its own loader rather than the generic list
 * one. The KEY is what an upload slot stores in `uploadFileType` ('IMAGE') and the
 * value is what the dropdown shows.
 */
const uploadFormatNames = {
  PDF: 'PDF',
  IMAGE: 'Image',
  VIDEO: 'Video',
  WORD: 'Word Document',
  EXCEL: 'Spreadsheet',
  PPT: 'Powerpoint Presentation'
};

/**
 * teaching.model.ts QUIZ_QUESTION_TYPES — the five a quiz question can be.
 *
 * NO `icon` FIELD. The constant carries one; it names an SVG in the icon
 * component, so a value here would be a string nothing can render unless it
 * happens to match, and an editor changing it would produce a blank space with no
 * way to tell why. ConfigurationService merges the configured label with the icon
 * the code holds for that type.
 *
 * PRODUCTION HAS NO DOCUMENT FOR THIS — it hardcodes the list in its own quiz
 * component. Seeded here because it is a vocabulary, and 'DESCRIPTIVE' as a label
 * is the sort of thing somebody will want to sentence-case without a release.
 */
const questionTypesQuiz = [
  { type: 'MCQ', label: 'MCQ' },
  { type: 'FILL_IN_THE_BLANKS', label: 'Fill In The Blanks' },
  { type: 'TEXT', label: 'Text' },
  { type: 'RICH_BLANKS', label: 'Rich Blanks' },
  { type: 'DESCRIPTIVE', label: 'DESCRIPTIVE' }
];

/**
 * The two kinds of workflow a template can be.
 *
 * PRODUCTION'S OWN DOCUMENT, copied field for field —
 * Configuration/WorkflowTypes.workflowTypes — which makes this one of the few
 * entries in this script that MIRRORS rather than invents. Note the shape:
 * `displayName`, not `label`. The app's own option type uses `label`, and the
 * service translates; writing `label` here would match the app and diverge from
 * production, which is the wrong way round for a document both read.
 *
 * THE HYPHEN IN 'STEM-CLUB' IS PART OF THE CODE. Every one of production's
 * templates stores it hyphenated, so a tidied 'STEMCLUB' would write documents its
 * own list page could not label.
 */
const workflowTypes = [
  { code: 'CLASSROOM', displayName: 'Classroom' },
  { code: 'STEM-CLUB', displayName: 'Stem Club' }
];

/**
 * WHICH of the five kinds the Create menu offers.
 *
 * A POLICY, NOT A VOCABULARY, and the reader treats it as such: it may NARROW
 * this list but never widen it, because adding 'TEXTBLOCK' here does not bring a
 * text-block editor into being. Turning a type off is a real thing to want;
 * turning one on is a release.
 */
const creatableTypes = ['QUIZ', 'UPLOAD', 'FORM'];

/** teaching.model.ts PEDAGOGY_TYPES — formative and summative. */
const pedagogyTypes = ['FA', 'SA'];

/** teaching.model.ts QUIZ_AUTH_TYPES — whether an attempt needs a login. */
const authenticationTypes = ['login', 'anonymous'];

/**
 * The megabyte ceiling per upload type, keyed as `formatNames` is, plus DEFAULT.
 *
 * Production expresses these as three ternaries inside a template binding —
 * `VIDEO ? 200 : IMAGE ? 20 : 40` — which is the least editable place a number
 * like that could live. `DEFAULT` is pulled out of the map by the reader, so it
 * cannot be mistaken for an upload type.
 */
const uploadSizeCaps = { VIDEO: 200, IMAGE: 20, DEFAULT: 40 };

/**
 * assignment-options.ts ASSIGNMENT_STATUSES, and the two colouring lists.
 *
 * THREE LISTS, NOT ONE, and that separation is the point. `statuses` is what the
 * Status select offers; `liveValues` and `closedValues` are which STORED values
 * the badge paints. The collection holds statuses this app never writes —
 * 'active', 'archived' — because production wrote them, so the badge must colour
 * values the dropdown does not offer. Merging them would either offer 'archived'
 * for creation or paint a stored 'archived' row as a draft.
 *
 * The colouring lists are lowercase: the comparison lowercases the stored value
 * first, because the collection has 'LIVE', 'Live' and 'live'.
 */
const assignmentStatuses = ['LIVE', 'DEVELOPMENT'];
const liveStatusValues = ['active', 'live'];
const closedStatusValues = ['closed', 'archived'];

/**
 * What a new assignment opens with, and where its inline media goes.
 *
 * THREE UNRELATED SCALARS, grouped because each was a literal buried in the model
 * or a service rather than because they belong together. The reader takes them
 * FIELD BY FIELD, so a document setting only one leaves the others alone.
 *
 * `quizMediaFolder` IS PRODUCTION'S OWN FOLDER, and changing it has a consequence
 * worth stating: production's tooling looks for quiz media under
 * `quizzer_resources/`, so a different value writes files it cannot find.
 */
const assignmentDefaults = {
  formInstructions: 'Please answer all the questions in the fields provided below',
  slotMaxUploads: 1,
  quizMediaFolder: 'quizzer_resources'
};

/**
 * learning-unit-options.ts DIFFICULTY_LEVELS. Strings, as production stores them.
 *
 * SIX LEVELS, STARTING AT 0. This read ['1'..'5'] and that was a transcription
 * slip in this hand-copied constant, not a decision: DIFFICULTY_LEVELS itself has
 * always carried '0'..'5', and the note on it explains why at length. Production's
 * own units store difficultyLevel 0, two of the six in teacher-corner-dev do right
 * now, and a list starting at 1 cannot show what they hold, so the select fell back
 * to its first option and offered to save 1 over a stored 0.
 *
 * The live document was already correct, so nothing needed repairing in the
 * database. What this fixes is the seed: a full run would have overwritten six
 * good levels with five and reintroduced the exact bug learning-unit-options.ts
 * documents fixing. Found by scripts/verify-configuration.mjs.
 */
const luDifficultyLevels = ['0', '1', '2', '3', '4', '5'];

/** institution-options.ts BOARDS */
const boards = [
  { code: 'CBSE',  label: 'Central Board Of Secondary Education' },
  { code: 'ICSE',  label: 'Indian Certificate Of Secondary Education' },
  { code: 'IB',    label: 'International Baccalaureate' },
  { code: 'IGCSE', label: 'International General Certificate Of Secondary Education' },
  { code: 'State', label: 'State Board' },
  { code: 'UPMSP', label: 'UP Madhyamik Shiksha Parishad' },
  { code: 'Other', label: 'Other' }
];

/** institution-options.ts MEDIUMS. Production's Languages doc calls this langTypes. */
const langTypes = [
  { code: 'EN', label: 'English' },
  { code: 'HI', label: 'Hindi' },
  { code: 'KN', label: 'Kannada' },
  { code: 'MR', label: 'Marathi' },
  { code: 'TA', label: 'Tamil' },
  { code: 'TE', label: 'Telugu' },
  { code: 'OT', label: 'Other' }
];

/**
 * institution-options.ts SCHOOL_TYPES.
 *
 * TWO, not production's five. Production's typeofSchools adds Private Residential,
 * Government Aided and Government Residential; this app has only ever offered two and
 * its institutions table abbreviates exactly these. Adding the other three is now an
 * edit here rather than a code change — but it is a behaviour change, so it is not
 * being smuggled in by a refactor.
 */
const typeofSchools = [
  { value: 'Private School',    short: 'Pvt' },
  { value: 'Government School', short: 'Govt' }
];

/**
 * institution-options.ts GENDER_TYPES.
 *
 * NOT production's genderList, which is Male/Female/Others — a person's gender. This
 * is how a school is classified, hence the separate document name.
 */
const genderTypes = ['Boys', 'Girls', 'Co-ed'];

/** The Yes/No pair behind customerSchool, previously two literals in a template. */
const customerSchool = ['Yes', 'No'];

/** setup-wizard-options.ts isCompletePincode + toPincodeDigits, as data. */
const pincodeRules = [{ country: 'India', pattern: '^[1-9][0-9]{5}$', digits: 6 }];

/** classroom-options.ts CLASSROOM_TYPES */
const classroomTypes = [
  { value: 'REGULAR',   label: 'Regular classroom' },
  { value: 'STEM-CLUB', label: 'STEM Club' }
];

/** classroom-options.ts GRADES */
const grades = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  'Pre-primary 1', 'Pre-primary 2', 'Pre-primary 3'
];

/** classroom-options.ts SECTIONS — A to Z, then NA. */
const sections = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'NA'];

/** programme-options.ts PROGRAMME_STATUSES. DEVELOPEMENT is production's spelling. */
const programmeStatuses = [
  { value: 'LIVE',         label: 'Live' },
  { value: 'DEVELOPEMENT', label: 'In development' }
];

/** programme-options.ts PROGRAMME_TYPES */
const programmeTypes = [
  { value: 'REGULAR',   label: 'Regular' },
  { value: 'STEM-CLUB', label: 'STEM Club' }
];

/**
 * programme-options.ts PROGRAMME_GRADES.
 *
 * The same values as GradeList, in a document of its own. programme-options.ts keeps a
 * separate list deliberately — tying the two together would make a change to one
 * silently change the other — and that separation is preserved here rather than
 * collapsed by the migration.
 */
const programmeGrades = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  'Pre-primary 1', 'Pre-primary 2', 'Pre-primary 3'
];

/** programme-options.ts PROGRAMME_AGES — 1 to 16. */
const programmeAges = Array.from({ length: 16 }, (_, index) => String(index + 1));

/** teacher-options.ts TEACHER_ROLES */
const teacherRoles = ['School Teacher', 'ThinkTac Coach'];

/**
 * learning-unit-taxonomy.ts LEARNING_UNIT_TAXONOMY — all 44 rows, PARSED FROM SOURCE.
 *
 * Read out of the TypeScript rather than transcribed here, for the reason
 * readCountries() gives about the 200-odd countries: two copies of 44 rows drift, and
 * the drift is silent because both look plausible. There is ONE list, in
 * learning-unit-taxonomy.ts, and this is a projection of it.
 *
 * The guard is the same too. A pattern that stops matching yields a SHORT list, not an
 * error, and a short list would quietly overwrite a complete document with a truncated
 * one — so anything under 44 rows refuses to seed.
 */
async function readTaxonomy() {
  const source = await import('node:fs').then(fs =>
    fs.promises.readFile(
      new URL('../src/app/data/learning-unit-taxonomy.ts', import.meta.url), 'utf8'
    )
  );

  // Anchored on the array, so the TaxonomyRow interface above it cannot be matched.
  const body = source.slice(
    source.indexOf('export const LEARNING_UNIT_TAXONOMY'),
    source.indexOf('] as const;', source.indexOf('export const LEARNING_UNIT_TAXONOMY'))
  );

  const rows = [...body.matchAll(
    /\{\s*subjectCode:\s*'([^']*)',\s*subjectName:\s*'([^']*)',\s*domainCode:\s*'([^']*)',\s*domainName:\s*'([^']*)',\s*subDomainCode:\s*'([^']*)',\s*subDomainName:\s*'([^']*)'\s*\}/g
  )];

  if (rows.length < 44) {
    throw new Error(
      `Parsed only ${rows.length} taxonomy rows from learning-unit-taxonomy.ts — the ` +
      'shape has changed, so this seed would write a truncated table. Fix the pattern ' +
      'before seeding.'
    );
  }

  // FIRESTORE'S FIELD NAMES, not the app's: `subdomainName` with a lowercase d, and a
  // derived `compositeCode`. Production writes it that way and this document is meant
  // to be field-for-field comparable with production's. The translation back to
  // `subDomainName` happens in configuration.service.ts, on read.
  return rows.map(([, subjectCode, subjectName, domainCode, domainName, subDomainCode, subdomainName]) => ({
    compositeCode: `${domainCode}${subDomainCode}`,
    domainCode,
    domainName,
    subDomainCode,
    subdomainName,
    subjectCode,
    subjectName
  }));
}

/**
 * countries.ts COUNTRIES, read straight out of the source so the 200-odd entries are
 * never transcribed by hand into this file and allowed to drift.
 */
async function readCountries() {
  const source = await import('node:fs').then(fs =>
    fs.promises.readFile(new URL('../src/app/data/countries.ts', import.meta.url), 'utf8')
  );

  const rows = [...source.matchAll(
    /\{\s*iso2:\s*'([^']+)',\s*name:\s*'([^']+)',\s*dial:\s*'([^']+)'\s*\}/g
  )];

  if (rows.length < 100) {
    throw new Error(
      `Parsed only ${rows.length} countries from countries.ts — the shape has changed, ` +
      'so this seed would write a truncated list. Fix the pattern before seeding.'
    );
  }

  return rows.map(([, iso2, name, dial]) => ({ iso2, name, dial }));
}

/**
 * learning-unit-taxonomy.ts LEARNING_UNIT_MATURITY_LADDER, as production's MAP.
 *
 * Parsed from source for the same reason the taxonomy is, and reshaped on the way
 * out: the constant is an ARRAY in rank order, because that is what a dropdown wants,
 * while the document is a MAP keyed by the lowercase level name, because that is what
 * a lookup by level wants. Neither is more correct; this is the translation.
 *
 * Key order in the written document ends up alphabetical (diamond, gold, platinum,
 * silver), which is what production's document shows too — Firestore does not preserve
 * insertion order for map fields, and nothing reads it positionally. Rank is recovered
 * from cumulativeMaturity.length on read.
 */
async function readMaturities() {
  const source = await import('node:fs').then(fs =>
    fs.promises.readFile(
      new URL('../src/app/data/learning-unit-taxonomy.ts', import.meta.url), 'utf8'
    )
  );

  const body = source.slice(
    source.indexOf('export const LEARNING_UNIT_MATURITY_LADDER'),
    source.indexOf('] as const;', source.indexOf('export const LEARNING_UNIT_MATURITY_LADDER'))
  );

  const entries = [...body.matchAll(
    /level:\s*'([^']+)',\s*upgradeable:\s*(true|false),\s*availableUpgrades:\s*\[([^\]]*)\],\s*cumulativeMaturity:\s*\[([^\]]*)\]/g
  )];

  if (entries.length !== 4) {
    throw new Error(
      `Parsed ${entries.length} maturity levels from learning-unit-taxonomy.ts, expected 4 — ` +
      'the shape has changed, so this seed would write an incomplete ladder.'
    );
  }

  const list = value => [...value.matchAll(/'([^']+)'/g)].map(([, name]) => name);

  return Object.fromEntries(entries.map(([, level, upgradeable, upgrades, cumulative]) => [
    level.toLowerCase(),
    {
      availableUpgrades: list(upgrades),
      cumulativeMaturity: list(cumulative),
      level,
      upgradeable: upgradeable === 'true'
    }
  ]));
}

/**
 * learning-unit-resource-schema.ts LEARNING_UNIT_RESOURCE_SCHEMA — IMPORTED, not parsed.
 *
 * The other two readers slice the TypeScript and run a regex over it, which works
 * because a taxonomy row and a maturity entry are flat. This structure is four levels
 * deep with keys containing spaces, parentheses and ampersands, and a regex over it
 * would be both unreadable and quietly wrong at the first nesting it did not expect.
 *
 * IMPORTING THE .ts DIRECTLY instead. Node strips types on import from 22.18 onwards,
 * unflagged, so a plain dynamic import of the source file works — the constant is pure
 * data with an `as const`, and `as const` is erasable syntax. This is what the
 * --experimental-strip-types note in this file's header was reaching for; the flag is
 * no longer needed.
 *
 * The guard is a shape check rather than a count: nine types, two of them legitimately
 * empty, and at least one deep slot resolving. A truncated import would fail all three.
 */
/**
 * The four subject / legacy-maturity constants out of learning-unit-taxonomy.ts.
 *
 * Returns them in declaration order: subjectTypes, subjectsNames,
 * domainCodesToInclude, legacyMaturity. Each is guarded on its own expected length,
 * because a regex that stops matching yields a SHORT array rather than an error and a
 * short array would overwrite a complete document with a truncated one.
 */
async function readSubjectVocabularies() {
  const source = await import('node:fs').then(fs =>
    fs.promises.readFile(
      new URL('../src/app/data/learning-unit-taxonomy.ts', import.meta.url), 'utf8'
    )
  );

  const slice = name => {
    const start = source.indexOf(`export const ${name}`);

    if (start === -1) {
      throw new Error(`${name} is gone from learning-unit-taxonomy.ts.`);
    }

    return source.slice(start, source.indexOf('] as const;', start));
  };

  const strings = (name, expected) => {
    const found = [...slice(name).matchAll(/'([^']*)'/g)].map(([, v]) => v);

    if (found.length !== expected) {
      throw new Error(
        `Parsed ${found.length} entries from ${name}, expected ${expected} — the shape ` +
        'has changed, so this seed would write a truncated list.'
      );
    }

    return found;
  };

  const pairs = [...slice('LEARNING_UNIT_SUBJECT_TYPES')
    .matchAll(/code:\s*'([^']+)',\s*name:\s*'([^']+)'/g)]
    .map(([, code, name]) => ({ code, name }));

  if (pairs.length !== 5) {
    throw new Error(
      `Parsed ${pairs.length} subject types, expected 5 — the shape has changed.`
    );
  }

  return [
    pairs,
    strings('LEARNING_UNIT_SUBJECT_NAMES', 4),
    strings('LEARNING_UNIT_SUBJECT_DOMAIN_CODES', 10),
    strings('LEGACY_MATURITY_NAMES', 4)
  ];
}

/**
 * TACS_SEARCH_CONFIGURATION — IMPORTED, like the resource schema and for the same
 * reason: nested arrays of maps, which a regex has no business reading.
 *
 * tacs-search-configuration.ts is deliberately import-free so this works.
 *
 * THE GUARD DELIBERATELY ACCEPTS SEVEN SubjectDomain ENTRIES, not the eight production
 * has. Index 6 was never captured; see that file's header. Raise this to 8 once the
 * missing entry is supplied, so a future truncation is still caught.
 */
/**
 * LEARNING_UNIT_TYPES as production's MAP, keyed by code.
 *
 * Parsed rather than imported, because it lives in learning-unit-taxonomy.ts which
 * cannot be imported (see readSubjectVocabularies). Reshaped on the way out: the
 * constant is an array because a dropdown iterates one, the document is a map because
 * a lookup by code wants one.
 *
 * Guarded on thirteen. Four provisional entries were replaced by these, and a regex
 * that silently matched only the first few would write a document that looks complete.
 */
async function readLearningUnitTypes() {
  const source = await import('node:fs').then(fs =>
    fs.promises.readFile(
      new URL('../src/app/data/learning-unit-taxonomy.ts', import.meta.url), 'utf8'
    )
  );

  const start = source.indexOf('export const LEARNING_UNIT_TYPES');
  const body = source.slice(start, source.indexOf('] as const;', start));

  const entries = [...body.matchAll(/name:\s*'([^']+)',\s*code:\s*'([^']+)'/g)];

  if (entries.length !== 13) {
    throw new Error(
      `Parsed ${entries.length} learning unit types, expected 13 — the shape has ` +
      'changed, so this seed would write an incomplete type list.'
    );
  }

  return Object.fromEntries(entries.map(([, name, code]) => [code, { code, name }]));
}

async function readTacsSearch() {
  const { TACS_SEARCH_CONFIGURATION: config } = await import(
    '../src/app/data/tacs-search-configuration.ts'
  );

  const subjects = config?.SubjectDomain ?? [];

  if (subjects.length !== 7 || !config.BoardDomain?.length || !config.GradeDomain?.length) {
    throw new Error(
      `Imported ${subjects.length} SubjectDomain entries — tacs-search-configuration.ts ` +
      'has changed shape, so this seed would write a truncated search config.'
    );
  }

  return config;
}

async function readResourceSchema() {
  const { LEARNING_UNIT_RESOURCE_SCHEMA: schema } = await import(
    '../src/app/data/learning-unit-resource-schema.ts'
  );

  const types = Object.keys(schema ?? {});

  if (types.length !== 9 || schema?.TACtivity?.gold?.video?.tacVideoMp4 !== '') {
    throw new Error(
      `Imported ${types.length} resource types and could not resolve a known slot — ` +
      'learning-unit-resource-schema.ts has changed shape, so this seed would write a ' +
      'truncated skeleton.'
    );
  }

  return schema;
}

async function main() {
  const countryCodes = await readCountries();
  const domains = await readTaxonomy();
  const maturity = await readMaturities();
  const resources = await readResourceSchema();

  /*
   * These four are parsed out of learning-unit-taxonomy.ts by ONE pass rather than four
   * regexes, because they are all plain string-or-{code,name} arrays in the same file.
   * That file cannot be imported the way the resource schema is — it imports
   * ../models/teaching.model without a file extension, which Node's ESM resolver
   * rejects — so parsing stays the mechanism here.
   */
  const [subjectTypes, subjectsNames, domainCodesToInclude, legacyMaturity] =
    await readSubjectVocabularies();
  const tacsSearch = await readTacsSearch();
  const Types = await readLearningUnitTypes();

  /**
   * BOTH FIELDS, as production's document carries them: the same rows as an array and
   * as a map keyed by composite code. The app reads only `domains`; `domainMap` is
   * written so this document and production's are comparable field for field, and
   * because production's own sheet-push writes both.
   */
  const domainMap = Object.fromEntries(domains.map(row => [row.compositeCode, row]));

  // Not frozen, because --only prunes it below.
  const documents = {
    CountryCodes:         { countryCodes },
    BoardListAll:         { boards },
    Languages:            { langTypes },
    typeofSchools:        { typeofSchools },
    SchoolGenderTypes:    { genderTypes },
    CustomerSchool:       { options: customerSchool },
    PincodeRules:         { rules: pincodeRules },
    ClassroomTypes:       { classroomTypes },
    GradeList:            { grades },
    SectionList:          { sections },
    ProgrammeStatuses:    { statuses: programmeStatuses },
    ProgrammeTypes:       { types: programmeTypes },
    ProgrammeAges:        { ages: programmeAges },
    ProgrammeGrades:      { grades: programmeGrades },
    TeacherRoles:         { roles: teacherRoles },
    learningUnitDomains:  { domains, domainMap },
    learningUnitMaturity: { maturity },
    /**
     * `resourceSchemaId` AS WELL AS the `docId` the write path adds.
     *
     * Production's document names its own id field `resourceSchemaId`, breaking the
     * convention every other document in this collection follows. Both are written:
     * production's name so a reader that expects it finds it, and `docId` because the
     * loop below adds it to every document and this app's stated convention is that
     * an exported row is self-describing.
     *
     * `updatedBy` IS DELIBERATELY NOT PRODUCTION'S VALUE. Production records
     * "Google Sheet 'Lu Content List to Firestore Mapping'", which is true there and
     * would be a lie here — nothing in this project reads that sheet. It records what
     * actually wrote the document instead.
     */
    subjectTypes:         { subjectTypes },
    /*
     * TWO ARRAYS IN ONE DOCUMENT, which is production's own layout: the assignment
     * kinds and a form's field types share `AssignmentTypes`. Note `assignmentsTypes`
     * with the plural 's' in the middle — its spelling, not a typo here.
     */
    /*
     * SIX LISTS IN ONE DOCUMENT. The first two are production's own layout — the
     * assignment kinds and a form's field types share `AssignmentTypes`. The other
     * four are NOT production's: it hardcodes each in its own components, and they
     * are grouped here rather than given four documents because that is the
     * convention this collection already follows.
     */
    AssignmentTypes:      {
      assignmentsTypes,
      questionTypesForm,
      questionTypesQuiz,
      creatableTypes,
      pedagogyTypes,
      authenticationTypes
    },
    /* Two MAPS: what may be uploaded, and how big. See the notes above. */
    acceptedUploadFormats: { formatNames: uploadFormatNames, sizeCaps: uploadSizeCaps },
    /* Three lists, and they are deliberately not one. See the note above. */
    AssignmentStatuses:   {
      statuses: assignmentStatuses,
      liveValues: liveStatusValues,
      closedValues: closedStatusValues
    },
    /* A map of unrelated scalars, read field by field. */
    AssignmentDefaults:   { defaults: assignmentDefaults },
    /* Production's own document, mirrored. `displayName`, not `label`. */
    WorkflowTypes:        { workflowTypes },
    /*
     * TWO ARRAYS IN ONE DOCUMENT, as production has it. `subjectsNames` is listed
     * first so the summary line below reports it; both are written.
     */
    subjects:             { subjectsNames, domainCodesToInclude },
    /* Capital-M id, production's. The ladder lives in learningUnitMaturity. */
    Maturity:             { maturity: legacyMaturity },
    /*
     * INCOMPLETE BY KNOWN OMISSION: SubjectDomain holds 7 entries where production has
     * 8. See src/app/data/tacs-search-configuration.ts. Re-running this seed after the
     * missing entry is added corrects the document in place.
     */
    LearningUnitTypes:    { Types },
    LearningUnitLanguages: { langTypes: luLangTypes },
    LearningUnitDifficulty: { levels: luDifficultyLevels },
    TACsSearchConfiguration: {
      SubjectDomain: tacsSearch.SubjectDomain,
      BoardDomain: tacsSearch.BoardDomain,
      GradeDomain: tacsSearch.GradeDomain
    },
    learningUnitResourceSchema: {
      resources,
      resourceSchemaId: 'learningUnitResourceSchema',
      updatedBy: "scripts/seed-configuration.mjs, from production's 2025-07-07 push"
    }
  };

  if (ONLY) {
    const unknown = ONLY.filter(id => !(id in documents));

    if (unknown.length > 0) {
      throw new Error(
        `--only named ${unknown.join(', ')}, which ${unknown.length === 1 ? 'is' : 'are'} not ` +
        `in this seed. Known ids: ${Object.keys(documents).join(', ')}`
      );
    }

    for (const id of Object.keys(documents)) {
      if (!ONLY.includes(id)) {
        delete documents[id];
      }
    }
  }

  if (AS_JSON) {
    // docId included per document, exactly as the write path sets it.
    const withIds = Object.fromEntries(
      Object.entries(documents).map(([id, payload]) => [id, { docId: id, ...payload }])
    );
    process.stdout.write(JSON.stringify(withIds));
    return;
  }

  console.log(`${DRY_RUN ? 'DRY RUN — would write' : 'Writing'} ${Object.keys(documents).length} documents`);
  console.log(`  ${PROJECT_ID} / ${DATABASE_ID} / ${COLLECTION}\n`);

  for (const [id, payload] of Object.entries(documents)) {
    // The FIRST key, whose value is an array in every document here — including
    // learningUnitDomains, where `domains` is declared before the `domainMap` object
    // precisely so this line keeps working. Ordering carries meaning; do not reorder.
    const [key] = Object.keys(payload);
    const body = payload[key];
    // learningUnitMaturity's payload is a MAP, not an array, so .length is undefined.
    // Count keys in that case rather than printing 'undefined entries'.
    const count = Array.isArray(body) ? body.length : Object.keys(body).length;
    const extra = Object.keys(payload).length > 1
      ? ` (+ ${Object.keys(payload).slice(1).join(', ')})`
      : '';
    console.log(`  ${id.padEnd(22)} ${key}: ${count} entr${count === 1 ? 'y' : 'ies'}${extra}`);
  }

  if (DRY_RUN) {
    console.log('\nNothing written. Drop --dry-run to seed.');
    return;
  }

  const { applicationDefault, initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');

  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore(DATABASE_ID);

  const batch = db.batch();

  for (const [id, payload] of Object.entries(documents)) {
    // docId repeated in the document, as production does, so an exported row is
    // self-describing without its path.
    batch.set(db.collection(COLLECTION).doc(id), { docId: id, ...payload });
  }

  await batch.commit();
  console.log(`\nSeeded ${Object.keys(documents).length} documents.`);
}

main().catch(error => {
  console.error('\nSeed failed:', error.message);
  process.exit(1);
});

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

/** learning-unit-options.ts DIFFICULTY_LEVELS. Strings, as production stores them. */
const luDifficultyLevels = ['1', '2', '3', '4', '5'];

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

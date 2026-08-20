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
 *   node --experimental-strip-types scripts/seed-configuration.mjs
 *
 * The write path needs firebase-admin and Application Default Credentials, so run it
 * with the functions directory's node_modules on the path:
 *   NODE_PATH=functions-otp/node_modules node scripts/seed-configuration.mjs
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


/* ==========================================================================
   The values. Copied verbatim from src/app/data/*.ts — see each comment for the
   constant it mirrors. Keep them in step until the constants become fallback-only.
   ========================================================================== */

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

async function main() {
  const countryCodes = await readCountries();

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
    TeacherRoles:         { roles: teacherRoles }
  };

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
    const [key] = Object.keys(payload);
    const count = payload[key].length;
    console.log(`  ${id.padEnd(22)} ${key}: ${count} entr${count === 1 ? 'y' : 'ies'}`);
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

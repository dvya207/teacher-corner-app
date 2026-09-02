/**
 * Copies production's four reserved Assignments documents into this app's database.
 *
 *   --schema--               a field reference for a quiz
 *   ---quizzer_schema---     a worked quiz with all five question types
 *   --default_assignments--  the default upload slots
 *
 * (--trash-- is a container with no fields and is created by the first delete, so
 * it is not copied.)
 *
 * WHY MIRROR THEM AT ALL, given nothing in the app reads them. They are the
 * reference production keeps beside its data — the worked example somebody opens
 * to see what a RICH_BLANKS question looks like — and a dev database that lacks
 * them is missing the documentation, not just the rows.
 *
 * THEY ARE NOT SCHEMA THIS APP OBEYS, and that distinction is the whole reason
 * this script has a comment this long. `--schema--` names a quiz's question array
 * `questionsSchema` and puts `name` and `type` on every question. Across 174
 * questions in 37 REAL production quizzes, all three appear zero times: the live
 * documents use `questionsData` and neither extra field. Copying these documents
 * is copying a reference, not adopting a shape.
 *
 * READ FROM PRODUCTION, WRITTEN TO DEV, and never the other way. The source
 * project is hardcoded and this script has no flag to reverse it.
 *
 *   node scripts/mirror-assignment-schema-docs.mjs --dry-run
 *   node scripts/mirror-assignment-schema-docs.mjs
 */

const SOURCE_PROJECT = 'thinktac-india-production';
const TARGET_PROJECT = 'helix-staging-india';
const TARGET_DATABASE = 'teacher-corner-dev';
const COLLECTION = 'Assignments';

const DOC_IDS = ['--schema--', '---quizzer_schema---', '--default_assignments--'];

const DRY_RUN = process.argv.includes('--dry-run');

const { createRequire } = await import('node:module');
const require = createRequire(new URL('../functions-otp/package.json', import.meta.url));
const admin = require('firebase-admin');

const source = admin.initializeApp({ projectId: SOURCE_PROJECT }, 'source');
const sourceDb = admin.firestore(source);

const target = admin.initializeApp({ projectId: TARGET_PROJECT }, 'target');
const targetDb = admin.firestore(target);
targetDb.settings({ databaseId: TARGET_DATABASE });

const summarise = data =>
  Object.entries(data)
    .map(([key, value]) => (Array.isArray(value) ? `${key}[${value.length}]` : key))
    .sort()
    .join(', ');

console.log(
  (DRY_RUN ? 'DRY RUN — would copy' : 'Copying') +
    ` ${DOC_IDS.length} documents\n  ${SOURCE_PROJECT} -> ` +
    `${TARGET_PROJECT} / ${TARGET_DATABASE} / ${COLLECTION}\n`
);

let copied = 0;

for (const id of DOC_IDS) {
  const snapshot = await sourceDb.collection(COLLECTION).doc(id).get();

  if (!snapshot.exists) {
    console.log(`  ${id.padEnd(26)} MISSING IN SOURCE — skipped`);
    continue;
  }

  const data = snapshot.data();

  console.log(`  ${id.padEnd(26)} ${summarise(data)}`);

  if (!DRY_RUN) {
    // set(), not update(): the copy should BE the source document, so a field
    // removed upstream goes here too rather than lingering.
    await targetDb.collection(COLLECTION).doc(id).set(data);
    copied++;
  }
}

console.log(
  DRY_RUN ? '\nNothing written. Drop --dry-run to copy.' : `\nCopied ${copied} documents.`
);

process.exit(0);

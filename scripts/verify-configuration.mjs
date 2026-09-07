/**
 * Compares the Configuration documents LIVE in `teacher-corner-dev` against what
 * `seed-configuration.mjs` would write, and reports every difference.
 *
 * WHY THIS IS A SCRIPT AND NOT A SPEC. The drift this exists to catch is between
 * a constant in this repo and a document in Firestore, and a unit test cannot see
 * Firestore. Every purely in-repo version of this check is tautological: the seed
 * script IMPORTS `LEARNING_UNIT_RESOURCE_SCHEMA` rather than restating it, and
 * `resourceSlotsFor` reads the same constant, so a spec asserting they agree can
 * never fail. The only assertion with teeth is against the live database.
 *
 * THE FAILURE IT WAS WRITTEN FOR. `Configuration/learningUnitResourceSchema`
 * carried three of the six `TACtivity/gold/3S` slots. The learning-unit editor
 * renders its upload tabs from the static constant, so it offered all six and a
 * teacher could upload a Pre-Test Questionnaire, a Post-Test Questionnaire or a
 * SCAMPER file. The classroom step dialog builds its Content Sub Category select
 * from the LIVE document, so no workflow step could name any of the three. The
 * file was uploaded, stored, and unreachable, in this app and in the Flutter app
 * that resolves a step's content by exactly that sub-category. Nothing failed
 * loudly; a dropdown was simply short.
 *
 * READ ONLY. It writes nothing and never repairs anything, so it is safe to run
 * against any database. When it reports drift the fix is a seed:
 *
 *     node scripts/seed-configuration.mjs --only <id> --dry-run
 *     node scripts/seed-configuration.mjs --only <id>
 *
 * EXITS NON-ZERO ON DRIFT, so CI or a pre-deploy hook can gate on it.
 *
 * Usage:
 *   node scripts/verify-configuration.mjs
 *   node scripts/verify-configuration.mjs --only learningUnitResourceSchema
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = 'helix-staging-india';
const DATABASE_ID = 'teacher-corner-dev';
const COLLECTION = 'Configuration';

const onlyIndex = process.argv.indexOf('--only');
const ONLY =
  onlyIndex === -1
    ? null
    : (process.argv[onlyIndex + 1] ?? '').split(',').map(s => s.trim()).filter(Boolean);

/**
 * What the seed WOULD write, taken from the seed script itself.
 *
 * Via its own `--json` flag rather than by importing its internals: the
 * payload is assembled by a long private function that parses several other data
 * files, and a second copy of that assembly here is precisely the duplication
 * this script exists to detect.
 */
function expectedDocuments() {
  const args = [join(HERE, 'seed-configuration.mjs'), '--json'];

  if (ONLY) {
    args.push('--only', ONLY.join(','));
  }

  // stderr inherited so the seed's own warnings stay visible; only stdout is JSON.
  return JSON.parse(
    execFileSync(process.execPath, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      maxBuffer: 64 * 1024 * 1024
    })
  );
}

/**
 * Every leaf path where two values differ, as dotted keys.
 *
 * COMPARES BOTH DIRECTIONS at every level, because the two interesting faults are
 * opposite: a key the seed has and the database lacks is an option a form will not
 * offer, and a key the database has and the seed lacks is something a whole-document
 * `set()` would silently delete on the next run.
 *
 * A Firestore timestamp or any other non-plain value is compared by JSON shape,
 * which is enough to say "these are not the same" without teaching this script
 * about every Admin SDK type.
 */
function diff(expected, actual, path = '') {
  const at = key => (path ? `${path}.${key}` : key);
  const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);

  if (plain(expected) && plain(actual)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();

    return keys.flatMap(key => {
      if (!(key in actual)) return [{ path: at(key), kind: 'missing from live' }];
      if (!(key in expected)) return [{ path: at(key), kind: 'only in live' }];

      return diff(expected[key], actual[key], at(key));
    });
  }

  return JSON.stringify(expected) === JSON.stringify(actual)
    ? []
    : [
        {
          path: path || '(root)',
          kind: 'differs',
          expected: JSON.stringify(expected),
          actual: JSON.stringify(actual)
        }
      ];
}

async function main() {
  const expected = expectedDocuments();

  const { applicationDefault, initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');

  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore(DATABASE_ID);

  console.log(`Verifying ${PROJECT_ID} / ${DATABASE_ID} / ${COLLECTION}`);
  console.log(`  ${Object.keys(expected).length} document(s) to check\n`);

  let drifted = 0;

  for (const [id, payload] of Object.entries(expected)) {
    const snap = await db.collection(COLLECTION).doc(id).get();

    if (!snap.exists) {
      drifted += 1;
      console.log(`${id}: ABSENT from the database`);
      continue;
    }

    // `updatedBy` is a provenance note the seed stamps with its own name and is
    // expected to differ from whatever wrote the document last. Comparing it would
    // report drift on every document forever and drown the differences that matter.
    const { updatedBy: _ignoredExpected, ...want } = payload;
    const { updatedBy: _ignoredActual, ...got } = snap.data() ?? {};

    const differences = diff(want, got);

    if (differences.length === 0) {
      console.log(`${id}: matches`);
      continue;
    }

    drifted += 1;
    console.log(`${id}: ${differences.length} difference(s)`);

    for (const d of differences.slice(0, 40)) {
      const detail =
        d.kind === 'differs' ? ` (seed=${d.expected} live=${d.actual})` : '';
      console.log(`   ${d.kind.padEnd(18)} ${d.path}${detail}`);
    }

    if (differences.length > 40) {
      console.log(`   ... and ${differences.length - 40} more`);
    }
  }

  if (drifted === 0) {
    console.log('\nEvery document matches the seed.');
    return;
  }

  console.log(
    `\n${drifted} document(s) differ from the seed. Reseed the affected ids:\n` +
      '  node scripts/seed-configuration.mjs --only <id> --dry-run'
  );
  process.exitCode = 1;
}

main().catch(error => {
  console.error('\nVerify failed:', error.message);
  process.exit(1);
});

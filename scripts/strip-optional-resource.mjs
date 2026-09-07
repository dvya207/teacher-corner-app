/**
 * Removes `optionalResource` from quiz questions in this app's own assignments.
 *
 * WHY. The Add Resources section was excluded from the UI on instruction, so every
 * question this app wrote carried `optionalResource: []` — a key nothing here
 * could ever fill. The field is gone from the model; this clears what was already
 * written.
 *
 * IT ONLY TOUCHES EMPTY ARRAYS, and that is the safety this script turns on. A
 * quiz created in PRODUCTION carries real entries there — a YouTube link, a PDF
 * under `quizzer_resources/` — and this app cannot display them, so deleting them
 * would be destroying data blind. A non-empty list is reported and left alone.
 *
 * ROWS THIS APP OWNS ONLY. Documents without an `ownerId` are production's mirrored
 * reference documents (--schema--, ---quizzer_schema---, --default_assignments--)
 * and are skipped: they are a reference, not this app's data to edit.
 *
 *   node scripts/strip-optional-resource.mjs --dry-run
 *   node scripts/strip-optional-resource.mjs
 */

const PROJECT_ID = 'helix-staging-india';
const DATABASE_ID = 'teacher-corner-dev';
const COLLECTION = 'Assignments';

const DRY_RUN = process.argv.includes('--dry-run');

const { createRequire } = await import('node:module');
const require = createRequire(new URL('../functions-otp/package.json', import.meta.url));
const admin = require('firebase-admin');

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
db.settings({ databaseId: DATABASE_ID });

console.log(
  (DRY_RUN ? 'DRY RUN — ' : '') + `Scanning ${PROJECT_ID} / ${DATABASE_ID} / ${COLLECTION}\n`
);

const snapshot = await db.collection(COLLECTION).get();

let changed = 0;
let keptNonEmpty = 0;

for (const document of snapshot.docs) {
  const data = document.data();

  if (!data.ownerId) {
    continue;
  }

  const questions = data.questionsData;

  if (!Array.isArray(questions) || questions.length === 0) {
    continue;
  }

  let touched = 0;
  let kept = 0;

  const next = questions.map(question => {
    if (!('optionalResource' in question)) {
      return question;
    }

    const resources = question.optionalResource;

    // A real list stays. See the note at the top.
    if (Array.isArray(resources) && resources.length > 0) {
      kept++;
      return question;
    }

    touched++;

    // Rebuilt without the key rather than set to a sentinel: the point is that the
    // field is absent, and FieldValue.delete() cannot reach inside an array.
    const { optionalResource: _dropped, ...rest } = question;

    return rest;
  });

  if (kept > 0) {
    keptNonEmpty += kept;
    console.log(
      `  ${String(data.displayName).padEnd(20)} ${kept} question(s) hold REAL ` +
        'resources — left untouched'
    );
  }

  if (touched === 0) {
    continue;
  }

  console.log(
    `  ${String(data.displayName).padEnd(20)} clearing the empty key on ${touched} question(s)`
  );

  if (!DRY_RUN) {
    await document.ref.update({ questionsData: next });
    changed++;
  }
}

console.log(
  '\n' +
    (DRY_RUN
      ? 'Nothing written. Drop --dry-run to apply.'
      : `Updated ${changed} document(s).`) +
    (keptNonEmpty > 0 ? ` ${keptNonEmpty} question(s) with real resources kept.` : '')
);

process.exit(0);

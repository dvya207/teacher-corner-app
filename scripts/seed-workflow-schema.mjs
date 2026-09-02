/**
 * Seeds `workflows/--schema--`, production's own reference document.
 *
 *   node scripts/seed-workflow-schema.mjs --dry-run
 *   node scripts/seed-workflow-schema.mjs
 *
 * WHAT A SENTINEL IS FOR. `Workflows/--schema--` is not a workflow: it is a
 * document describing the shape, kept in the collection so anyone browsing the
 * console can see what a workflow looks like without opening a real one. The
 * collection also holds `--trash--`, the container the deleted ones hang under.
 * Neither is a row, which is why the rules exclude both from create, update and
 * delete, and why `workflowDoc()` refuses to build a reference to either.
 *
 * COPIED VERBATIM, INCLUDING FIELDS NOTHING WRITES — and that is the point rather
 * than an oversight. Its steps carry `workflowStepId`, `workflowStepType` and
 * `workflowSubtitle`, and the document carries `linkageWorkFlowId`; measured across
 * production's 2593 real workflow steps, `workflowStepId` appears in NONE of them
 * and the other two in 37. The sentinel is a historical description, not the live
 * shape. Seeding a "corrected" version would make this app's reference document
 * disagree with production's, which is the one thing a reference document must not
 * do.
 *
 * ITS CONTENTS USE `contentType` ALONE — 'video', 'guide', 'material',
 * 'observation', 'image', 'pdf', 'urlLink', 'quiz' — with no `contentCategory` or
 * `contentSubCategory`. Real documents carry the category pair and leave
 * `contentType` empty or semantic. Again: kept as found.
 *
 * `workflowId: 'random doc id'` is production's literal placeholder string. It is
 * not an id and is not meant to resolve.
 */

import { createRequire } from 'node:module';

const require = createRequire(new URL('../functions-otp/package.json', import.meta.url));
const admin = require('firebase-admin');

const PROJECT = 'helix-staging-india';
const DATABASE = 'teacher-corner-dev';
const DRY_RUN = process.argv.includes('--dry-run');

admin.initializeApp({ projectId: PROJECT });

const db = admin.firestore();

db.settings({ databaseId: DATABASE });

const { Timestamp } = admin.firestore;

/** IST, as production stores them: 00:00:00 UTC+5:30. */
const jan24 = Timestamp.fromDate(new Date('2023-01-23T18:30:00.000Z'));
const jan19 = Timestamp.fromDate(new Date('2023-01-18T18:30:00.000Z'));

/** One content block, in the sentinel's own shape. */
function content(contentName, contentType, contentIsLocked, extra = {}) {
  return { contentIsLocked, contentName, contentType, resourcePath: '', ...extra };
}

/**
 * One step, in the sentinel's own shape.
 *
 * `workflowSubtitle` IS OMITTED ON THE LAST STEP, and that is production's
 * document rather than a slip in this script — a field-by-field comparison caught
 * it. Its steps 1 to 3 carry the key as '' and step 4 does not carry it at all.
 * Writing it everywhere would make this app's reference document disagree with the
 * one it is a copy of, which is the single thing a reference document must not do.
 */
function step(sequenceNumber, workflowStepName, workflowStepId, allowAccess, contents, options = {}) {
  const built = {
    allowAccess,
    canSkipWorkflowStep: allowAccess,
    contents,
    sequenceNumber,
    viewUnlab: true,
    workflowLocation: '',
    workflowStepDescription: '',
    workflowStepDuration: '',
    workflowStepId,
    workflowStepName,
    workflowStepType: ''
  };

  if (options.subtitle !== false) {
    built.workflowSubtitle = '';
  }

  return built;
}

const SCHEMA = {
  docId: '--schema--',
  linkageWorkFlowId: '',
  workflowId: 'random doc id',
  workflowSteps: [
    step(1, 'Create & Learn', 'qwertyuiopasdfghjklzxcvbnm', true, [
      content('Tactivity Video', 'video', true),
      content('Quick Guide', 'guide', false)
    ]),
    step(2, 'Resources', 'mnbvcxzlkjhgfdsapoiuytrewq', true, [
      content('Material Required', 'material', true),
      content('Observation Sheet', 'observation', true)
    ]),
    /*
     * STEP 3 CARRIES '' FOR allowAccess AND canSkipWorkflowStep, not a boolean —
     * production's own sentinel does, and the live data holds all four types in
     * those fields (boolean, '', a number and null). Kept as found.
     */
    step(3, 'Assignment', 'lkjhgfdsaqwertyuiopmnbvcxz', '', [
      content('Upload the image of completed activity', 'image', '', {
        assignmentDueDate: jan24,
        assignmentType: 'UPLOAD',
        /* BOTH `assignmentDueDate` AND `dueDate`, with DIFFERENT dates. The
           duplication is production's; neither is derived from the other. */
        dueDate: jan19,
        type: 'UPLOAD'
      }),
      content('Fill the observation sheet', 'pdf', true),
      content('Join the live session', 'urlLink', false)
    ]),
    // NO `workflowSubtitle` ON THIS ONE — see the note on `step`.
    step(4, 'Quiz', 'uytrewqpoilkjhgfdsazxcvbnm', '', [
      content('Quiz', 'quiz', true)
    ], { subtitle: false })
  ]
};

const steps = SCHEMA.workflowSteps.length;
const blocks = SCHEMA.workflowSteps.reduce((total, s) => total + s.contents.length, 0);

console.log(`${DRY_RUN ? 'DRY RUN — would write' : 'Writing'} 1 document`);
console.log(`  ${PROJECT} / ${DATABASE} / workflows`);
console.log(`\n  --schema--             ${steps} steps, ${blocks} content blocks`);
console.log(`  steps: ${SCHEMA.workflowSteps.map(s => s.workflowStepName).join(', ')}`);

if (DRY_RUN) {
  console.log('\nNothing written. Drop --dry-run to seed.');
} else {
  /*
   * WRITTEN THROUGH THE ADMIN SDK, which bypasses the security rules — and it has
   * to: those rules deny writes to this very id, precisely so the app cannot
   * overwrite it. A sentinel is seeded by an operator, not by the product.
   */
  await db.collection('workflows').doc('--schema--').set(SCHEMA);
  console.log('\nSeeded workflows/--schema--');
}

process.exit(0);

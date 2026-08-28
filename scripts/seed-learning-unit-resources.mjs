#!/usr/bin/env node --experimental-strip-types
//
// Creates the `learningUnitResources` collection in helix-staging-india /
// teacher-corner-dev: one document per learning unit PER MATURITY RUNG, stamped
// from the resource schema.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY A COLLECTION HAS TO BE SEEDED AT ALL
//
// Firestore has no empty collections. `learningUnitResources` exists the moment
// a document is written into it and not before, so "create the collection" means
// "write its first documents". The app would do that by itself the first time a
// video link is saved — but that write is denied until the rules for this
// collection are deployed, and this script goes in over the Admin API, which
// rules do not apply to.
//
// ─────────────────────────────────────────────────────────────────────────────
// ONE DOCUMENT PER RUNG, NOT ONE PER UNIT
//
// The maturity ladder is CUMULATIVE. A Gold unit has a Silver document and a
// Gold one; a Platinum unit has three. That is production's shape — see
// LearningUnitResources in thinktac-india-production, where a Platinum unit's
// learning unit carries silver, gold and platinum ids in its resources map.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE SLOTS COME FROM THE SCHEMA, IMPORTED RATHER THAN COPIED
//
// node --experimental-strip-types reads the .ts module directly, so this script
// stamps exactly what src/app/data/learning-unit-resource-schema.ts says and
// cannot drift from what the editor renders. A document therefore carries ONLY
// the slots its type and rung actually has — 3S has three at Gold and one at
// Platinum, and neither carries the other's.
//
// ─────────────────────────────────────────────────────────────────────────────
// USAGE
//
//     gcloud auth application-default login          # once
//
//     node scripts/seed-learning-unit-resources.mjs                 # dry run
//     node scripts/seed-learning-unit-resources.mjs --apply
//     node scripts/seed-learning-unit-resources.mjs --teardown --apply
//
// Re-running is idempotent: a rung that already has a document is left alone
// rather than rewritten, so an uploaded path is never clobbered by a reseed.

import { execFileSync } from 'node:child_process';

import { LEARNING_UNIT_RESOURCE_SCHEMA } from '../src/app/data/learning-unit-resource-schema.ts';

/**
 * The cumulative ladder, lowest rung first.
 *
 * NOT imported from learning-unit-taxonomy.ts, though that is where the app's
 * copy lives: node's ESM resolver rejects the extensionless relative imports
 * that file uses, and adding a loader to a seed script costs more than these
 * four lines. The resource SCHEMA is imported rather than copied, because that
 * is the part that changes and the part that must not drift.
 */
const LADDER = {
  Silver: ['Silver'],
  Gold: ['Silver', 'Gold'],
  Platinum: ['Silver', 'Gold', 'Platinum'],
  Diamond: ['Silver', 'Gold', 'Platinum', 'Diamond']
};

const PROJECT = 'helix-staging-india';
const DATABASE = 'teacher-corner-dev';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/documents`;

const APPLY = process.argv.includes('--apply');
const TEARDOWN = process.argv.includes('--teardown');

const token = execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'], {
  encoding: 'utf8'
}).trim();

const authorised = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

/** Firestore's REST encoding. Integers must be strings; a bare number is a double. */
function encode(value) {
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (value && typeof value === 'object') {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])) } };
  }
  return { nullValue: null };
}

async function get(path) {
  const response = await fetch(`${BASE}/${path}`, { headers: authorised });
  return response.json();
}

/** The rungs a unit has, lowest first. Matched case-insensitively, as the app does. */
function rungsFor(maturity) {
  const wanted = String(maturity ?? '').trim().toLowerCase();
  const level = Object.keys(LADDER).find(name => name.toLowerCase() === wanted);

  return level ? LADDER[level] : [];
}

/** The empty slot map for a type and rung. Cloned — the schema is shared and frozen. */
function skeletonFor(type, rung) {
  const byType = LEARNING_UNIT_RESOURCE_SCHEMA[String(type ?? '').replace(/\s+/g, '')];
  const categories = byType?.[rung.toLowerCase()];

  return categories ? structuredClone(categories) : {};
}

const units = (await get('learningUnits?pageSize=300')).documents ?? [];
const existing = (await get('learningUnitResources?pageSize=300')).documents ?? [];

// Keyed unit+rung, so a reseed can tell what is already there.
const already = new Set(
  existing.map(document => {
    const f = document.fields ?? {};
    return `${f.learningUnitDocId?.stringValue}|${f.maturity?.stringValue}`;
  })
);

console.log(`project  : ${PROJECT}`);
console.log(`database : ${DATABASE}   (learningUnitResources only)`);
console.log(`units    : ${units.length}   existing resource documents: ${existing.length}`);
console.log(`mode     : ${APPLY ? (TEARDOWN ? 'TEARDOWN' : 'apply') : 'dry run (nothing will change)'}`);
console.log('');

if (TEARDOWN) {
  let removed = 0;

  for (const document of existing) {
    const id = document.name.split('/').pop();

    if (!APPLY) {
      console.log(`would delete learningUnitResources/${id}`);
      removed++;
      continue;
    }

    const response = await fetch(`${BASE}/learningUnitResources/${id}`, {
      method: 'DELETE',
      headers: authorised
    });

    if (!response.ok) {
      console.error(`FAILED to delete ${id}: ${await response.text()}`);
      process.exit(1);
    }

    console.log(`deleted learningUnitResources/${id}`);
    removed++;
  }

  console.log(`\n${removed} document(s) ${APPLY ? 'deleted' : 'would be deleted'}.`);
  process.exit(0);
}

let written = 0;
let skipped = 0;

for (const unit of units) {
  const f = unit.fields ?? {};
  const learningUnitDocId = unit.name.split('/').pop();
  const type = f.type?.stringValue ?? '';
  const maturity = f.Maturity?.stringValue ?? '';
  const learningUnitId = f.learningUnitId?.stringValue ?? '';
  const rungs = rungsFor(maturity);

  if (rungs.length === 0) {
    console.log(`skipping ${learningUnitId}: maturity ${maturity || '(none)'} is not on the ladder`);
    continue;
  }

  for (const rung of rungs) {
    if (already.has(`${learningUnitDocId}|${rung}`)) {
      skipped++;
      continue;
    }

    const resources = skeletonFor(type, rung);
    const slots = Object.values(resources).reduce((total, cat) => total + Object.keys(cat).length, 0);

    if (!APPLY) {
      console.log(
        `would write ${learningUnitId} ${rung}: ` +
          `${Object.keys(resources).length} categories, ${slots} slots ` +
          `[${Object.keys(resources).join(', ') || 'none'}]`
      );
      written++;
      continue;
    }

    // POST so Firestore allocates the id, then a patch puts it in docId.
    //
    // docId ONLY. `id` and `archives` are NOT written: sampling sixty of
    // production's documents, both appear only on those created between 2024-12
    // and 2025-03 and on none of the thirty-five since, including every one from
    // 2026. The current shape is these eight fields.
    const created = await fetch(`${BASE}/learningUnitResources`, {
      method: 'POST',
      headers: authorised,
      body: JSON.stringify({
        fields: {
          learningUnitDocId: encode(learningUnitDocId),
          learningUnitId: encode(learningUnitId),
          maturity: encode(rung),
          type: encode(type),
          resources: encode(resources),
          createdAt: { timestampValue: new Date().toISOString() },
          updatedAt: { timestampValue: new Date().toISOString() }
        }
      })
    });

    if (!created.ok) {
      console.error(`FAILED ${learningUnitId} ${rung}: ${await created.text()}`);
      process.exit(1);
    }

    const id = (await created.json()).name.split('/').pop();

    // The id is only known after the write, so docId goes back in a patch.
    await fetch(`${BASE}/learningUnitResources/${id}?updateMask.fieldPaths=docId`, {
      method: 'PATCH',
      headers: authorised,
      body: JSON.stringify({ fields: { docId: encode(id) } })
    });

    console.log(`wrote ${learningUnitId} ${rung} -> learningUnitResources/${id} (${slots} slots)`);
    written++;
  }
}

console.log(`\n${written} document(s) ${APPLY ? 'written' : 'would be written'}, ${skipped} already present.`);

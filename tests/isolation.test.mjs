/**
 * Structure guard.
 *
 * This app now owns the 'teacher-corner-dev' database outright, so isolation
 * from BugPulse is enforced by the platform rather than by discipline — a
 * different database simply cannot be addressed. The BugPulse deny-list this
 * file used to carry has been removed as obsolete.
 *
 * What still needs guarding is the SHAPE, which rules cannot express:
 *
 *   1. Every Firestore path is built in core/firestore-paths.ts. Paths spread
 *      across a dozen services drift; a typo surfaces as an empty result rather
 *      than an error.
 *   2. Active and deleted institutions live in exactly two places, both
 *      subcollections of one container document. A second trash collection, or
 *      a `deleted` flag, would reintroduce the failure mode the move-based
 *      trash was built to remove.
 *   3. Every top-level query carries the ownerId filter, which the rules
 *      require and which fails only at runtime if forgotten.
 *
 * Run with:  npm run test:isolation
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');

/** The one file allowed to call collection()/doc() directly. */
const PATH_BUILDER = 'src/app/core/firestore-paths.ts';

/**
 * Names that must never reappear.
 *
 * Not because they could be reached — they are in a different database now —
 * but because their presence would mean someone had pointed this app back at
 * the shared database, undoing the split.
 */
const FOREIGN_NAMES = ['bugpulse_users', 'bugpulse_attachments'];

/**
 * Removes comments while preserving string literals.
 *
 * Both checks below have to run against CODE, not prose. The comments in this
 * codebase deliberately discuss `collection(db, …)` and name BugPulse's
 * collections in order to explain why they are off limits, and a naive scan
 * flags exactly the documentation that makes the rule understandable.
 *
 * Strings are kept because check 1 is specifically looking for string literals.
 * A regex cannot do this correctly — `'https://x'` contains `//` — so this
 * walks the text tracking whether it is inside a string, a line comment, or a
 * block comment, and emits only what is code or string.
 */
function stripComments(text) {
  let out = '';
  let i = 0;
  let quote = null;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (quote) {
      out += ch;

      if (ch === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }

      if (ch === quote) {
        quote = null;
      }

      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      i++;
      continue;
    }

    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    // HTML comments, for the .html templates.
    if (ch === '<' && text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i);
      i = end === -1 ? text.length : end + 3;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

function sourceFiles(dir) {
  const found = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (/\.(ts|html)$/.test(entry)) {
      found.push(full);
    }
  }

  return found;
}

const FILES = sourceFiles(SRC).map(full => {
  const raw = readFileSync(full, 'utf8');

  return {
    path: relative(ROOT, full).split('\\').join('/'),
    raw,
    /** Comments removed, strings kept. Both checks run against this. */
    text: stripComments(raw)
  };
});

test('src/ is not empty (the scan would pass vacuously otherwise)', () => {
  assert.ok(FILES.length > 5, `expected to scan several files, found ${FILES.length}`);
});

test('no BugPulse collection is named in a string literal', () => {
  const offenders = [];

  for (const { path, text } of FILES) {
    for (const name of FOREIGN_NAMES) {
      const quoted = new RegExp(`['"\`]${name}['"\`]`);

      if (quoted.test(text)) {
        offenders.push(`${path} references "${name}" in a string literal`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Teacher Corner must not touch BugPulse data:\n  ${offenders.join('\n  ')}`
  );
});

test('only firestore-paths.ts builds Firestore references', () => {
  // collection(db, …) / doc(db, …) are the two entry points that can address an
  // arbitrary path. doc(someCollectionRef, id) is fine — it is already scoped
  // by the reference it is given — so the check is specifically for `db`.
  const rawReference = /\b(collection|doc)\s*\(\s*db\b/;
  const offenders = [];

  for (const { path, text } of FILES) {
    if (path === PATH_BUILDER) {
      continue;
    }

    if (rawReference.test(text)) {
      offenders.push(`${path} builds a Firestore reference directly from db`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Route Firestore paths through userCollection()/userDoc():\n  ${offenders.join('\n  ')}`
  );
});

test('the path builder declares exactly the approved collections', () => {
  const builder = FILES.find(f => f.path === PATH_BUILDER);

  assert.ok(builder, `${PATH_BUILDER} is missing — the isolation guard depends on it`);

  // Adding a collection is a decision, not an implementation detail: it changes
  // what the security rules have to cover. A new name must be added here and to
  // the rules in the same change, so this test fails until both are done.
  for (const [key, name] of Object.entries({
    institutions: 'institutions',
    users: 'users',
    classrooms: 'classrooms',
    programmes: 'programmes',
    learningUnits: 'learningUnits',
    teachers: 'teachers'
  })) {
    assert.match(
      builder.text,
      new RegExp(`${key}:\\s*'${name}'`),
      `COLLECTIONS must map ${key} -> ${name}`
    );
  }

  // Collection names must come from the frozen map, never from a caller.
  assert.match(
    builder.text,
    /COLLECTIONS = Object\.freeze\(/,
    'collection names must live in a frozen map'
  );

  // ONE top-level collection. Active institutions are documents directly inside
  // it; deleted ones live in a subcollection under the `trash` sentinel
  // document, which sits in that same collection. No wrapper collection, no
  // items level.
  //
  //   institutions/{id}
  //   institutions/trash/DeletedInstitutes/{id}
  assert.match(builder.text, /collection\(db,\s*COLLECTIONS\.institutions\)/, 'active institutions must be the institutions collection');
  assert.match(builder.text, /TRASH_DOC\s*=\s*'trash'/, 'the trash sentinel document must be `trash`');
  assert.match(builder.text, /TRASH_SUBCOLLECTION\s*=\s*'DeletedInstitutes'/, 'deleted institutions must live in `DeletedInstitutes`, matching production');
  assert.match(builder.text, /doc\(db,\s*COLLECTIONS\.institutions,\s*TRASH_DOC\)/, 'the trash container must sit in the institutions collection');
  assert.match(builder.text, /collection\(trashContainer\(\),\s*TRASH_SUBCOLLECTION\)/, 'deleted institutions must be a subcollection of the trash document');

  // Classrooms repeat the shape exactly, one collection over:
  //
  //   classrooms/{id}
  //   classrooms/trash/DeletedClassrooms/{id}
  //
  // Same sentinel document id, different subcollection beneath it — so a
  // deleted classroom can never land among the deleted institutions.
  assert.match(builder.text, /collection\(db,\s*COLLECTIONS\.classrooms\)/, 'active classrooms must be the classrooms collection');
  assert.match(builder.text, /CLASSROOM_TRASH_SUBCOLLECTION\s*=\s*'DeletedClassrooms'/, 'deleted classrooms must live in `DeletedClassrooms`, matching production');
  assert.match(builder.text, /doc\(db,\s*COLLECTIONS\.classrooms,\s*TRASH_DOC\)/, 'the classroom trash container must sit in the classrooms collection');
  assert.match(builder.text, /collection\(classroomTrashContainer\(\),\s*CLASSROOM_TRASH_SUBCOLLECTION\)/, 'deleted classrooms must be a subcollection of the trash document');

  // Programmes repeat the shape a third time:
  //
  //   programmes/{id}
  //   programmes/trash/DeletedProgrammes/{id}
  assert.match(builder.text, /collection\(db,\s*COLLECTIONS\.programmes\)/, 'programmes must be a top-level collection');
  assert.match(builder.text, /PROGRAMME_TRASH_SUBCOLLECTION\s*=\s*'DeletedProgrammes'/, 'deleted programmes must live in `DeletedProgrammes`, matching production');
  assert.match(builder.text, /doc\(db,\s*COLLECTIONS\.programmes,\s*TRASH_DOC\)/, 'the programme trash container must sit in the programmes collection');
  assert.match(builder.text, /collection\(programmeTrashContainer\(\),\s*PROGRAMME_TRASH_SUBCOLLECTION\)/, 'deleted programmes must be a subcollection of the trash document');

  // Learning units repeat the shape a fourth time:
  //
  //   learningUnits/{id}
  //   learningUnits/trash/DeletedLearningUnits/{id}
  assert.match(builder.text, /collection\(db,\s*COLLECTIONS\.learningUnits\)/, 'active learning units must be the learningUnits collection');
  assert.match(builder.text, /LEARNING_UNIT_TRASH_SUBCOLLECTION\s*=\s*'DeletedLearningUnits'/, 'deleted learning units must live in `DeletedLearningUnits`, matching production');
  assert.match(builder.text, /doc\(db,\s*COLLECTIONS\.learningUnits,\s*TRASH_DOC\)/, 'the learning-unit trash container must sit in the learningUnits collection');
  assert.match(builder.text, /collection\(learningUnitTrashContainer\(\),\s*LEARNING_UNIT_TRASH_SUBCOLLECTION\)/, 'deleted learning units must be a subcollection of the trash document');

  // Teachers repeat the shape a fifth time:
  //
  //   teachers/{id}
  //   teachers/trash/DeletedTeachers/{id}
  //
  // A flat top-level collection, NOT a subcollection of the institution the
  // teacher belongs to — institutionId is a field, so a list spanning
  // institutions needs no collection-group query, no index and no second rule
  // block.
  assert.match(builder.text, /collection\(db,\s*COLLECTIONS\.teachers\)/, 'active teachers must be the teachers collection');
  assert.match(builder.text, /TEACHER_TRASH_SUBCOLLECTION\s*=\s*'DeletedTeachers'/, 'deleted teachers must live in `DeletedTeachers`, matching the production naming style');
  assert.match(builder.text, /doc\(db,\s*COLLECTIONS\.teachers,\s*TRASH_DOC\)/, 'the teacher trash container must sit in the teachers collection');
  assert.match(builder.text, /collection\(teacherTrashContainer\(\),\s*TEACHER_TRASH_SUBCOLLECTION\)/, 'deleted teachers must be a subcollection of the trash document');

  // The programme-code counter hangs off the teacher's own profile, so it is
  // owner-scoped BY PATH and needs no rule of its own. A top-level counter
  // would have to be writable by every authenticated user — see the note on
  // programmeCounterDoc().
  assert.match(
    builder.text,
    /doc\(\s*db,\s*COLLECTIONS\.users,\s*uid,\s*'counters',\s*'programmes'\s*\)/,
    'the programme counter must live under the teacher\'s own profile'
  );

  assert.doesNotMatch(builder.text, /ITEMS_SUBCOLLECTION|'items'/, 'no items level');

  assert.match(
    builder.text,
    /collection\(\s*db,\s*COLLECTIONS\.users,\s*uid,\s*name\s*\)/,
    'userSubcollection() must root its path at the users collection'
  );
});

test('Teacher Corner declares no second top-level collection for the trash', () => {
  const builder = FILES.find(f => f.path === PATH_BUILDER);

  // A top-level trash collection was explicitly rejected. Deleted institutions
  // hang off the `trash` DOCUMENT inside the one institutions collection.
  //
  // This asserts the SHAPE, not a name. An earlier version banned the string
  // `DeletedInstitutes` because that name was once proposed for a top-level
  // collection; it is now the subcollection name, so banning it tested nothing
  // useful and failed the moment the rename landed.
  assert.doesNotMatch(builder.text, /'items'/, 'no items level');

  // The trash collection must be rooted at the container DOCUMENT. Rooting it
  // at db would make it top-level, which is the thing being prevented.
  assert.match(
    builder.text,
    /collection\(trashContainer\(\),\s*TRASH_SUBCOLLECTION\)/,
    'the trash must be a subcollection of the trash document, not a root collection'
  );
  assert.doesNotMatch(
    builder.text,
    /collection\(\s*db,\s*TRASH_SUBCOLLECTION/,
    'the trash subcollection must never be built directly off db'
  );

  // COLLECTIONS lists the top-level collections. A trash entry there would mean
  // a second top-level collection had been declared.
  const topLevel = builder.text.slice(
    builder.text.indexOf('COLLECTIONS = Object.freeze('),
    builder.text.indexOf('OWNER_FIELD')
  );
  assert.doesNotMatch(topLevel, /trash|Deleted/i, 'no trash entry among the top-level collections');
});

test('there is exactly ONE active location and ONE deleted location', () => {
  const builder = FILES.find(f => f.path === PATH_BUILDER);

  // Guards the core promise of this structure: a deleted institution is not in
  // schema with a flag set, it is not in schema at all.
  const activeRefs = (builder.text.match(/COLLECTIONS\.institutions\b/g) || []).length;
  const trashRefs = (builder.text.match(/TRASH_SUBCOLLECTION/g) || []).length;

  assert.ok(activeRefs >= 1, 'institutions must be used to build the active collection');
  assert.ok(trashRefs >= 1, 'the trash subcollection must be used');

  // The sentinel id is reserved, and that must be enforced rather than assumed.
  assert.match(builder.text, /assertNotTrashSentinel/, 'the reserved trash id must be rejected in code');

  // No `deleted` flag anywhere: Firestore location is the source of truth.
  for (const { path, text } of FILES) {
    assert.doesNotMatch(
      text,
      /['"]deleted['"]\s*:|\.deleted\s*===|deleted:\s*(true|false)/,
      `${path} must not use a deleted flag — the document's location is the truth`
    );
  }
});

test('top-level collections are always queried with the owner filter', () => {
  const builder = FILES.find(f => f.path === PATH_BUILDER);

  // institutions and classrooms carry ownership in a field rather than the
  // path, so an unfiltered list is rejected by the rules at runtime. Building
  // the filter into the only query helper is what stops that reaching prod.
  assert.match(
    builder.text,
    /where\(\s*OWNER_FIELD,\s*'==',\s*uid\s*\)/,
    'ownedByUser() must constrain the query by the owner field'
  );

  assert.match(builder.text, /OWNER_FIELD\s*=\s*'ownerId'/, 'owner field must be ownerId');
});

test('the app targets its OWN database, never a shared one', () => {
  const firebase = FILES.find(f => f.path === 'src/app/core/firebase.ts');

  assert.ok(firebase, 'src/app/core/firebase.ts is missing');

  // Its own database — never the default one that other apps depend on, and
  // never the shared one this app was deliberately moved out of.
  assert.match(
    firebase.text,
    /FIRESTORE_DATABASE_ID\s*=\s*'teacher-corner-dev'/,
    "expected this app's own teacher-corner-dev database"
  );

  assert.doesNotMatch(
    firebase.text,
    /FIRESTORE_DATABASE_ID\s*=\s*'bugpulse'/,
    'the app must not be pointed back at the shared bugpulse database'
  );

  assert.match(
    firebase.text,
    /getFirestore\(\s*firebaseApp,\s*FIRESTORE_DATABASE_ID\s*\)/,
    'getFirestore must be passed the database id, or it silently targets (default)'
  );
});

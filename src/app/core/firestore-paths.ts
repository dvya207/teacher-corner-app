import {
  CollectionReference,
  DocumentReference,
  Query,
  collection,
  doc,
  limit,
  orderBy,
  query,
  where
} from 'firebase/firestore';

import { db } from './firebase';

/**
 * THE ONLY PLACE IN THIS APP THAT BUILDS A FIRESTORE PATH.
 *
 * Isolation from every other app is now enforced by the platform: this app owns
 * the 'teacher-corner-dev' database outright, so no other app's data exists here
 * to reach. The `tcdev_` prefixes these names used to carry were there purely to
 * avoid colliding inside a shared database, and have been dropped.
 *
 * This module remains the single choke point for a different reason: paths
 * written inline across a dozen services drift. A collection name gets
 * misspelled, a level gets missed, and the mistake surfaces as an empty result
 * rather than an error. Centralising them makes a rename one edit and a typo a
 * compile error.
 *
 * tests/isolation.test.mjs fails the build if anything bypasses this file.
 */

/**
 * Collections and the trash sentinel.
 *
 *     institutions/{institutionId}                          ← ACTIVE
 *     institutions/trash/DeletedInstitutes/{institutionId}   ← DELETED
 *
 * Each institution is a REAL document sitting directly inside its collection —
 * no wrapper collection, no container document, no `items` level, no maps. That
 * is what makes the Firebase console behave like the `posts` reference: click
 * the collection, click a document, read its fields in the right-hand panel.
 *
 * DELETION IS A MOVE, NOT A FLAG. There is no `active` or `deleted` boolean
 * anywhere. A document's COLLECTION is what says whether it is live, so a query
 * against `institutions` cannot return a deleted row even if someone forgets a
 * filter — the row is not there to return. The document id is preserved across
 * the move, so delete and restore are exact inverses.
 *
 * THE TRASH SENTINEL. `trash` is a DOCUMENT sitting alongside the active
 * institutions, with the deleted ones in a subcollection beneath it — the same
 * pattern ThinkTac production uses. Two consequences worth knowing:
 *
 *   - It never appears in the active list. Every list filters by ownerId and
 *     the sentinel has none, so it is excluded without a special case; the
 *     rules deny reading it for the same reason.
 *   - It need not exist. Firestore serves a subcollection under a missing
 *     document, and creating a real one would raise the question of who owns a
 *     document shared by every teacher.
 *
 * Unprefixed names are safe because this app owns its database outright; the
 * tcdev_ prefixes these once carried existed only to avoid colliding inside a
 * database shared with BugPulse.
 */
export const COLLECTIONS = Object.freeze({
  /** ACTIVE institutions. Documents sit directly inside. */
  institutions: 'institutions',
  /** Teacher profiles, keyed by uid. */
  users: 'users',
  /** ACTIVE classrooms and STEM clubs. Same shape as institutions. */
  classrooms: 'classrooms',
  /** The programme catalogue a classroom's programmes are chosen from. */
  programmes: 'programmes',
  /** The learning units a programme is built from. */
  learningUnits: 'learningUnits',
  /** Teachers registered against an institution. NOT the signed-in user — see the model. */
  teachers: 'teachers'
});

/** The field carrying ownership on institution documents. */
export const OWNER_FIELD = 'ownerId';

/**
 * A unique key for a map entry that has no document id to use.
 *
 * WHY NOT grade-section. A key built out of the class encodes data into the key:
 * it changes the moment a real classroom appears, so the same class read under
 * two keys looks like two classes, and nothing can be updated in place.
 *
 * crypto.randomUUID rather than a Firestore reference id: this key stands for an
 * entry that is NOT a document, and something shaped like a document id invites
 * being followed as one. The hyphens make it plainly synthetic.
 */
export function generatedKey(): string {
  return crypto.randomUUID();
}

function assertSafeSegment(segment: string, label: string): void {
  if (typeof segment !== 'string' || segment.trim() === '') {
    throw new Error(`Firestore ${label} must be a non-empty string.`);
  }

  // Firestore joins path segments, so a name containing '/' resolves somewhere
  // the caller never intended.
  if (segment.includes('/')) {
    throw new Error(
      `Firestore ${label} "${segment}" contains a path separator. Segments must ` +
        'be single path components.'
    );
  }
}

/**
 * The trash sentinel document id.
 *
 * Reserved: an institution can never be created with this id, because it would
 * collide with the container. The security rules enforce that, not just this
 * comment.
 */
export const TRASH_DOC = 'trash';

/**
 * The subcollection under `trash` holding the deleted institutions.
 *
 * Named to match ThinkTac production, which uses
 * `Institutions/--trash--/DeletedInstitutes/{docId}`. Same level, same meaning,
 * so anyone who knows the production tree can read this one.
 */
export const TRASH_SUBCOLLECTION = 'DeletedInstitutes';

/**
 * The same subcollection for classrooms, named as ThinkTac production names it:
 * `Classrooms/--trash--/DeletedClassrooms/{docId}`.
 *
 * The sentinel document id is shared with institutions — `trash` in both
 * collections — because it means the same thing in both and a second name would
 * be one more thing to remember. Only the subcollection below it differs, so a
 * deleted classroom can never land among deleted institutions.
 */
export const CLASSROOM_TRASH_SUBCOLLECTION = 'DeletedClassrooms';

/** ACTIVE institutions: institutions */
export function activeInstitutionsCollection(): CollectionReference {
  return collection(db, COLLECTIONS.institutions);
}

/** institutions/trash — a container document, no fields of its own. */
function trashContainer(): DocumentReference {
  return doc(db, COLLECTIONS.institutions, TRASH_DOC);
}

/** DELETED institutions: institutions/trash/DeletedInstitutes */
export function trashInstitutionsCollection(): CollectionReference {
  return collection(trashContainer(), TRASH_SUBCOLLECTION);
}

/** One active institution: institutions/{docId} */
export function activeInstitutionDoc(docId: string): DocumentReference {
  assertSafeSegment(docId, 'document id');
  assertNotTrashSentinel(docId);

  return doc(activeInstitutionsCollection(), docId);
}

/** One deleted institution. SAME id as the active document it came from. */
export function trashInstitutionDoc(docId: string): DocumentReference {
  assertSafeSegment(docId, 'document id');

  return doc(trashInstitutionsCollection(), docId);
}

/**
 * A fresh active-institution reference with a generated id.
 *
 * doc(collection) rather than addDoc(): the id is allocated client-side, so it
 * is known before the write completes. That lets create() return the complete
 * object it just wrote instead of re-reading to discover the server's id.
 */
export function newActiveInstitutionDoc(): DocumentReference {
  return doc(activeInstitutionsCollection());
}

/**
 * Refuses the reserved sentinel id.
 *
 * `trash` is a real document path in this collection, so an institution with
 * that id would overwrite the container. Generated ids never collide, but an
 * imported or hand-entered one could.
 */
function assertNotTrashSentinel(docId: string): void {
  if (docId === TRASH_DOC) {
    throw new Error(
      `"${TRASH_DOC}" is reserved: it is the container document for deleted ` +
        'institutions and cannot be used as an institution id.'
    );
  }
}

/**
 * The signed-in teacher's own ACTIVE institutions.
 *
 * The ownerId filter is required, not tidy: the rule reads resource.data, and
 * Firestore rejects any query it cannot prove returns only permitted documents.
 * An unfiltered list is denied outright.
 */
export function ownedActiveInstitutions(uid: string): Query {
  assertSafeSegment(uid, 'uid');

  return query(activeInstitutionsCollection(), where(OWNER_FIELD, '==', uid));
}

/** The signed-in teacher's own DELETED institutions. */
export function ownedTrashInstitutions(uid: string): Query {
  assertSafeSegment(uid, 'uid');

  return query(trashInstitutionsCollection(), where(OWNER_FIELD, '==', uid));
}

/** The teacher's own profile document: users/{uid} */
export function userProfileDoc(uid: string): DocumentReference {
  assertSafeSegment(uid, 'uid');

  return doc(db, COLLECTIONS.users, uid);
}

/**
 * A subcollection under the teacher's own profile: users/{uid}/{name}
 *
 * Ownership here is the PATH, so these need no ownerId field and no query
 * filter. Prefer this shape for anything genuinely private to one teacher.
 */
export function userSubcollection(uid: string, name: string): CollectionReference {
  assertSafeSegment(uid, 'uid');
  assertSafeSegment(name, 'collection name');

  return collection(db, COLLECTIONS.users, uid, name);
}

/* ==========================================================================
   Classrooms — the SAME shape as institutions, deliberately

     classrooms/{classroomId}                          ← ACTIVE
     classrooms/trash/DeletedClassrooms/{classroomId}   ← DELETED

   Deletion is a move here too. Everything said above about institutions —
   why the location is the truth rather than a flag, why the sentinel needs no
   document of its own, why the id survives the round trip — applies verbatim,
   so the two features can be reasoned about as one pattern rather than two.
   ========================================================================== */

/** ACTIVE classrooms: classrooms */
export function activeClassroomsCollection(): CollectionReference {
  return collection(db, COLLECTIONS.classrooms);
}

/** classrooms/trash — a container document, no fields of its own. */
function classroomTrashContainer(): DocumentReference {
  return doc(db, COLLECTIONS.classrooms, TRASH_DOC);
}

/** DELETED classrooms: classrooms/trash/DeletedClassrooms */
export function trashClassroomsCollection(): CollectionReference {
  return collection(classroomTrashContainer(), CLASSROOM_TRASH_SUBCOLLECTION);
}

/** One active classroom: classrooms/{docId} */
export function activeClassroomDoc(docId: string): DocumentReference {
  assertSafeSegment(docId, 'document id');
  assertNotTrashSentinel(docId);

  return doc(activeClassroomsCollection(), docId);
}

/** One deleted classroom. SAME id as the active document it came from. */
export function trashClassroomDoc(docId: string): DocumentReference {
  assertSafeSegment(docId, 'document id');

  return doc(trashClassroomsCollection(), docId);
}

/** A fresh active-classroom reference with a generated id. */
export function newActiveClassroomDoc(): DocumentReference {
  return doc(activeClassroomsCollection());
}

/** Classrooms, owner-scoped by an ownerId field. */
export function ownedClassrooms(uid: string): Query {
  assertSafeSegment(uid, 'uid');

  return query(activeClassroomsCollection(), where(OWNER_FIELD, '==', uid));
}

/** The signed-in teacher's own DELETED classrooms. */
export function ownedTrashClassrooms(uid: string): Query {
  assertSafeSegment(uid, 'uid');

  return query(trashClassroomsCollection(), where(OWNER_FIELD, '==', uid));
}

/* ==========================================================================
   Programmes

     programmes/{programmeId}

   A flat top-level collection rather than a subcollection of the institution
   it belongs to. Both shapes were available; this one was chosen because the
   Manage Programmes panel offers a "show all programmes" mode that searches
   ACROSS institutions, and a collection-group query would be the only way to
   serve that from a nested shape — which needs its own index and its own rule
   block, for no gain. institutionId is a field, and the picker filters on it.

   No trash. A programme is removed from a classroom by deselecting it, which
   rewrites that classroom's `programmes` map and leaves the catalogue entry
   untouched; deleting a catalogue entry outright is not something the UI
   offers, so there is nothing to recover.
   ========================================================================== */

/**
 * The subcollection under `trash` holding the deleted programmes.
 *
 * Named to match ThinkTac production, which uses
 * `Programmes/--trash--/DeletedProgrammes/{docId}`.
 */
export const PROGRAMME_TRASH_SUBCOLLECTION = 'DeletedProgrammes';

/** The programme catalogue: programmes */
export function programmesCollection(): CollectionReference {
  return collection(db, COLLECTIONS.programmes);
}

/** programmes/trash — a container document, no fields of its own. */
function programmeTrashContainer(): DocumentReference {
  return doc(db, COLLECTIONS.programmes, TRASH_DOC);
}

/** DELETED programmes: programmes/trash/DeletedProgrammes */
export function trashProgrammesCollection(): CollectionReference {
  return collection(programmeTrashContainer(), PROGRAMME_TRASH_SUBCOLLECTION);
}

/** One programme: programmes/{docId} */
export function programmeDoc(docId: string): DocumentReference {
  assertSafeSegment(docId, 'document id');
  assertNotTrashSentinel(docId);

  return doc(programmesCollection(), docId);
}

/** One deleted programme. SAME id as the active document it came from. */
export function trashProgrammeDoc(docId: string): DocumentReference {
  assertSafeSegment(docId, 'document id');

  return doc(trashProgrammesCollection(), docId);
}

/** A fresh programme reference with a generated id. */
export function newProgrammeDoc(): DocumentReference {
  return doc(programmesCollection());
}

/**
 * The signed-in teacher's own programmes.
 *
 * Filtered by owner for the same reason every other top-level query is: the
 * rule reads resource.data, so Firestore rejects a list it cannot prove is
 * fully permitted. Narrowing by institution or grade happens client-side, on
 * an already owner-scoped result, so no composite index is needed.
 */
export function ownedProgrammes(uid: string): Query {
  assertSafeSegment(uid, 'uid');

  return query(programmesCollection(), where(OWNER_FIELD, '==', uid));
}

/** The signed-in teacher's own DELETED programmes. */
export function ownedTrashProgrammes(uid: string): Query {
  assertSafeSegment(uid, 'uid');

  return query(trashProgrammesCollection(), where(OWNER_FIELD, '==', uid));
}


/* ==========================================================================
   Learning units — the SAME shape a fourth time

     learningUnits/{learningUnitId}                              ← ACTIVE
     learningUnits/trash/DeletedLearningUnits/{learningUnitId}   ← DELETED

   Subcollection named to match ThinkTac production, which uses
   `LearningUnits/--trash--/DeletedLearningUnits/{docId}`.
   ========================================================================== */

export const LEARNING_UNIT_TRASH_SUBCOLLECTION = 'DeletedLearningUnits';

/** ACTIVE learning units: learningUnits */
export function learningUnitsCollection(): CollectionReference {
  return collection(db, COLLECTIONS.learningUnits);
}

/** learningUnits/trash — a container document, no fields of its own. */
function learningUnitTrashContainer(): DocumentReference {
  return doc(db, COLLECTIONS.learningUnits, TRASH_DOC);
}

/** DELETED learning units: learningUnits/trash/DeletedLearningUnits */
export function trashLearningUnitsCollection(): CollectionReference {
  return collection(learningUnitTrashContainer(), LEARNING_UNIT_TRASH_SUBCOLLECTION);
}

/** One active learning unit: learningUnits/{docId} */
export function learningUnitDoc(docId: string): DocumentReference {
  assertSafeSegment(docId, 'document id');
  assertNotTrashSentinel(docId);

  return doc(learningUnitsCollection(), docId);
}

/** One deleted learning unit. SAME id as the active document it came from. */
export function trashLearningUnitDoc(docId: string): DocumentReference {
  assertSafeSegment(docId, 'document id');

  return doc(trashLearningUnitsCollection(), docId);
}

/** A fresh learning-unit reference with a generated id. */
export function newLearningUnitDoc(): DocumentReference {
  return doc(learningUnitsCollection());
}

/** The signed-in teacher's own learning units. */
export function ownedLearningUnits(uid: string): Query {
  assertSafeSegment(uid, 'uid');

  return query(learningUnitsCollection(), where(OWNER_FIELD, '==', uid));
}

/** The signed-in teacher's own DELETED learning units. */
export function ownedTrashLearningUnits(uid: string): Query {
  assertSafeSegment(uid, 'uid');

  return query(trashLearningUnitsCollection(), where(OWNER_FIELD, '==', uid));
}

/* ==========================================================================
   Teachers — the SAME shape a fifth time

     teachers/{teacherId}                          ← ACTIVE
     teachers/trash/DeletedTeachers/{teacherId}    ← DELETED

   A FLAT TOP-LEVEL COLLECTION, not a subcollection of the institution the
   teacher belongs to. Both shapes were available, and this one was chosen for
   the reason programmes were: the Set Up Wizard registers teachers against one
   institution, but a teacher list that spans institutions is the obvious next
   screen, and serving that from a nested shape needs a collection-group query
   with its own index and its own rule block. institutionId is a field.

   Deletion is a move here too, so everything said about institutions at the top
   of this file applies verbatim.

   Subcollection named in production's style — Institutions→DeletedInstitutes,
   Classrooms→DeletedClassrooms — so Teachers→DeletedTeachers.
   ========================================================================== */

export const TEACHER_TRASH_SUBCOLLECTION = 'DeletedTeachers';

/** ACTIVE teachers: teachers */
export function activeTeachersCollection(): CollectionReference {
  return collection(db, COLLECTIONS.teachers);
}

/** teachers/trash — a container document, no fields of its own. */
function teacherTrashContainer(): DocumentReference {
  return doc(db, COLLECTIONS.teachers, TRASH_DOC);
}

/** DELETED teachers: teachers/trash/DeletedTeachers */
export function trashTeachersCollection(): CollectionReference {
  return collection(teacherTrashContainer(), TEACHER_TRASH_SUBCOLLECTION);
}

/** One active teacher: teachers/{docId} */
export function activeTeacherDoc(docId: string): DocumentReference {
  assertSafeSegment(docId, 'document id');
  assertNotTrashSentinel(docId);

  return doc(activeTeachersCollection(), docId);
}

/** One deleted teacher. SAME id as the active document it came from. */
export function trashTeacherDoc(docId: string): DocumentReference {
  assertSafeSegment(docId, 'document id');

  return doc(trashTeachersCollection(), docId);
}

/** A fresh active-teacher reference with a generated id. */
export function newActiveTeacherDoc(): DocumentReference {
  return doc(activeTeachersCollection());
}

/**
 * The signed-in admin's own teachers.
 *
 * Filtered by OWNER, not by institution. The rule reads resource.data, so
 * Firestore rejects any list it cannot prove is fully permitted, and narrowing
 * to one institution happens client-side on the already owner-scoped result —
 * which is also what keeps firestore.indexes.json empty, since a second where()
 * would need a composite index.
 */
export function ownedTeachers(uid: string): Query {
  assertSafeSegment(uid, 'uid');

  return query(activeTeachersCollection(), where(OWNER_FIELD, '==', uid));
}

/** The signed-in admin's own DELETED teachers. */
export function ownedTrashTeachers(uid: string): Query {
  assertSafeSegment(uid, 'uid');

  return query(trashTeachersCollection(), where(OWNER_FIELD, '==', uid));
}

/**
 * The programme-code counter: users/{uid}/counters/programmes
 *
 * DELIBERATELY PER-TEACHER, where ThinkTac production's is GLOBAL.
 *
 * Production keeps one `Configuration/Counters` document with a `programmeCode`
 * field, and every programme created anywhere in the system increments it — which
 * is what makes its codes (P11697, P11698) unique across the whole platform.
 *
 * Copying that here would have meant a shared mutable document that every
 * signed-in teacher can write. Firestore rules cannot express "you may only
 * increment this by one", so the tightest achievable rule still lets any
 * authenticated user put any value in it and desynchronise every teacher's
 * numbering. In an app whose every other collection is owner-scoped, that one
 * shared writable document would have been the only griefable surface in the
 * ruleset.
 *
 * Under the teacher's own profile it is owner-scoped BY PATH, so it needs no
 * ownerId field, no query filter, and no new rule block — the existing
 * `users/{uid}/{document=**}` rule already covers it — and no other teacher can
 * touch it.
 *
 * THE TRADE: codes are unique and sequential within one teacher's catalogue, not
 * across teachers. That is sufficient for every use this app makes of the code,
 * because a teacher only ever sees their own programmes. Making it global again
 * means a top-level counter document, a rule granting authenticated write to it,
 * and accepting the exposure above.
 */
export function programmeCounterDoc(uid: string): DocumentReference {
  assertSafeSegment(uid, 'uid');

  return doc(db, COLLECTIONS.users, uid, 'counters', 'programmes');
}

/* ==========================================================================
   Notifications

   PER TEACHER, UNDER THEIR OWN USER DOCUMENT:
   users/{uid}/notifications/{docId}

   Two reasons for that location rather than a top-level collection.

   ONE, isolation. One teacher's feed must not mix with another's, and a path
   that contains the uid makes that structural rather than a filter someone can
   forget. Production instead keeps a MAP keyed by userId inside a shared
   document, so every teacher's notifications live in one place and a read pulls
   everyone's; that is the shape this deliberately does not copy.

   TWO, no new rules. `users/{uid}/{document=**}` already grants a teacher full
   access to everything beneath their own user document and nobody else's, so
   this feed is governed by a rule that already exists and is already deployed.
   A top-level collection would have needed its own block, a review and a deploy.
   ========================================================================== */

/** The subcollection name, under the teacher's own user document. */
export const NOTIFICATIONS_SUBCOLLECTION = 'notifications';

/** One teacher's whole feed: users/{uid}/notifications */
export function notificationsCollection(uid: string): CollectionReference {
  assertSafeSegment(uid, 'uid');

  return collection(db, COLLECTIONS.users, uid, NOTIFICATIONS_SUBCOLLECTION);
}

/** One notification: users/{uid}/notifications/{docId} */
export function notificationDoc(uid: string, docId: string): DocumentReference {
  assertSafeSegment(docId, 'document id');

  return doc(notificationsCollection(uid), docId);
}

/** A fresh notification reference with a generated id. */
export function newNotificationDoc(uid: string): DocumentReference {
  return doc(notificationsCollection(uid));
}

/**
 * The teacher's feed, newest first and capped.
 *
 * No owner filter: the uid is IN THE PATH, so the query cannot address anyone
 * else's feed. orderBy on one field needs only the single-field index Firestore
 * maintains automatically, so firestore.indexes.json stays empty.
 */
export function recentNotifications(uid: string, cap = 50): Query {
  return query(notificationsCollection(uid), orderBy('createdAt', 'desc'), limit(cap));
}

/** Exported so the structure tests assert against the real constants. */
export const __testing = Object.freeze({ COLLECTIONS, assertSafeSegment });

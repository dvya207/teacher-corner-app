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
  /**
   * A template instantiated for one learning unit in one classroom.
   *
   * Production names it `Workflows`; lowercase here for the same reason
   * `learningUnits` is — this app's own collections are lowercase, and they
   * should flip together on the day production's names are adopted.
   */
  workflows: 'workflows',
  /**
   * The uploaded files a learning unit is made of, one document per maturity
   * rung. Production names it `LearningUnitResources`; lowercase here for the
   * same reason `learningUnits` is — this app's four other collections are
   * lowercase, and the pair should flip together on the day production's names
   * are adopted.
   */
  learningUnitResources: 'learningUnitResources',
  /**
   * Grade-dependent resource files, one document per board.
   *
   * A slot the schema marks grade-dependent does not hold one file: it holds one
   * per board and grade. Those cannot live on the rung's resource document,
   * which has room for a single path per slot, so they get a collection.
   */
  boardGradeResources: 'boardGradeResources',
  /** Teachers registered against an institution. NOT the signed-in user — see the model. */
  teachers: 'teachers',
  /**
   * Quizzes, uploads and forms a classroom can be set.
   *
   * CAPITALISED, matching production, unlike `learningUnits` beside it. The
   * difference is not an oversight: this collection is NEW here and has no
   * existing documents to migrate, so it can start on production's own name,
   * where the other two would need a data move to get there.
   */
  assignments: 'Assignments',

  /*
   * STUDENTS AND THEIR SUBMISSIONS — production's names, capitalised as it has
   * them, unlike this app's own lowercase collections.
   *
   * NEITHER EXISTS IN THIS APP'S DATABASE. They are here because the assignment
   * report reads them: production stores a student's answers at
   * `Students/{id}/remoteSubmissions/{id}/attempts/{id}` and the student's display
   * name in `CustomAuthentication/{id}`. The report is written against those paths
   * so it works the moment the data does, and naming them here rather than inline
   * keeps the one place that builds paths authoritative.
   */
  /**
   * Workflow templates — production's name, capitalised as it has it.
   *
   * Its trash is `WorkflowTemplates/--trash--/DeletedWorkflowTemplates`, the same
   * shape as the other five, and the container document exists there.
   */
  workflowTemplates: 'WorkflowTemplates',

  students: 'Students',
  customAuthentication: 'CustomAuthentication',
  /** Option vocabularies every dropdown reads. Capitalised, as production has it. */
  configuration: 'Configuration'
});

/** The field carrying ownership on institution documents. */
export const OWNER_FIELD = 'ownerId';

/**
 * The option vocabularies: Configuration
 *
 * THE ONE COLLECTION HERE THAT IS NOT ANYONE'S DATA. Countries, boards, grades,
 * sections and the rest — what every dropdown renders. The rules grant read to
 * any signed-in user and refuse client writes outright, because one write to a
 * list changes what every OTHER teacher can select. Editing goes through the
 * console or scripts/seed-configuration.mjs, both on the Admin SDK.
 *
 * NO OWNER FILTER, and that is not an oversight. Every other top-level query
 * here carries one because the rule reads resource.data and Firestore rejects a
 * list it cannot prove is fully permitted. This collection's rule is a flat
 * `read: if signedIn()`, so an unfiltered list IS provably permitted.
 *
 * It reached this file late: it was the last path in the app still built inline
 * from `db`, which the isolation test exists to catch.
 */
export function configurationCollection(): CollectionReference {
  return collection(db, COLLECTIONS.configuration);
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
   Learning unit resources

     learningUnitResources/{resourceId}                          ← ACTIVE
     learningUnitResources/trash/DeletedLearningUnitResources/{resourceId}  ← DELETED

   A TRASH, the same shape the other five collections use. Production has none
   here — a resource document belonged to a unit, and deleting the unit was what
   disposed of it — but that left every deleted unit's resource documents sitting
   in the live collection with nothing pointing at them, which no screen could
   show and no query could distinguish from a resource in use. Deleted resources
   now go where every other deleted thing in this app goes, and can come back.

   THE SENTINEL. `trash` is a real document path in this collection now, so a
   resource whose own document id is the string 'trash' would collide with the
   container. learningUnitResourceDoc rejects it, as the other four do.

   FLAT, not a subcollection of the unit. Production keeps it top-level and
   joins on `learningUnitDocId`, which is also what lets one query answer "every
   resource document at Gold" across units — a collection-group query would be
   the only way to serve that from a nested shape.

   ONE DOCUMENT PER MATURITY RUNG. A unit at Gold has a Silver document and a
   Gold one, because the ladder is cumulative; see LEARNING_UNIT_MATURITY_LADDER
   and the resource schema for which slots each rung carries.
   ========================================================================== */

/** Every learning unit resource document: learningUnitResources */
export function learningUnitResourcesCollection(): CollectionReference {
  return collection(db, COLLECTIONS.learningUnitResources);
}

/** One resource document: learningUnitResources/{docId} */
export function learningUnitResourceDoc(docId: string): DocumentReference {
  assertSafeSegment(docId, 'document id');
  assertNotTrashSentinel(docId);

  return doc(learningUnitResourcesCollection(), docId);
}

export const LEARNING_UNIT_RESOURCE_TRASH_SUBCOLLECTION = 'DeletedLearningUnitResources';

/** learningUnitResources/trash — a container document, no fields of its own. */
function learningUnitResourceTrashContainer(): DocumentReference {
  return doc(db, COLLECTIONS.learningUnitResources, TRASH_DOC);
}

/**
 * DELETED resource documents:
 * learningUnitResources/trash/DeletedLearningUnitResources
 */
export function trashLearningUnitResourcesCollection(): CollectionReference {
  return collection(
    learningUnitResourceTrashContainer(),
    LEARNING_UNIT_RESOURCE_TRASH_SUBCOLLECTION
  );
}

/** One deleted resource document. SAME id as the active document it came from. */
export function trashLearningUnitResourceDoc(docId: string): DocumentReference {
  assertSafeSegment(docId, 'document id');

  return doc(trashLearningUnitResourcesCollection(), docId);
}

/**
 * Every DELETED resource document belonging to one learning unit.
 *
 * The mirror of resourcesForLearningUnit, on the same field, so restoring a
 * unit can find exactly what was trashed with it.
 */
export function trashedResourcesForLearningUnit(learningUnitDocId: string): Query {
  assertSafeSegment(learningUnitDocId, 'learning unit document id');

  return query(
    trashLearningUnitResourcesCollection(),
    where('learningUnitDocId', '==', learningUnitDocId)
  );
}

/** A fresh resource reference with a generated id, so the id is known before the write. */
export function newLearningUnitResourceDoc(): DocumentReference {
  return doc(learningUnitResourcesCollection());
}

/**
 * Every resource document belonging to one learning unit.
 *
 * Filtered on learningUnitDocId — the unit's document id, NOT its readable
 * learningUnitId — because that is the one of the two that cannot change.
 */
export function resourcesForLearningUnit(learningUnitDocId: string): Query {
  assertSafeSegment(learningUnitDocId, 'learning unit document id');

  return query(
    learningUnitResourcesCollection(),
    where('learningUnitDocId', '==', learningUnitDocId)
  );
}

/* ==========================================================================
   Board and grade resources

     boardGradeResources/{docId}

   ONE DOCUMENT PER BOARD, with the grades as keys inside it. Production's own
   shape: a document carries learningUnitDocId, maturity, category, subCategory
   and board, and a `resources` map keyed grade_01 … grade_10 holding the path
   for each grade.

   WHY NOT ONE PER BOARD AND GRADE. Because the same file usually covers several
   grades, and a document per pair would multiply by ten what is really one
   decision — which is also why the picker takes several grades at once.

   FLAT, and joined on learningUnitDocId, for the reason learningUnitResources is:
   a nested shape would need a collection-group query to answer anything across
   units.
   ========================================================================== */

/** Every board-and-grade resource document: boardGradeResources */
export function boardGradeResourcesCollection(): CollectionReference {
  return collection(db, COLLECTIONS.boardGradeResources);
}

/** One of them: boardGradeResources/{docId} */
export function boardGradeResourceDoc(docId: string): DocumentReference {
  assertSafeSegment(docId, 'document id');

  return doc(boardGradeResourcesCollection(), docId);
}

/** A fresh one with a generated id. */
export function newBoardGradeResourceDoc(): DocumentReference {
  return doc(boardGradeResourcesCollection());
}

/** Everything filed against one learning unit, across every board and slot. */
export function boardGradeResourcesForUnit(learningUnitDocId: string): Query {
  assertSafeSegment(learningUnitDocId, 'learning unit document id');

  return query(
    boardGradeResourcesCollection(),
    where('learningUnitDocId', '==', learningUnitDocId)
  );
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

/* ==========================================================================
   ASSIGNMENTS — quizzes, uploads and forms
   ==========================================================================

   Assignments/{docId}
   Assignments/--trash--/DeletedAssignments/{docId}

   TWO DEPARTURES FROM THE FIVE COLLECTIONS ABOVE, both to match production
   rather than this app's own habits, because this collection is new and can
   simply start in the right place:

     1. The collection is CAPITALISED — see COLLECTIONS.assignments.

     2. The trash container is '--trash--', NOT 'trash'. Production's own
        service reads
          Assignments/--trash--/DeletedAssignments
        and a container document by a different name would put this app's
        deletions somewhere production would never look for them.

   The dashed sentinel is also safer than the bare word: 'trash' is a plausible
   document id for a real row, which is why every collection above needs an
   assertNotTrashSentinel guard on writes. '--trash--' is not a name anything
   would generate — but the guard is applied anyway, because "unlikely" is not
   the same as "cannot".
   ========================================================================== */

/** The trash container's id in the Assignments collection. Production's. */
/**
 * '--trash--', the container id PRODUCTION uses.
 *
 * TWO SPELLINGS LIVE IN THIS FILE, deliberately. `TRASH_DOC` is 'trash', this
 * app's own choice for the five collections it owns outright. '--trash--' is
 * production's, and the two collections that MIRROR one of its own — Assignments
 * and WorkflowTemplates — have to use its spelling or their deleted rows land
 * somewhere production's own tooling cannot see.
 */
export const PRODUCTION_TRASH_DOC = '--trash--';

/**
 * The same id, under the name the assignments paths were written with.
 *
 * Kept as an alias rather than renamed at every call site: it is referenced by
 * the rules commentary and by tests that pin the spelling, and a rename would
 * churn those for no behavioural gain. New code should use
 * PRODUCTION_TRASH_DOC, which does not claim to be assignment-specific.
 */
export const ASSIGNMENT_TRASH_DOC = PRODUCTION_TRASH_DOC;

/** Subcollection holding deleted assignments. Production's name. */
export const ASSIGNMENT_TRASH_SUBCOLLECTION = 'DeletedAssignments';

/**
 * EVERY RESERVED ID IN THE Assignments COLLECTION, not just the trash.
 *
 * Production's collection holds FOUR documents that are not assignments, and only
 * one of them was named here before:
 *
 *   --trash--                the container for deleted rows
 *   --schema--               a field reference for a quiz
 *   ---quizzer_schema---     a worked quiz with all five question types
 *   --default_assignments--  the default upload slots
 *
 * NOTE THE THREE DASHES on `---quizzer_schema---` and two on the rest. Not a typo
 * to tidy: the id is what a read looks up, so a "corrected" spelling addresses a
 * document that does not exist.
 *
 * WHY THEY NEED NAMING. They do not reach the table — `ownedAssignments` filters
 * on `ownerId` and none of them has that field, so Firestore excludes them from
 * the query outright. What they DO need is protection from being written over: a
 * create addressed at one of these ids would replace a reference document with an
 * assignment, and the trash container was the only id the rules refused.
 *
 * THE LAST THREE ARE REFERENCE DATA, NOT SCHEMA THIS APP OBEYS. `--schema--` and
 * `---quizzer_schema---` name a quiz's question array `questionsSchema` and carry
 * `name` and `type` fields on every question; across 174 questions in 37 real
 * production quizzes those three appear ZERO times. The live data is what this app
 * matches. See the note at the top of assignment.service.spec.ts.
 */
export const ASSIGNMENT_RESERVED_DOCS = Object.freeze([
  ASSIGNMENT_TRASH_DOC,
  '--schema--',
  '---quizzer_schema---',
  '--default_assignments--'
] as const);

/** ACTIVE assignments: Assignments */
export function assignmentsCollection(): CollectionReference {
  return collection(db, COLLECTIONS.assignments);
}

/** Assignments/--trash-- — a container document, no fields of its own. */
function assignmentTrashContainer(): DocumentReference {
  return doc(db, COLLECTIONS.assignments, ASSIGNMENT_TRASH_DOC);
}

/** DELETED assignments: Assignments/--trash--/DeletedAssignments */
export function trashAssignmentsCollection(): CollectionReference {
  return collection(assignmentTrashContainer(), ASSIGNMENT_TRASH_SUBCOLLECTION);
}

/** One active assignment: Assignments/{docId} */
export function assignmentDoc(docId: string): DocumentReference {
  assertSafeSegment(docId, 'document id');

  if (docId === ASSIGNMENT_TRASH_DOC) {
    throw new Error(
      `'${ASSIGNMENT_TRASH_DOC}' is the trash container, not an assignment.`
    );
  }

  return doc(assignmentsCollection(), docId);
}

/** One deleted assignment. SAME id as the active document it came from. */
export function trashAssignmentDoc(docId: string): DocumentReference {
  assertSafeSegment(docId, 'document id');

  return doc(trashAssignmentsCollection(), docId);
}

/** A fresh assignment reference with a generated id. */
export function newAssignmentDoc(): DocumentReference {
  return doc(assignmentsCollection());
}

/** The signed-in teacher's own assignments. */
export function ownedAssignments(uid: string): Query {
  assertSafeSegment(uid, 'uid');

  return query(assignmentsCollection(), where(OWNER_FIELD, '==', uid));
}

/** The signed-in teacher's own DELETED assignments. */
export function ownedTrashAssignments(uid: string): Query {
  assertSafeSegment(uid, 'uid');

  return query(trashAssignmentsCollection(), where(OWNER_FIELD, '==', uid));
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
   QUIZ SUBMISSIONS — production's own shape, under this app's own root

     users/{uid}/submissions/{classroomId}-{programmeId}
     users/{uid}/submissions/{summaryId}/attempts/attempt{N}
     users/{uid}/submissions/{summaryId}/submissionMeta/{autoId}

   PRODUCTION'S IS `Teachers/{teacherId}/submissions/…`, read off its own
   `saveSubmissionFullPayload`, and everything below the root segment is
   identical: the summary document id is `{classroomId}-{programmeId}`, the
   attempts hang under `attempts` keyed `attempt1`, `attempt2`, and every
   submission drops a row in `submissionMeta`. Verified against the live data —
   `Teachers/aTfHAMn.../submissions/7pUSc6aJveINv25wgV1r-A8MSkCPOgMP7qn8ZdVmu`
   holds attemptsCount 2 with `attempts/attempt1` and `attempts/attempt2`.

   THE ROOT DIFFERS BECAUSE THE IDENTITY DOES. Production keys the signed-in
   person on `Teachers/{docId}`; this app keys them on `users/{uid}` — the
   lowercase `teachers` collection here holds teachers REGISTERED AGAINST AN
   INSTITUTION, which is a different thing and not necessarily the person
   submitting. `teacherId` is written INSIDE the summary as production writes it,
   so the payload matches even where the path cannot.

   AND IT NEEDS NO NEW RULES. `users/{uid}/{document=**}` already grants a
   teacher everything under their own document and nobody else's, which is
   exactly the isolation a submission wants.

   THE SUMMARY IS PER CLASSROOM AND PROGRAMME, NOT PER QUIZ, and that is
   production's own choice rather than a simplification here: `attemptsCount` and
   the allowed-submissions cap therefore span every quiz in that classroom and
   programme. Measured: of its summary documents holding more than one attempt,
   each held attempts for a single quiz, so the difference has not bitten in
   practice — but it is the shape, and copying it is what keeps a submission
   written here readable by its own report screens.
   ========================================================================== */

export const SUBMISSIONS_SUBCOLLECTION = 'submissions';
export const SUBMISSION_ATTEMPTS_SUBCOLLECTION = 'attempts';
export const SUBMISSION_META_SUBCOLLECTION = 'submissionMeta';

/**
 * The summary document id: `{classroomId}-{programmeId}`.
 *
 * PRODUCTION'S OWN CONCATENATION, hyphen included. Built here rather than at the
 * call site so the one place that knows the format is the one place that names
 * the path.
 */
export function submissionSummaryId(classroomId: string, programmeId: string): string {
  assertSafeSegment(classroomId, 'classroom id');
  assertSafeSegment(programmeId, 'programme id');

  return `${classroomId}-${programmeId}`;
}

/** users/{uid}/submissions/{classroomId}-{programmeId} */
export function submissionSummaryDoc(
  uid: string,
  classroomId: string,
  programmeId: string
): DocumentReference {
  assertSafeSegment(uid, 'uid');

  return doc(
    db,
    COLLECTIONS.users,
    uid,
    SUBMISSIONS_SUBCOLLECTION,
    submissionSummaryId(classroomId, programmeId)
  );
}

/** users/{uid}/submissions/{summaryId}/attempts/attempt{N} */
export function submissionAttemptDoc(
  summary: DocumentReference,
  attemptId: string
): DocumentReference {
  assertSafeSegment(attemptId, 'attempt id');

  return doc(collection(summary, SUBMISSION_ATTEMPTS_SUBCOLLECTION), attemptId);
}

/** A fresh users/{uid}/submissions/{summaryId}/submissionMeta row. */
export function newSubmissionMetaDoc(summary: DocumentReference): DocumentReference {
  return doc(collection(summary, SUBMISSION_META_SUBCOLLECTION));
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

/* ==========================================================================
   Workflow templates.

   The same six functions every owned collection here has, and the same trash
   shape: a '--trash--' container with one named subcollection under it.
   ========================================================================== */

/** Subcollection holding deleted templates. Production's name. */
export const WORKFLOW_TEMPLATE_TRASH_SUBCOLLECTION = 'DeletedWorkflowTemplates';

export function workflowTemplatesCollection(): CollectionReference {
  return collection(db, COLLECTIONS.workflowTemplates);
}

/** `WorkflowTemplates/--trash--` — a container document, no fields of its own. */
function workflowTemplateTrashContainer(): DocumentReference {
  return doc(db, COLLECTIONS.workflowTemplates, PRODUCTION_TRASH_DOC);
}

export function trashWorkflowTemplatesCollection(): CollectionReference {
  return collection(
    workflowTemplateTrashContainer(),
    WORKFLOW_TEMPLATE_TRASH_SUBCOLLECTION
  );
}

/** One live template. Refuses the trash id, as the other collections do. */
export function workflowTemplateDoc(docId: string): DocumentReference {
  assertSafeSegment(docId, 'docId');

  if (docId === PRODUCTION_TRASH_DOC) {
    throw new Error(
      `'${PRODUCTION_TRASH_DOC}' is the trash container, not a workflow template.`
    );
  }

  return doc(workflowTemplatesCollection(), docId);
}

export function trashWorkflowTemplateDoc(docId: string): DocumentReference {
  assertSafeSegment(docId, 'docId');

  return doc(trashWorkflowTemplatesCollection(), docId);
}

/** A fresh template reference with a generated id. */
export function newWorkflowTemplateDoc(): DocumentReference {
  return doc(workflowTemplatesCollection());
}

/* ==========================================================================
   Workflows — a template INSTANTIATED for one learning unit in one classroom.

   NOT QUERIED AS A COLLECTION, and that is why there is no `allWorkflows()`
   here. A workflow is reached through the classroom that owns it:
   `programmes[programmeId].workflowIds[]` holds one entry per learning unit and
   the entry's `workflowId` is the document id. Listing the collection would
   return every classroom's workflows with no way to tell whose is whose.
   ========================================================================== */

/**
 * The ids in `workflows` that are NOT workflows.
 *
 * PRODUCTION'S OWN TWO, read off its collection: `--schema--` is a reference
 * document describing the shape, and `--trash--` is the container the deleted ones
 * hang under. Neither is a workflow, and a create addressed at either would
 * replace a reference document with a row — which is why the rules exclude them
 * and why nothing here builds a document reference to one by accident.
 */
export const WORKFLOW_TRASH_DOC = '--trash--';
export const WORKFLOW_SCHEMA_DOC = '--schema--';

export const WORKFLOW_RESERVED_DOCS = Object.freeze([
  WORKFLOW_TRASH_DOC,
  WORKFLOW_SCHEMA_DOC
] as const);

/** Production's own name for the subcollection under `--trash--`. */
export const WORKFLOW_TRASH_SUBCOLLECTION = 'DeletedWorkflows';

/** `workflows` — lowercase, like this app's other five own collections. */
export function workflowsCollection(): CollectionReference {
  return collection(db, COLLECTIONS.workflows);
}

/** `workflows/--trash--` — a container document, no fields of its own. */
export function workflowTrashContainer(): DocumentReference {
  return doc(workflowsCollection(), WORKFLOW_TRASH_DOC);
}

/**
 * `workflows/--trash--/DeletedWorkflows` — production's own path.
 *
 * A SUBCOLLECTION UNDER A SENTINEL DOCUMENT, which is how every trash in this
 * database is shaped: `Assignments/--trash--/DeletedAssignments`,
 * `WorkflowTemplates/--trash--/DeletedWorkflowTemplates`. Production has this one
 * too, and matching it means a workflow deleted here appears where its own console
 * and tooling look for it.
 */
export function trashWorkflowsCollection(): CollectionReference {
  return collection(workflowTrashContainer(), WORKFLOW_TRASH_SUBCOLLECTION);
}

/** One trashed workflow. */
export function trashWorkflowDoc(docId: string): DocumentReference {
  assertSafeSegment(docId, 'workflow id');

  return doc(trashWorkflowsCollection(), docId);
}

/**
 * One workflow, by the id the classroom's entry carries.
 *
 * REFUSES A RESERVED ID, as the assignment and template paths do: a classroom
 * entry holding '--schema--' would otherwise read the reference document as though
 * it were that unit's workflow, and a write would overwrite it.
 */
export function workflowDoc(docId: string): DocumentReference {
  assertSafeSegment(docId, 'workflow id');

  if ((WORKFLOW_RESERVED_DOCS as readonly string[]).includes(docId)) {
    throw new Error(`'${docId}' is a reserved workflow id, not a workflow.`);
  }

  return doc(workflowsCollection(), docId);
}

/** A fresh workflow reference with a generated id. */
export function newWorkflowDoc(): DocumentReference {
  return doc(workflowsCollection());
}

/* --------------------------------------------------------------------------
   DELETED STEPS — a second trash, one level down

     workflows/--trash--/DeletedWorkflowSteps/{autoId}
     WorkflowTemplates/--trash--/DeletedWorkflowTemplateSteps/{autoId}

   WHY A STEP NEEDS ITS OWN TRASH. A step is not a document: it is an entry in
   the `workflowSteps` array of one, so removing it and saving overwrites the
   array and the step is gone with no copy anywhere. The whole-document trash
   above cannot help — the document was not deleted, it was rewritten.

   And a step is worth keeping. It carries its content blocks, their categories,
   their access levels and durations: several minutes of a teacher's arrangement,
   discarded by one click on a bin icon in a rail with no undo.

   NOT A PRODUCTION PATH, and said plainly. Production's stepper removes a step
   from the array and writes; nothing records what was in it. These two
   subcollections are this app's own, named to sit alongside the trash paths
   production does have, and additive: nothing in production reads them.

   AUTO-ID, NOT THE STEP'S OWN. A step has no stable id — `workflowStepId`
   appears in 0 of production's 2593 real steps — and the same step can be
   removed, re-added and removed again, so a generated id per removal is the only
   thing that does not collide.
   -------------------------------------------------------------------------- */

export const WORKFLOW_STEP_TRASH_SUBCOLLECTION = 'DeletedWorkflowSteps';
export const WORKFLOW_TEMPLATE_STEP_TRASH_SUBCOLLECTION = 'DeletedWorkflowTemplateSteps';

/** `workflows/--trash--/DeletedWorkflowSteps` */
export function trashWorkflowStepsCollection(): CollectionReference {
  return collection(workflowTrashContainer(), WORKFLOW_STEP_TRASH_SUBCOLLECTION);
}

/** A fresh deleted-step reference. */
export function newTrashWorkflowStepDoc(): DocumentReference {
  return doc(trashWorkflowStepsCollection());
}

/** `WorkflowTemplates/--trash--/DeletedWorkflowTemplateSteps` */
export function trashWorkflowTemplateStepsCollection(): CollectionReference {
  return collection(
    workflowTemplateTrashContainer(),
    WORKFLOW_TEMPLATE_STEP_TRASH_SUBCOLLECTION
  );
}

/** A fresh deleted-template-step reference. */
export function newTrashWorkflowTemplateStepDoc(): DocumentReference {
  return doc(trashWorkflowTemplateStepsCollection());
}

/**
 * EVERY template, not just the caller's — WHICH IS PRODUCTION'S BEHAVIOUR.
 *
 * NO OWNER FILTER, and that is the point. Production reads the whole collection
 * (`afs.collection('WorkflowTemplates')`, no `where`), so all 46 of its templates
 * are visible to every teacher; a workflow template is a shared blueprint, not
 * personal data.
 *
 * THIS WAS OWNER-SCOPED AND THE SYMPTOM WAS INVISIBLE. A template created while
 * impersonating one teacher simply did not appear when viewing as another, with no
 * error and no empty-state distinction — it read as "my save did not work".
 *
 * `ownerId` IS STILL WRITTEN on create, for provenance. Nothing filters on it; it
 * records who built the template, which is worth keeping even when everyone can
 * see it.
 */
export function allWorkflowTemplates(): Query {
  return query(workflowTemplatesCollection());
}

/** Every trashed template, for the same reason. */
export function allTrashWorkflowTemplates(): Query {
  return query(trashWorkflowTemplatesCollection());
}

/* ==========================================================================
   Students and their submissions — the assignment report's sources.

   READ-ONLY FROM THIS APP. It has no student model and writes none of these; the
   report exports what production's own player records. Every path is built here
   rather than inline so the one authoritative place still names them, and so a
   student id cannot be concatenated into a path unchecked.
   ========================================================================== */

/** `Students` — production's collection, capitalised as it has it. */
export function studentsCollection(): CollectionReference {
  return collection(db, COLLECTIONS.students);
}

/** `CustomAuthentication/{studentId}` — where the student's display name lives. */
export function studentAuthDoc(studentId: string): DocumentReference {
  assertSafeSegment(studentId, 'studentId');

  return doc(db, COLLECTIONS.customAuthentication, studentId);
}

/** `Students/{studentId}/remoteSubmissions` — one per assignment attempted. */
export function remoteSubmissionsCollection(studentId: string): CollectionReference {
  assertSafeSegment(studentId, 'studentId');

  return collection(db, COLLECTIONS.students, studentId, 'remoteSubmissions');
}

/**
 * `Students/{studentId}/remoteSubmissions/{submissionId}/attempts`.
 *
 * A student may attempt an assignment more than once, which is why this is a
 * collection and not a field: the report reads the LATEST attempt.
 */
export function submissionAttemptsCollection(
  studentId: string,
  submissionId: string
): CollectionReference {
  assertSafeSegment(studentId, 'studentId');
  assertSafeSegment(submissionId, 'submissionId');

  return collection(
    db,
    COLLECTIONS.students,
    studentId,
    'remoteSubmissions',
    submissionId,
    'attempts'
  );
}

/** Exported so the structure tests assert against the real constants. */
export const __testing = Object.freeze({ COLLECTIONS, assertSafeSegment });

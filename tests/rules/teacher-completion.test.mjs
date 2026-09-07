/**
 * Firestore rule tests for teachers/{teacherId}/Completion/{learningUnitId}.
 *
 * WHY THIS SUITE EXISTS SEPARATELY. Every other per-teacher path in this app is
 * under `users/{uid}`, where the uid IS the path segment and ownership is
 * therefore structural. This one is not: the owning uid lives in a FIELD on the
 * parent teacher document, so the rule has to `get()` the parent and compare.
 * That is a different mechanism with a different failure mode, and it is worth
 * its own tests.
 *
 * THE FIELD IS teacherMeta.uid, NOT ownerId. Those are different people by
 * design: `ownerId` is the coordinator who registered the teacher, and
 * `teacherMeta.uid` is the teacher themselves once they have signed in. Getting
 * this backwards would let a coordinator write progress as each of their
 * teachers while locking the teachers out of their own. Both directions are
 * asserted below.
 *
 * Nothing is deployed by running these.
 */

import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';

/** The teacher who signed in against the record: teacherMeta.uid. */
const TEACHER = 'teacher-uid';
/** The coordinator who REGISTERED that record: ownerId. Not the owner of progress. */
const COORDINATOR = 'coordinator-uid';
/** Someone else entirely. */
const STRANGER = 'stranger-uid';

const TEACHER_DOC = 'teachers/t1';
const UNLINKED_DOC = 'teachers/t2';

/** A learning unit id, as production keys these rows. */
const LU = '3BFIIOqg8YRK9hGU7m0r';
const ROW = `${TEACHER_DOC}/Completion/${LU}`;
/** activityProgress ids are `{classroomId}_{luId}`, underscore, as production has them. */
const CLASSROOM = '2jUYI7m4sMFLQK4wmXTJ';
const STAGE_ROW = `${TEACHER_DOC}/activityProgress/${CLASSROOM}_${LU}`;
const UNLINKED_ROW = `${UNLINKED_DOC}/Completion/${LU}`;

/** Production's shape, field for field. */
const completion = () => ({
  docId: LU,
  workflows: { JDVvf2ou8GqtVTisKrVF: { completedSteps: 7 } }
});

/** Production's own row, field for field. */
const stages = () => ({
  teacherId: TEACHER,
  classroomId: CLASSROOM,
  luId: LU,
  completedStages: [0, 1]
});

let testEnv;
let teacher;
let coordinator;
let stranger;
let anon;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'teacher-corner-completion-rules-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080
    }
  });

  teacher = testEnv.authenticatedContext(TEACHER).firestore();
  coordinator = testEnv.authenticatedContext(COORDINATOR).firestore();
  stranger = testEnv.authenticatedContext(STRANGER).firestore();
  anon = testEnv.unauthenticatedContext().firestore();
});

after(async () => {
  await testEnv?.cleanup();
});

describe('Completion is readable and writable only by the linked teacher', () => {
  /**
   * Two parent records: one linked to TEACHER, one linked to nobody. Seeded with
   * rules disabled because the rule reads the PARENT, and a parent that does not
   * exist would deny every case for the wrong reason.
   */
  before(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), TEACHER_DOC), {
        docId: 't1',
        ownerId: COORDINATOR,
        teacherMeta: { uid: TEACHER, firstName: 'Linked' }
      });
      await setDoc(doc(ctx.firestore(), UNLINKED_DOC), {
        docId: 't2',
        ownerId: COORDINATOR,
        teacherMeta: { firstName: 'Never signed in' }
      });
      await setDoc(doc(ctx.firestore(), ROW), completion());
    });
  });

  it('lets the linked teacher read their own progress', async () => {
    await assertSucceeds(getDoc(doc(teacher, ROW)));
  });

  it('lets the linked teacher write their own progress', async () => {
    await assertSucceeds(setDoc(doc(teacher, ROW), completion()));
  });

  it('lets the linked teacher delete their own progress', async () => {
    await assertSucceeds(deleteDoc(doc(teacher, `${TEACHER_DOC}/Completion/scratch`)));
  });

  /**
   * THE ONE THAT MATTERS MOST. ownerId is the coordinator, and a rule written
   * against the wrong field would pass this teacher's progress to them.
   */
  it('DENIES the coordinator who registered the record', async () => {
    await assertFails(getDoc(doc(coordinator, ROW)));
    await assertFails(setDoc(doc(coordinator, ROW), completion()));
  });

  it('denies an unrelated signed-in teacher', async () => {
    await assertFails(getDoc(doc(stranger, ROW)));
    await assertFails(setDoc(doc(stranger, ROW), completion()));
  });

  it('denies an anonymous client', async () => {
    await assertFails(getDoc(doc(anon, ROW)));
    await assertFails(setDoc(doc(anon, ROW), completion()));
  });

  /** A record nobody has signed in against has no owner, so nobody may write it. */
  it('denies everyone on a teacher record with no linked uid', async () => {
    await assertFails(setDoc(doc(teacher, UNLINKED_ROW), completion()));
    await assertFails(setDoc(doc(coordinator, UNLINKED_ROW), completion()));
  });

  /** A teacher document that does not exist cannot grant anything. */
  it('denies a write under a teacher record that does not exist', async () => {
    await assertFails(
      setDoc(doc(teacher, `teachers/does-not-exist/Completion/${LU}`), completion())
    );
  });
});

/**
 * The SAME owner test on the second subcollection.
 *
 * WORTH REPEATING RATHER THAN ASSUMING. The two are separate `match` blocks, not
 * one recursive wildcard, precisely so that adding a subcollection later does not
 * silently inherit a grant. That deliberate choice means each block has to be
 * proven on its own, and a copy-paste slip in either is exactly what these catch.
 */
describe('activityProgress is readable and writable only by the linked teacher', () => {
  before(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), TEACHER_DOC), {
        docId: 't1',
        ownerId: COORDINATOR,
        teacherMeta: { uid: TEACHER, firstName: 'Linked' }
      });
      await setDoc(doc(ctx.firestore(), UNLINKED_DOC), {
        docId: 't2',
        ownerId: COORDINATOR,
        teacherMeta: { firstName: 'Never signed in' }
      });
      await setDoc(doc(ctx.firestore(), STAGE_ROW), stages());
    });
  });

  it('lets the linked teacher read and write their own stages', async () => {
    await assertSucceeds(getDoc(doc(teacher, STAGE_ROW)));
    await assertSucceeds(setDoc(doc(teacher, STAGE_ROW), stages()));
  });

  it('DENIES the coordinator who registered the record', async () => {
    await assertFails(getDoc(doc(coordinator, STAGE_ROW)));
    await assertFails(setDoc(doc(coordinator, STAGE_ROW), stages()));
  });

  it('denies an unrelated teacher and an anonymous client', async () => {
    await assertFails(setDoc(doc(stranger, STAGE_ROW), stages()));
    await assertFails(setDoc(doc(anon, STAGE_ROW), stages()));
  });

  it('denies everyone on a teacher record with no linked uid', async () => {
    const row = `${UNLINKED_DOC}/activityProgress/${CLASSROOM}_${LU}`;

    await assertFails(setDoc(doc(teacher, row), stages()));
    await assertFails(setDoc(doc(coordinator, row), stages()));
  });

  /**
   * THE GENERALISATION TEST. Nothing about either rule is specific to one
   * teacher: a second, unrelated teacher record with its own linked account must
   * behave identically. This is what makes "every teacher gets the same
   * structure" a property of the rules rather than of the one row we happened to
   * try.
   */
  it('behaves the same for a DIFFERENT teacher and their own account', async () => {
    const OTHER_DOC = 'teachers/t3';
    const other = testEnv.authenticatedContext(STRANGER).firestore();

    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), OTHER_DOC), {
        docId: 't3',
        ownerId: COORDINATOR,
        teacherMeta: { uid: STRANGER, firstName: 'Second teacher' }
      });
    });

    const theirs = `${OTHER_DOC}/activityProgress/${CLASSROOM}_${LU}`;
    const theirCompletion = `${OTHER_DOC}/Completion/${LU}`;

    // Their own rows: allowed, both subcollections.
    await assertSucceeds(setDoc(doc(other, theirs), stages()));
    await assertSucceeds(setDoc(doc(other, theirCompletion), completion()));

    // And still locked out of the first teacher's.
    await assertFails(setDoc(doc(other, STAGE_ROW), stages()));
    await assertFails(setDoc(doc(other, ROW), completion()));

    // And the first teacher is locked out of theirs.
    await assertFails(setDoc(doc(teacher, theirs), stages()));
  });
});

/**
 * The submissions tree, MOVED here from users/{uid}/submissions.
 *
 * WHY IT NEEDS TESTS IT DID NOT NEED BEFORE. Under `users` it was covered by the
 * blanket `users/{uid}/{document=**}` grant, where the uid IS the path and there
 * is nothing to get wrong. Here the owner lives in a field on the parent and each
 * of the three levels carries its own rule, so a copy-paste slip on any one of
 * them is invisible until a submit half-lands.
 *
 * ALL THREE LEVELS IN ONE TRANSACTION. A submit writes the summary, an attempt
 * and a meta row together; if any single level were denied the whole submit would
 * fail, so each is asserted for the owner and against everybody else.
 */
describe('the submissions tree is writable only by the linked teacher', () => {
  const SUMMARY = `${TEACHER_DOC}/submissions/${CLASSROOM}-prog1`;
  const ATTEMPT = `${SUMMARY}/attempts/attempt1`;
  const META = `${SUMMARY}/submissionMeta/meta1`;

  const summary = () => ({
    teacherId: TEACHER,
    classroomId: CLASSROOM,
    programmeId: 'prog1',
    attemptsCount: 1,
    maxScore: 5,
    totalQuestions: 5
  });

  before(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), TEACHER_DOC), {
        docId: 't1',
        ownerId: COORDINATOR,
        teacherMeta: { uid: TEACHER, firstName: 'Linked' }
      });
    });
  });

  it('lets the linked teacher write all three levels', async () => {
    await assertSucceeds(setDoc(doc(teacher, SUMMARY), summary()));
    await assertSucceeds(setDoc(doc(teacher, ATTEMPT), { attemptNumber: 1, studentScore: 5 }));
    await assertSucceeds(setDoc(doc(teacher, META), { attemptId: 'attempt1', clientIp: '' }));
  });

  it('lets the linked teacher read their own history back', async () => {
    await assertSucceeds(getDoc(doc(teacher, SUMMARY)));
    await assertSucceeds(getDoc(doc(teacher, ATTEMPT)));
  });

  it('DENIES the coordinator on every level', async () => {
    await assertFails(setDoc(doc(coordinator, SUMMARY), summary()));
    await assertFails(setDoc(doc(coordinator, ATTEMPT), { attemptNumber: 2 }));
    await assertFails(setDoc(doc(coordinator, META), { attemptId: 'attempt2' }));
  });

  it('denies a stranger and an anonymous client on every level', async () => {
    for (const who of [stranger, anon]) {
      await assertFails(setDoc(doc(who, SUMMARY), summary()));
      await assertFails(setDoc(doc(who, ATTEMPT), { attemptNumber: 2 }));
      await assertFails(setDoc(doc(who, META), { attemptId: 'attempt2' }));
    }
  });

  it('denies a nested write under a teacher record with no linked uid', async () => {
    const orphan = `${UNLINKED_DOC}/submissions/${CLASSROOM}-prog1/attempts/attempt1`;

    await assertFails(setDoc(doc(teacher, orphan), { attemptNumber: 1 }));
  });
});

/**
 * EVERY SIGNED-IN TEACHER SEES EVERY ASSIGNMENT, whichever way they signed in.
 *
 * WHY THIS IS A RULES TEST AND NOT ONLY A SERVICE ONE. The client used to filter
 * the list by `ownerId`, and the comment justifying it claimed the rules demanded
 * that. They never did. Pinning the rule here means the claim cannot quietly come
 * back: if someone re-adds an ownership test to the Assignments read, this fails.
 *
 * THE PROVIDER IS IRRELEVANT AND THAT IS THE POINT. This app issues a separate
 * uid per sign-in method, so one person with a phone login and a Google login has
 * two accounts and two `ownerId` values. A rule keyed on ownership would hide a
 * teacher's own assignments from their other login; a rule keyed on being signed
 * in does not care.
 */
describe('assignments are readable by any signed-in teacher', () => {
  const MINE = 'Assignments/a1';

  before(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), MINE), {
        docId: 'a1',
        ownerId: TEACHER,
        displayName: 'Demo Quiz',
        type: 'QUIZ'
      });
    });
  });

  it('lets the creator read it', async () => {
    await assertSucceeds(getDoc(doc(teacher, MINE)));
  });

  /** The whole request: another teacher, another account, same assignment. */
  it('lets a DIFFERENT teacher read it', async () => {
    await assertSucceeds(getDoc(doc(stranger, MINE)));
  });

  /** Stands in for the same person's other sign-in provider. */
  it('lets the coordinator account read it', async () => {
    await assertSucceeds(getDoc(doc(coordinator, MINE)));
  });

  it('still denies a signed-out client', async () => {
    await assertFails(getDoc(doc(anon, MINE)));
  });
});

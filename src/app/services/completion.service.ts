import { Injectable } from '@angular/core';
import { getDocs, runTransaction, serverTimestamp } from 'firebase/firestore';

import { db } from '../core/firebase';
import {
  teacherActivityProgressDoc,
  teacherByLinkedUid,
  teacherCompletionCollection,
  teacherCompletionDoc
} from '../core/firestore-paths';

/**
 * Thrown when the signed-in account has no teacher record to write under.
 *
 * A STRING SENTINEL, matching MAX_ATTEMPTS_REACHED in quiz-submission.service —
 * the caller has to distinguish this from a network failure to say anything
 * useful, and an Error subclass survives neither a zone boundary nor a rethrow
 * as reliably as its message does.
 */
export const NO_LINKED_TEACHER = 'NO_LINKED_TEACHER';

/** One learning unit's progress: workflow id to the count of completed steps. */
export type WorkflowCompletion = Record<string, number>;

/**
 * Progress through a classroom's workflows, in production's own shape.
 *
 *     teachers/{teacherDocId}/Completion/{learningUnitId}
 *        docId      the learning unit id, repeated
 *        workflows  { {workflowId}: { completedSteps } }
 *
 * ONE DOCUMENT PER LEARNING UNIT, not per workflow. The same unit can be run
 * under several workflows — production's `Completion/3BFIIOqg8YRK9hGU7m0r` holds
 * two — and they share a row because the units page asks "how far through this
 * unit am I", which is a question about the unit.
 *
 * NO TIMESTAMPS. Production's document carries `docId` and `workflows` and
 * nothing else. Adding an `updatedAt` here would be a field its readers do not
 * expect and this app does not use.
 */
@Injectable({ providedIn: 'root' })
export class CompletionService {
  /**
   * The teacher record linked to this account.
   *
   * THROWS [NO_LINKED_TEACHER] rather than returning null. Progress written to
   * the wrong teacher is worse than progress not written at all, and a null
   * would invite a caller to carry on with an empty id and land on
   * `teachers//Completion/...`.
   */
  async teacherDocIdFor(uid: string): Promise<string> {
    const snapshot = await getDocs(teacherByLinkedUid(uid));
    const first = snapshot.docs[0];

    if (!first) {
      throw new Error(NO_LINKED_TEACHER);
    }

    return first.id;
  }

  /**
   * Records how far through a workflow the teacher has got.
   *
   * MONOTONIC, AND THAT IS THE WHOLE REASON THIS IS A TRANSACTION. Stepping
   * backwards to re-read step 2 of 7 must not drop the record from 7 to 2, so
   * the write is max(stored, reached) and the read has to be inside the same
   * transaction as the write or two tabs race and the lower number can win.
   *
   * `reachedIndex` is ZERO-BASED and stored one higher: production records 7
   * against a workflow of 7 steps, so arriving at the last step counts it.
   * Clamped to [0, stepCount] because a stale index from a workflow that has
   * since lost steps would otherwise store a total nothing can reach.
   *
   * Returns the value now stored, which is not always the one passed in.
   */
  async recordFurthestStep(input: {
    teacherDocId: string;
    learningUnitId: string;
    workflowId: string;
    reachedIndex: number;
    stepCount: number;
  }): Promise<number> {
    const { teacherDocId, learningUnitId, workflowId, reachedIndex, stepCount } = input;

    const ref = teacherCompletionDoc(teacherDocId, learningUnitId);

    return runTransaction(db, async transaction => {
      const snapshot = await transaction.get(ref);
      const workflows = snapshot.exists()
        ? ((snapshot.data()['workflows'] ?? {}) as Record<string, { completedSteps?: unknown }>)
        : {};

      const stored = Number(workflows[workflowId]?.completedSteps ?? 0) || 0;
      const completedSteps = nextCompletedSteps({ stored, reachedIndex, stepCount });

      if (snapshot.exists() && stored === completedSteps) {
        // Nothing moved. Skipping the write keeps a teacher paging back and
        // forth through a finished workflow from billing a write per step.
        return completedSteps;
      }

      /*
       * A MERGE ON THE NESTED KEY, not a whole-document set. Two workflows for
       * the same unit live in one map, and writing the map wholesale would drop
       * the other one. Dotted paths are how Firestore updates a single map entry,
       * and `set` with merge:true understands them the same way `update` does
       * while still creating the document when it is the unit's first workflow.
       */
      transaction.set(
        ref,
        { docId: learningUnitId, workflows: { [workflowId]: { completedSteps } } },
        { merge: true }
      );

      return completedSteps;
    });
  }

  /** One unit's progress, or an empty map when nothing has been recorded. */
  async completionFor(
    teacherDocId: string,
    learningUnitId: string
  ): Promise<WorkflowCompletion> {
    const snapshot = await getDocs(teacherCompletionCollection(teacherDocId));
    const row = snapshot.docs.find(entry => entry.id === learningUnitId);

    return row ? readWorkflows(row.data()) : {};
  }

  /**
   * Every unit's progress in one read, keyed by learning unit id.
   *
   * The units page renders a whole programme at once, so a per-unit read would
   * be one round trip per card. The collection is one document per unit this
   * teacher has started, which is bounded by the units they teach.
   */
  async allCompletion(teacherDocId: string): Promise<Record<string, WorkflowCompletion>> {
    const snapshot = await getDocs(teacherCompletionCollection(teacherDocId));
    const out: Record<string, WorkflowCompletion> = {};

    snapshot.docs.forEach(entry => {
      out[entry.id] = readWorkflows(entry.data());
    });

    return out;
  }

  /**
   * Records that a step was OPENED, in `activityProgress`.
   *
   * SEPARATE FROM [recordFurthestStep] because production keeps two separate
   * records and they are not derivable from one another: `Completion` is a count
   * per workflow, this is the sequence of step indices per classroom and unit. A
   * teacher who opens step 5 first has `completedSteps: 6` and
   * `completedStages: [5]`, and neither number is wrong.
   *
   * A TRANSACTION FOR THE SAME REASON THE OTHER ONE IS: the array is read,
   * appended to, and written back, so two tabs would otherwise each append to the
   * copy they read and one would lose its entry.
   *
   * Returns the stages now stored.
   */
  async recordVisitedStage(input: {
    teacherDocId: string;
    teacherId: string;
    classroomId: string;
    learningUnitId: string;
    stageIndex: number;
    stepCount: number;
  }): Promise<number[]> {
    const {
      teacherDocId,
      teacherId,
      classroomId,
      learningUnitId,
      stageIndex,
      stepCount
    } = input;

    const ref = teacherActivityProgressDoc(teacherDocId, classroomId, learningUnitId);

    return runTransaction(db, async transaction => {
      const snapshot = await transaction.get(ref);
      const stored = snapshot.exists() ? readStages(snapshot.data()) : [];
      const stages = nextCompletedStages(stored, stageIndex, stepCount);

      if (snapshot.exists() && stages.length === stored.length) {
        // Already recorded. Re-opening a step must not bill a write.
        return stored;
      }

      transaction.set(
        ref,
        {
          teacherId,
          classroomId,
          luId: learningUnitId,
          completedStages: stages,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );

      return stages;
    });
  }
}

/**
 * The stages array after opening one more step. APPEND, DEDUPLICATED, UNSORTED.
 *
 * Production's rows are frequently out of order — `[0,2,1,4,5,3]`, `[1,0]`,
 * `[5,4,3,2,1,0]` — because the array records the sequence steps were opened in.
 * Sorting it would destroy the only information it carries beyond a count, so
 * this appends and never reorders.
 *
 * OUT-OF-RANGE INDICES ARE REFUSED rather than clamped, unlike
 * [nextCompletedSteps]. A count can sensibly be capped at the total; an index
 * cannot be moved to a different step without claiming the teacher opened one
 * they did not.
 */
export function nextCompletedStages(
  stored: readonly number[],
  stageIndex: number,
  stepCount: number
): number[] {
  const clean = stored.filter(
    value => Number.isInteger(value) && value >= 0 && value < stepCount
  );

  if (!Number.isInteger(stageIndex) || stageIndex < 0 || stageIndex >= stepCount) {
    return [...clean];
  }

  return clean.includes(stageIndex) ? [...clean] : [...clean, stageIndex];
}

/** `completedStages` off a stored document, forced to a clean integer array. */
export function readStages(data: Record<string, unknown>): number[] {
  const raw = data['completedStages'];

  if (!Array.isArray(raw)) return [];

  return raw
    .map(value => Number(value))
    .filter(value => Number.isInteger(value) && value >= 0);
}

/**
 * What `completedSteps` becomes after reaching a step. THE MONOTONIC RULE.
 *
 * Extracted from the transaction so it can be tested without standing in for
 * Firestore: everything interesting about this write is here, and the rest is
 * one read and one set.
 *
 *   - ZERO-BASED IN, ONE-BASED OUT. Production records 7 against a workflow of
 *     7 steps, so arriving at the last step counts it.
 *   - NEVER DECREASES. Paging back to step 2 of 7 leaves 7 recorded, because the
 *     question the number answers is how far the teacher got, not where they are.
 *   - CLAMPED TO THE STEP COUNT. A stale index from a workflow that has since
 *     lost steps would otherwise record a total nothing can reach, and the
 *     percentage would read over 100.
 *   - NEGATIVE INDICES FLOOR AT ZERO rather than recording -1 + 1 = 0 by
 *     accident, which happens to be right but for no reason anyone could rely on.
 */
export function nextCompletedSteps(input: {
  stored: number;
  reachedIndex: number;
  stepCount: number;
}): number {
  const { stored, reachedIndex, stepCount } = input;

  if (stepCount <= 0) return 0;

  const reached = Math.max(0, Math.min(reachedIndex + 1, stepCount));
  const floor = Math.max(0, Math.min(stored, stepCount));

  return Math.max(floor, reached);
}

/**
 * `workflows` off a stored document, with every value forced to a number.
 *
 * Defensive because the map is written by more than this app: production's own
 * writers put it there first, and a string "7" from any of them would otherwise
 * flow into a percentage calculation and render as NaN.
 */
export function readWorkflows(data: Record<string, unknown>): WorkflowCompletion {
  const raw = (data['workflows'] ?? {}) as Record<string, { completedSteps?: unknown }>;
  const out: WorkflowCompletion = {};

  Object.entries(raw).forEach(([workflowId, value]) => {
    const steps = Number(value?.completedSteps ?? 0);
    out[workflowId] = Number.isFinite(steps) && steps > 0 ? Math.floor(steps) : 0;
  });

  return out;
}

/**
 * Completion as a percentage, rounded.
 *
 * Zero steps gives zero rather than a division by zero, and the result is capped
 * at 100 so a stale `completedSteps` from a workflow that has since lost a step
 * cannot render 117%.
 */
export function completionPercent(completedSteps: number, stepCount: number): number {
  if (stepCount <= 0) return 0;

  return Math.min(100, Math.round((completedSteps / stepCount) * 100));
}

import { Injectable, inject } from '@angular/core';
import {
  arrayUnion,
  runTransaction,
  serverTimestamp,
  setDoc
} from 'firebase/firestore';

import { db } from '../core/firebase';
import { activeTeacherDoc, submissionSummaryDoc } from '../core/firestore-paths';
import { FormQuestion } from '../models/teaching.model';
import { ConfigurationService } from './configuration.service';
import { stripUndefined } from './workflow-template.service';

/** Where a form submission belongs. Same keying as an upload. */
export interface FormSubmissionTarget {
  uid: string;
  /**
   * The TEACHER RECORD's document id — the root the submission is written under.
   *
   * SEPARATE FROM [uid], and they are different values. The uid identifies the
   * ACCOUNT and still stamps `teacherId` and the Storage path; this identifies
   * the teacher RECORD, which is what production roots submissions on. Resolved
   * once by the caller rather than looked up here, so one submit costs one query
   * and not three.
   */
  teacherDocId: string;

  classroomId: string;
  programmeId: string;
  /** '' outside a workflow, which changes the KEY the record hangs under. */
  workflowId: string;
  assignmentId: string;
}

/**
 * One answered question, as the record stores it.
 *
 * PRODUCTION'S OWN SHAPE, read off a live submission rather than its code: the
 * source question's fields are carried through unchanged and `answer` is added.
 * A `starRating` answer is a NUMBER and everything else is a string.
 */
export interface AnsweredFormQuestion {
  questionType: string;
  questionNumber: number;
  question: string;
  prompt: string;
  fieldIcon: string | null;
  isSubquestion: boolean;
  dropDownOptions: string[];
  answer: string | number;
}

/** What one form submission stores. */
export interface FormAnswers {
  instructions: string;
  questions: AnsweredFormQuestion[];
  displayName: string;
  totalQuestions: number;
  /** THE FORM'S OWN DOCUMENT ID, under production's field name `id`. */
  id: string;
}

/**
 * Recording a form submission — production's method, followed.
 *
 * WHAT PRODUCTION DOES, read off `form-workflow.component.ts` and confirmed
 * against a live submission rather than inferred:
 *
 *   1. Submit writes to the SAME `submissions/{classroomId}-{programmeId}`
 *      document the quiz and the uploads use, under
 *      `workflowId_{wf}.assignmentId_{formId}`.
 *   2. The record carries `instructions`, the whole `questions` array with an
 *      `answer` on each, `displayName`, `totalQuestions` and `id`, plus
 *      `lastAttemptTime`, `userAgent`, `clientIp` and `locationInfo`.
 *   3. `submissionMeta` gets an entry appended to an ARRAY.
 *   4. The teacher document gets the form id added to `attemptedAssignments`.
 *
 * NO `versions`, UNLIKE AN UPLOAD — and that is production's, not an omission
 * here: the block exists in its source and is COMMENTED OUT. So a resubmission
 * overwrites the previous answers with no history kept. Matched, because the
 * alternative is writing a subtree its own screens do not read; the reader is told
 * plainly that resubmitting replaces.
 *
 * ONE STORED SUBMISSION PER FORM, NOT ONE PER ATTEMPT, which follows from the
 * same fact: with no `versions` subtree, a resubmission overwrites and only the
 * latest survives.
 *
 * AND THE FORM DOES NOT PREFILL. Production reads the stored answers back and
 * builds the form from those; this app opens an empty form every time, on
 * instruction. `submissionCount` is the only record of how many have been sent.
 */
@Injectable({ providedIn: 'root' })
export class FormSubmissionService {

  private config = inject(ConfigurationService);

  /**
   * Writes the answers. UNLIMITED SUBMISSIONS, on instruction.
   *
   * NO CAP, which is production's behaviour too — its quiz counts attempts and
   * its form does not. A cap of two was briefly added here and then removed: the
   * ask was for the FIELDS to be empty each time, not for the submissions to run
   * out.
   *
   * MERGED, NEVER SET WHOLE. One summary document holds every assignment, every
   * upload and every quiz attempt for a classroom and programme; a whole-document
   * write would take the rest with it.
   *
   * STILL A TRANSACTION, because `submissionCount` is derived from what is already
   * there. Nothing gates on that number — it is the only trace that more than one
   * submission ever happened, since a form keeps no version history — but two tabs
   * submitting at once should not both write "2".
   */
  async save(where: FormSubmissionTarget, answers: FormAnswers): Promise<number> {
    const summary = submissionSummaryDoc(
      where.teacherDocId,
      where.classroomId,
      where.programmeId
    );

    const attempt = await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(summary);
      const record = snapshot.exists()
        ? (
            snapshot.data()[scopeKey(where)] as
              | Record<string, { questions?: unknown[]; submissionCount?: number }>
              | undefined
          )?.[`assignmentId_${where.assignmentId}`]
        : undefined;

      /* A RECORD WITH ANSWERS BUT NO COUNT COUNTS AS ONE, so a form submitted
         before this field existed does not restart at one. */
      const stored = Number(record?.submissionCount);
      const used = Number.isFinite(stored) && stored > 0
        ? stored
        : Array.isArray(record?.questions) && record.questions.length > 0
          ? 1
          : 0;

      transaction.set(
        summary,
        stripUndefined({
        [scopeKey(where)]: {
          [`assignmentId_${where.assignmentId}`]: {
            /*
             * EMPTY, AND DELIBERATELY SO. Production fills this from the browser's
             * geolocation plus a Google reverse-geocode, and writes `{}` itself
             * whenever the permission is refused or the lookup fails — so an empty
             * map is a value its own readers already handle. This app asks for no
             * location: there is no Maps key configured, and prompting a teacher
             * mid-lesson for their coordinates to record a feedback form is a cost
             * with no reader behind it. Written rather than omitted so the field
             * exists in the shape.
             */
            locationInfo: {},
            lastAttemptTime: serverTimestamp(),
            userAgent: globalThis.navigator?.userAgent ?? '',
            /* '' for the same reason as on a quiz attempt: production fills it
               from a device-info lookup this app has no equivalent of, and writes
               '' itself when that lookup fails. */
            clientIp: '',
            /*
             * HOW MANY TIMES THIS FORM HAS BEEN SUBMITTED. This app's own field:
             * production keeps no `versions` subtree for a form, so without this
             * a document holding one submission and a document holding twenty
             * look identical. NOTHING GATES ON IT — submissions are unlimited.
             */
            submissionCount: used + 1,
            ...answers
          }
        },
        teacherId: where.uid,
        createdAt: serverTimestamp(),
        submissionMeta: arrayUnion({ clientIp: '', submissionTime: new Date() })
      }) as Record<string, unknown>,
        { merge: true }
      );

      return used + 1;
    });

    /*
     * OUTSIDE THE WRITE ABOVE AND ALLOWED TO FAIL ON ITS OWN. Production marks
     * the teacher document with `attemptedAssignments`; it is a convenience index,
     * not the record of the submission, and a failure here must not make a
     * submission that has already landed look like it has not.
     */
    try {
      await setDoc(
        activeTeacherDoc(where.teacherDocId),
        { attemptedAssignments: arrayUnion(answers.id) },
        { merge: true }
      );
    } catch {
      /* The answers are written; this index is not worth failing the submit for. */
    }

    return attempt;
  }

  /**
   * The options a dropdown question offers.
   *
   * THREE FIELDS, THREE MEANINGS, and they are not interchangeable:
   *
   *   dropDown           `dropDownOptions`           'Yes,No'
   *                      A LITERAL comma-separated list. Split and offered.
   *   dropDownDynamic    `dropDownOptionsDynamic`    'RYSI_Categories,subjects'
   *                      A CONFIGURATION REFERENCE: document, then field. Resolved
   *                      below, taking each entry's `display` as production does.
   *   dropDownDependent  `dropDownOptionsDependent`  'RYSI_Categories,rysiCategoryMap,categories'
   *                      A reference into a NESTED map whose branch depends on an
   *                      earlier answer. NOT resolved — see below.
   *
   * PRODUCTION RESOLVES NONE OF THEM IN THIS PLAYER. Its `processQuestions` does
   * all three and the call is COMMENTED OUT in `form-workflow.component.ts`, so
   * its own workflow form renders a dynamic or dependent dropdown as an EMPTY
   * select that cannot be answered — and, because each answer unlocks the next
   * question, an empty one part-way down a form blocks everything after it.
   *
   * SO `dropDownDynamic` IS RESOLVED HERE and the dependent one is not. The
   * dynamic case is a two-segment lookup into a document this app already reads,
   * which is worth doing. The dependent case needs a walk through a nested map
   * keyed on a previous answer, and guessing at it would put wrong options in
   * front of a teacher — an empty list with an explanation beats a plausible
   * wrong one. `canAnswer` below is what stops either from blocking the form.
   */
  optionsFor(question: FormQuestion): string[] {
    if (question.questionType === 'dropDown') {
      return splitOptions(question.dropDownOptions);
    }

    if (question.questionType === 'dropDownDynamic') {
      const [documentId, field] = splitOptions(question.dropDownOptionsDynamic);

      if (!documentId || !field) {
        return [];
      }

      return this.config.dynamicOptions(documentId, field);
    }

    return [];
  }

  /**
   * Whether a question is one the reader can actually answer.
   *
   * `none` IS A HEADING, not a question — production's own label for the type is
   * "Display Only" — and a dropdown whose options could not be resolved has
   * nothing to pick. Both are unanswerable, and both must therefore be excluded
   * from the rule that each answer unlocks the next question, or a form would
   * dead-end on a field nobody can fill.
   */
  canAnswer(question: FormQuestion): boolean {
    if (question.questionType === 'none') {
      return false;
    }

    if (
      question.questionType === 'dropDown' ||
      question.questionType === 'dropDownDynamic' ||
      question.questionType === 'dropDownDependent'
    ) {
      return this.optionsFor(question).length > 0;
    }

    return true;
  }
}

/**
 * WHICH KEY THE RECORD HANGS UNDER: the workflow, or the programme.
 *
 * Production branches on exactly this, and both forms are in its live data. The
 * stepper always has a workflow once saved; the fallback covers a workflow that
 * has not been saved yet and so has no id.
 */
function scopeKey(where: FormSubmissionTarget): string {
  return where.workflowId
    ? `workflowId_${where.workflowId}`
    : `programmeId_${where.programmeId}`;
}

/**
 * 'Yes, No , Maybe' to ['Yes', 'No', 'Maybe'].
 *
 * TRIMMED AND EMPTIES DROPPED, because a stored 'Yes,No,' would otherwise offer a
 * blank third option that looks like a choice and answers nothing.
 */
export function splitOptions(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry !== '');
}

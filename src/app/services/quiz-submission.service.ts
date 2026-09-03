import { Injectable } from '@angular/core';
import {
  arrayUnion,
  runTransaction,
  serverTimestamp,
  setDoc
} from 'firebase/firestore';

import { db } from '../core/firebase';
import {
  activeTeacherDoc,
  newSubmissionMetaDoc,
  submissionAttemptDoc,
  submissionSummaryDoc,
} from '../core/firestore-paths';
import { QuizAssignment, QuizQuestion } from '../models/teaching.model';
import { stripUndefined } from './workflow-template.service';

/**
 * Where a quiz attempt belongs.
 *
 * THE SUMMARY IS KEYED ON THE CLASSROOM AND PROGRAMME, not the quiz, which is
 * production's own shape — see `submissionSummaryDoc` for the measured note.
 */
export interface SubmissionTarget {
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
  /** '' where the quiz is opened outside a workflow. Written as null, as production does. */
  workflowId: string;
}

/** What one submission stores. */
export interface AttemptPayload {
  questions: QuizQuestion[];
  studentScore: number;
  maxScore: number;
  displayName: string;
  totalQuestions: number;
  /** THE QUIZ'S OWN DOCUMENT ID, under production's field name `id`. */
  id: string;
  totalDurationInHours: number | string;
  totalDurationInMinutes: number | string;
  totalDurationInSeconds: number | string;
  userAgent: string;
}

/** What the caller gets back, and what the toast says. */
export interface SubmissionResult {
  attemptId: string;
  attemptNumber: number;
}

/** Thrown when the cap is already reached. Matched by message, as production does. */
export const MAX_ATTEMPTS_REACHED = 'MAX_ATTEMPTS_REACHED';

/**
 * PRODUCTION'S DEFAULT WHEN A QUIZ NAMES NO CAP.
 *
 * `numberOfAllowedSubmissions ?? 3` is the literal expression in its quiz
 * component. Measured on the live data: the field is present on 36 of 81 quiz-like
 * assignment documents, with values 1, 2, 3, 5 and one 35 — so the fallback is
 * doing real work on more than half of them.
 */
export const DEFAULT_ALLOWED_SUBMISSIONS = 3;

/**
 * Recording a quiz attempt — production's method, followed.
 *
 * WHAT PRODUCTION DOES, read off `assignments.service.ts` and confirmed against
 * the live database rather than inferred:
 *
 *   1. Submit opens a CONFIRM dialog. Nothing is written until Yes.
 *   2. The attempt count is read from the summary document and checked against the
 *      quiz's `numberOfAllowedSubmissions` (default 3). At the cap it refuses.
 *   3. ONE TRANSACTION writes three things: the summary document (merged), the
 *      attempt under `attempts/attempt{N}`, and a row under `submissionMeta`.
 *   4. The teacher document gets the quiz id added to `attemptedAssignments`.
 *   5. A toast says `Quiz submitted ( attempt1 )`.
 *
 * A TRANSACTION BECAUSE THE ATTEMPT NUMBER IS DERIVED FROM WHAT IS ALREADY THERE.
 * Two submissions racing would otherwise both read count 1 and both write
 * `attempt2`, so one attempt would silently overwrite the other — and an attempt
 * is a record of what somebody answered, which is the wrong thing to lose.
 *
 * THE QUESTIONS GO IN THE ATTEMPT, NOT THE SUMMARY. Production strips them out of
 * the summary's `latestAttempt` and splits an attempt over `parts/{n}` when it
 * exceeds 900KB. The split is not copied here — see `save` — and the reason is
 * stated rather than left as a gap.
 */
@Injectable({ providedIn: 'root' })
export class QuizSubmissionService {

  /** `numberOfAllowedSubmissions ?? 3`, production's own expression. */
  allowedSubmissions(quiz: QuizAssignment): number {
    const allowed = Number(quiz.numberOfAllowedSubmissions);

    return Number.isFinite(allowed) && allowed > 0 ? allowed : DEFAULT_ALLOWED_SUBMISSIONS;
  }

  /**
   * Writes one attempt.
   *
   * THE SPLIT-OVER-PARTS PATH IS NOT COPIED, deliberately. Production chunks an
   * attempt across `attempts/{id}/parts/{n}` above 900KB, because its quizzes can
   * carry image options inline. This app stores option images as STORAGE PATHS —
   * `AssignmentOption.imagePath` — so a question is text and a few short strings,
   * and the largest quiz in the live data is far under the document limit. Writing
   * a splitter for a case that cannot arise would be code nothing exercises; if a
   * quiz ever grows past the limit the write fails loudly with Firestore's own
   * error rather than silently truncating, which is the failure mode to prefer.
   *
   * THE CAP IS CHECKED INSIDE THE TRANSACTION, not just before it, or two tabs
   * could each pass a pre-check and both write.
   */
  async save(
    where: SubmissionTarget,
    payload: AttemptPayload,
    maxAttempts: number
  ): Promise<SubmissionResult> {
    const summary = submissionSummaryDoc(
      where.teacherDocId,
      where.classroomId,
      where.programmeId
    );

    const result = await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(summary);
      const used = snapshot.exists()
        ? Number(snapshot.data()['attemptsCount'] ?? 0) || 0
        : 0;

      if (used >= maxAttempts) {
        throw new Error(MAX_ATTEMPTS_REACHED);
      }

      const attemptNumber = used + 1;
      const attemptId = `attempt${attemptNumber}`;

      /*
       * THE SUMMARY'S `latestAttempt` CARRIES EVERYTHING BUT THE QUESTIONS, which
       * is what production embeds: it destructures `questions` out and keeps the
       * rest. A summary document is read on every visit to the card, and dragging
       * the whole question set through that read for a figure the card does not
       * show would be paid for on every page load.
       */
      const { questions, ...withoutQuestions } = payload;

      const percentage =
        payload.maxScore > 0
          ? Math.round((payload.studentScore / payload.maxScore) * 100)
          : null;

      transaction.set(
        summary,
        stripUndefined({
          /* PRODUCTION'S `summaryExtras`, field for field. */
          teacherId: where.uid,
          classroomId: where.classroomId,
          programmeId: where.programmeId,
          workflowId: where.workflowId || null,
          assignmentId: payload.id,
          displayName: payload.displayName,
          totalQuestions: payload.totalQuestions,
          maxScore: payload.maxScore,

          attemptsCount: attemptNumber,
          latestAttemptId: attemptId,
          latestAttempt: {
            attemptId,
            attemptNumber,
            lastAttemptTime: serverTimestamp(),
            percentage,
            ...withoutQuestions
          },
          lastAttemptTime: serverTimestamp()
        }) as Record<string, unknown>,
        { merge: true }
      );

      transaction.set(
        submissionAttemptDoc(summary, attemptId),
        stripUndefined({
          attemptId,
          attemptNumber,
          lastAttemptTime: serverTimestamp(),
          ...payload
        }) as Record<string, unknown>,
        { merge: true }
      );

      /*
       * THE META ROW, which production writes with the client IP and a server-side
       * time from its own device-info service. There is no such service here, so
       * `clientIp` is written EMPTY rather than filled with something invented —
       * production writes `''` when its own lookup fails, so an empty string is a
       * value its readers already handle.
       */
      transaction.set(newSubmissionMetaDoc(summary), {
        clientIp: '',
        submissionTime: serverTimestamp(),
        createdAt: serverTimestamp(),
        attemptId
      });

      return { attemptId, attemptNumber };
    });

    /*
     * OUTSIDE THE TRANSACTION, AND ALLOWED TO FAIL ON ITS OWN. Production marks the
     * teacher document with `attemptedAssignments`; it is a convenience index, not
     * the record of the attempt, and a failure here must not undo a submission that
     * has already landed.
     */
    try {
      await setDoc(
        activeTeacherDoc(where.teacherDocId),
        { attemptedAssignments: arrayUnion(payload.id) },
        { merge: true }
      );
    } catch {
      /* The attempt is written; this index is not worth failing the submit for. */
    }

    return result;
  }
}

/**
 * The marks for one attempt — PRODUCTION'S `getTACQuesMarks`, rule for rule.
 *
 * Copied from `quizzer.service.ts` rather than reinvented, because a score written
 * into the same collection production reads has to be computed the same way. Its
 * four rules, and they are not the obvious ones:
 *
 *   MCQ         Full marks only if EVERY option's `isCorrect` matches whether it
 *               was chosen. Not "picked a correct one" — ticking everything on a
 *               multi-answer question scores nothing, and leaving a correct option
 *               unticked scores nothing either.
 *   TEXT        Full marks for ANY non-empty answer. Production does not compare it
 *               to the stored answer at all; typing a single character scores full.
 *               Kept as found, because a score computed differently from
 *               production's would disagree with its own report.
 *   BLANKS      Partial credit: marks / blanks × correct, to two decimals.
 *   SUB-PARTS   Each sub-part all-or-nothing on the same MCQ rule, then summed.
 *               A question with sub-parts ignores its own `marks` entirely.
 *
 * `maxScore` IS EVERY QUESTION'S MARKS, markable or not — which is why the player's
 * own panel reports `scorable` separately. A quiz whose author ticked no correct
 * answers has a maxScore and a studentScore of nought, and the panel is what says
 * which of "you scored nothing" and "nothing could be marked" is true.
 *
 * WHAT IS DELIBERATELY NOT COPIED: production's `calculateMarks` returns
 * `undefined` for a DESCRIPTIVE question, and `total + undefined` is NaN — so one
 * descriptive question makes its whole studentScore NaN, and Firestore rejects NaN,
 * so that submission fails. Here a DESCRIPTIVE question scores 0 and is simply not
 * markable. Reproducing a crash for fidelity's sake would be fidelity to a bug.
 */
export function attemptMarks(
  questions: readonly QuizQuestion[],
  answers: readonly QuizAnswer[]
): { studentScore: number; maxScore: number } {
  let studentScore = 0;
  let maxScore = 0;

  questions.forEach((question, at) => {
    const answer = answers[at];

    if (question.hasSubParts && (question.subParts?.length ?? 0) > 0) {
      const subParts = question.subParts ?? [];

      subParts.forEach((subPart, subAt) => {
        const marks = subPart.marks || 1;

        maxScore += marks;

        const chosen = answer?.subParts?.[subAt] ?? [];

        if (exactlyCorrect(subPart.options ?? [], chosen)) {
          studentScore += marks;
        }
      });

      return;
    }

    const marks = Number(question.marks) || 0;

    maxScore += marks;

    if (question.questionType === 'MCQ') {
      if (exactlyCorrect(question.options ?? [], answer?.chosen ?? [])) {
        studentScore += marks;
      }

      return;
    }

    if (question.questionType === 'TEXT') {
      /* ANY TEXT SCORES FULL, which is production's rule and not a slip here. */
      if ((answer?.text ?? '').trim() !== '') {
        studentScore += marks;
      }

      return;
    }

    if (
      question.questionType === 'FILL_IN_THE_BLANKS' ||
      question.questionType === 'RICH_BLANKS'
    ) {
      const keys = Object.keys(question.blanks ?? {});

      if (keys.length === 0) {
        return;
      }

      const correct = keys.filter(key => {
        const typed = (answer?.blanks?.[key] ?? '').trim();

        if (typed === '') {
          return false;
        }

        /*
         * MATCHED AGAINST THE BLANK'S OWN OPTIONS, case-folded.
         *
         * PRODUCTION READS `ques[blankName].selectedOption.isCorrect` — its blanks
         * are DROPDOWNS, so the reader picks an option and its flag is read
         * directly. This player offers a TEXT BOX, because a blank whose options
         * are shown in a dropdown gives the answer away when there are two of
         * them. So the typed value is matched against the option list instead,
         * which reaches the same verdict for a reader who types the right word.
         */
        return (question.blanks?.[key] ?? []).some(
          option =>
            option.isCorrect && option.name.trim().toLowerCase() === typed.toLowerCase()
        );
      }).length;

      const earned = (marks / keys.length) * correct;

      /* TWO DECIMALS, as production rounds it — 1/3 of 2 marks is 0.67. */
      studentScore += Number.isInteger(earned) ? earned : Number(earned.toFixed(2));
    }

    /* DESCRIPTIVE and anything unrecognised: not markable, scores 0. */
  });

  return { studentScore, maxScore };
}

/** One question's answer, as the player holds it. */
export interface QuizAnswer {
  chosen: number[];
  text: string;
  blanks: Record<string, string>;
  /** Per sub-part chosen option indexes, where the question has sub-parts. */
  subParts?: number[][];
}

/**
 * Stamps `attemptedOption` onto every option — PRODUCTION'S STORED SHAPE.
 *
 * Its attempt documents keep the whole question with each option carrying both
 * `isCorrect` and `attemptedOption`, which is how its report screens re-mark and
 * replay a submission without needing a separate answer sheet. Verified on live
 * data: `attempts/attempt1` question 1 stores
 * `{name: ' It is safe', isCorrect: false, attemptedOption: true}`.
 *
 * `timeTaken` IS WRITTEN AS NULL where it is not measured, which is what
 * production's own documents carry on all but the first question — its player only
 * records the time for a question answered under the per-question timer.
 */
export function stampAnswers(
  questions: readonly QuizQuestion[],
  answers: readonly QuizAnswer[]
): QuizQuestion[] {
  return questions.map((question, at) => {
    const answer = answers[at];

    const stamped: Record<string, unknown> = {
      ...question,
      timeTaken: null
    };

    if (question.options) {
      stamped['options'] = question.options.map((option, optionAt) => ({
        ...option,
        attemptedOption: (answer?.chosen ?? []).includes(optionAt)
      }));
    }

    if (question.subParts) {
      stamped['subParts'] = question.subParts.map((subPart, subAt) => ({
        ...subPart,
        options: (subPart.options ?? []).map((option, optionAt) => ({
          ...option,
          attemptedOption: (answer?.subParts?.[subAt] ?? []).includes(optionAt)
        }))
      }));
    }

    /*
     * THE TYPED ANSWERS GO ON THE QUESTION TOO, under names that say what they
     * are. Production stores a text answer as `text` and a blank's choice as
     * `[blankName].selectedOption`; the first is copied exactly, and the second is
     * written as a `blanksAnswered` map because this player's blanks are typed
     * rather than picked from a list, so there is no `selectedOption` to store.
     * Naming it something else is honest; writing a typed string into a field
     * whose readers expect an option object would not be.
     */
    if ((answer?.text ?? '') !== '') {
      stamped['text'] = answer!.text;
    }

    const blanks = answer?.blanks ?? {};

    if (Object.keys(blanks).length > 0) {
      stamped['blanksAnswered'] = { ...blanks };
    }

    return stamped as unknown as QuizQuestion;
  });
}

/**
 * Whether the chosen options are EXACTLY the correct ones.
 *
 * PRODUCTION'S RULE, EXPRESSED ITS WAY: it counts options where
 * `isCorrect === attemptedOption` and awards the marks only when that count is the
 * whole list. Same verdict as comparing the two sets, and written to match so the
 * comparison against its code is a reading rather than a proof.
 *
 * A QUESTION WITH NO CORRECT OPTION SCORES NOTHING, which follows from the rule
 * rather than being bolted on: a reader who picks nothing matches every option and
 * would otherwise score full marks on a question with no answer set.
 */
function exactlyCorrect(
  options: readonly { isCorrect: boolean }[],
  chosen: readonly number[]
): boolean {
  if (options.length === 0 || !options.some(option => option.isCorrect)) {
    return false;
  }

  return options.every((option, at) => option.isCorrect === chosen.includes(at));
}

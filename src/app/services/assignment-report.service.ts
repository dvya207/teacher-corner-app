import { Injectable } from '@angular/core';
import { getDocs, query, where } from 'firebase/firestore';

import {
  activeTeachersCollection,
  teacherSubmissionAttempts
} from '../core/firestore-paths';
import { teacherFullName, teacherMetaFrom } from './teacher.service';

/** One question as a submitted attempt records it. */
export interface AttemptQuestion {
  questionTitle?: string;
  questionText?: string;
  options?: { isCorrect?: unknown; attemptedOption?: unknown; name?: string }[];
}

/** The latest attempt for one student, with the name to label it. */
export interface StudentAttempt {
  studentId: string;
  studentName: string;
  questions: AttemptQuestion[];
}

/**
 * A row of the Question-wise sheet.
 *
 * THE KEYS ARE THE COLUMN HEADERS, which is why the index signature is here
 * rather than the writer taking `unknown`: a sheet row IS a map from header to
 * cell, and the named fields document which headers this particular sheet has
 * while the signature lets the generic writer accept it.
 */
export interface QuestionAccuracyRow {
  [column: string]: string | number;
  'Question No.': string;
  'Question Description': string;
  'Correct Count': number;
  Percentage: string;
}

/** A row of the Student-wise sheet. Keyed by header, as above. */
export interface StudentSummaryRow {
  [column: string]: string | number;
  'Student Name': string;
  'Attempted Questions': number;
  'Correct Answers': number;
  Percentage: string;
}

/** The four choices a report is scoped to. */
export interface ReportScope {
  assignmentId: string;
  assignmentName: string;
  institutionId: string;
  institutionName: string;
  classroomId: string;
  classroomName: string;
  programmeId: string;
  programmeName: string;
  learningUnitId: string;
  learningUnitName: string;
}

/**
 * `true` however the value was stored.
 *
 * PRODUCTION'S OWN TOLERANCE, copied deliberately: its player has written
 * `isCorrect` as a boolean, as the STRING 'true', and as 1. Testing `=== true`
 * would score every string-stored answer wrong and produce a report full of
 * zeroes that looked like a class that had failed.
 */
export function isTrue(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

/** The indices of the options marked correct on a question. */
export function correctIndices(question: AttemptQuestion): number[] {
  const options = Array.isArray(question?.options) ? question.options : [];

  return options.reduce<number[]>((found, option, index) => {
    if (isTrue(option?.isCorrect)) {
      found.push(index);
    }

    return found;
  }, []);
}

/** The indices the student actually chose. */
export function selectedIndices(question: AttemptQuestion): number[] {
  const options = Array.isArray(question?.options) ? question.options : [];

  return options.reduce<number[]>((found, option, index) => {
    if (isTrue(option?.attemptedOption)) {
      found.push(index);
    }

    return found;
  }, []);
}

/**
 * Whether the answer is right — EXACT SET EQUALITY, not overlap.
 *
 * A multi-answer question with two correct options is only right if both were
 * chosen and nothing else was. Counting an overlap would mark a student who
 * ticked every option as correct on every question.
 */
export function isAnswerCorrect(question: AttemptQuestion): boolean {
  const correct = correctIndices(question);
  const selected = selectedIndices(question);

  return (
    selected.length === correct.length &&
    selected.every(index => correct.includes(index))
  );
}

/**
 * A question's text, without its markup.
 *
 * REGEX RATHER THAN A DETACHED ELEMENT. Production builds a `<div>` and reads
 * `textContent`, which also executes nothing but does require a DOM — and this
 * runs in a service that its own tests exercise without one. Images are dropped
 * before the tags come off, because a base64 data URI in an `alt`-less `<img>`
 * would otherwise land in a spreadsheet cell as kilobytes of noise.
 */
export function htmlToText(html: string | undefined | null): string {
  if (!html) {
    return '';
  }

  return html
    .replace(/<(img|picture|figure)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(img|picture|source)\b[^>]*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Drops a leading 'Q1.' or '3)' from a question's own text.
 *
 * The sheet already has a Question No. column, so a title that repeats its
 * number reads as 'Q1 | Q1. What materials…'.
 */
export function stripLeadingIndex(text: string): string {
  return text.replace(/^\s*(?:q(?:uestion)?\s*)?\d{1,3}\s*[.)\-–—:]\s*/i, '').trim();
}

/** Strips what a filename cannot carry. */
export function sanitiseForFilename(value: string): string {
  return (value || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `Institution_Classroom_Programme_Unit_Assignment[suffix].xlsx`, as production names it. */
export function reportFilename(scope: ReportScope, suffix = '', extension = '.xlsx'): string {
  const parts = [
    sanitiseForFilename(scope.institutionName) || 'Institution',
    sanitiseForFilename(scope.classroomName) || 'Classroom',
    sanitiseForFilename(scope.programmeName) || 'Programme',
    sanitiseForFilename(scope.learningUnitName) || 'LearningUnit',
    sanitiseForFilename(scope.assignmentName) || 'Assignment'
  ];

  return `${parts.join('_')}${suffix}${extension}`;
}

/**
 * QUESTION-WISE: one row per question, how many got it right.
 *
 * THE QUESTION LIST COMES FROM THE FIRST ATTEMPT THAT HAS ONE, which is
 * production's approach and worth keeping: the questions live on the submitted
 * attempt rather than being re-read from the assignment, so the report describes
 * what the students were actually asked. An assignment edited after they sat it
 * would otherwise be reported against questions nobody saw.
 */
export function buildQuestionAccuracy(attempts: StudentAttempt[]): QuestionAccuracyRow[] {
  const base = attempts.find(attempt => attempt.questions.length > 0)?.questions ?? [];

  if (base.length === 0) {
    return [];
  }

  const counted = attempts.filter(attempt => attempt.questions.length > 0);
  const correctCounts = new Array<number>(base.length).fill(0);

  for (const attempt of counted) {
    const upTo = Math.min(attempt.questions.length, base.length);

    for (let index = 0; index < upTo; index++) {
      if (isAnswerCorrect(attempt.questions[index])) {
        correctCounts[index]++;
      }
    }
  }

  return base.map((question, index) => {
    const description = stripLeadingIndex(
      htmlToText(question.questionTitle ?? question.questionText)
    );
    const correct = correctCounts[index];

    return {
      'Question No.': `Q${index + 1}`,
      'Question Description': description || `Q${index + 1}`,
      'Correct Count': correct,
      Percentage: `${counted.length > 0 ? Math.round((correct / counted.length) * 100) : 0}%`
    };
  });
}

/** STUDENT-WISE: one row per student, how many they got right. */
export function buildStudentSummary(attempts: StudentAttempt[]): StudentSummaryRow[] {
  return attempts.map(attempt => {
    const attempted = attempt.questions.length;
    const correct = attempt.questions.filter(question => isAnswerCorrect(question)).length;

    return {
      'Student Name': attempt.studentName || attempt.studentId,
      'Attempted Questions': attempted,
      'Correct Answers': correct,
      Percentage: `${attempted > 0 ? Math.round((correct / attempted) * 100) : 0}%`
    };
  });
}

/**
 * Reads the submissions behind an assignment report.
 *
 * IT READS TEACHERS, NOT STUDENTS, AND THAT IS THE WHOLE POINT OF THIS FILE'S
 * HISTORY. It used to read production's `Students/{id}/remoteSubmissions/...`,
 * a shape copied faithfully from production's own report component — and one
 * this database has never contained. There is no `Students` collection here and
 * no student in this app's model, so every read returned nothing and the report
 * came out empty every single time.
 *
 * IN THIS APP THE TEACHER IS THE ONE WHO SUBMITS. A quiz is answered by the
 * teacher walking the class through a workflow, and their attempt lands at
 * `teachers/{docId}/submissions/{classroomId}-{programmeId}/attempts/attempt{N}`.
 * So the report is pointed there, and it now returns rows.
 *
 * THE THREE SHAPES LINE UP ALREADY, which is why this is a repoint rather than a
 * rewrite:
 *
 *   - the scope filter reads a `classrooms` MAP with `programmes` nested inside
 *     each entry, and a teacher document carries exactly that;
 *   - `attemptedAssignments` is an array on the teacher document, which is where
 *     both submission services now write it;
 *   - an attempt document carries `questions`, the same field the sheets read.
 *
 * ONE READ FEWER PER ROW. The name no longer needs `CustomAuthentication`: a
 * teacher record carries `teacherMeta.firstName` and `lastName` directly.
 *
 * "student" IS KEPT IN THE TYPES AND COLUMN HEADINGS. `StudentAttempt`,
 * `studentId` and the "Student Name" column are what the sheet is called and
 * what production's own export calls them, and renaming them would change a
 * deliverable people already read. The identifiers name a ROLE in the report,
 * not a `Students` document.
 *
 * The reads are the only part that cannot be tested here. Everything that turns
 * submissions into rows is a plain function, which is why they are exported
 * separately rather than living inside this class.
 */
@Injectable({ providedIn: 'root' })
export class AssignmentReportService {

  /**
   * The students who attempted this assignment AND sit in the chosen scope.
   *
   * TWO STAGES, because Firestore cannot express the second: the query narrows by
   * `attemptedAssignments array-contains`, and the institution, classroom and
   * programme are then matched against each student's own `classrooms` map in
   * memory. That map is keyed by classroom id with the programmes nested inside
   * it, which no single query can filter on.
   */
  async listStudentsInScope(scope: ReportScope): Promise<{ id: string; data: Record<string, unknown> }[]> {
    if (!scope.assignmentId) {
      return [];
    }

    const snapshot = await getDocs(
      query(
        activeTeachersCollection(),
        where('attemptedAssignments', 'array-contains', scope.assignmentId)
      )
    );

    return snapshot.docs
      .map(entry => ({ id: entry.id, data: entry.data() as Record<string, unknown> }))
      .filter(student => matchesScope(student.data, scope));
  }

  /**
   * The LATEST attempt for one student on this assignment.
   *
   * Latest by `attemptedAt` where it exists, falling back to the last document —
   * a student may sit an assignment more than once and the report is about where
   * they ended up, not where they started.
   */
  async latestAttempt(teacherDocId: string, scope: ReportScope): Promise<AttemptQuestion[]> {
    /*
     * THE SUMMARY IS KEYED ON CLASSROOM AND PROGRAMME, NOT ON THE ASSIGNMENT,
     * which is production's own choice and the reason this cannot simply query by
     * quiz id the way the Students version did. One summary therefore spans every
     * quiz set in that classroom and programme, and its attempts have to be
     * filtered down to the one the report is about.
     *
     * WITHOUT BOTH SCOPE IDS THERE IS NO DOCUMENT TO NAME. A report run across a
     * whole institution cannot address a summary, so it returns nothing rather
     * than reading every teacher's every classroom.
     */
    if (!scope.classroomId || !scope.programmeId) {
      return [];
    }

    const attempts = await getDocs(
      teacherSubmissionAttempts(teacherDocId, scope.classroomId, scope.programmeId)
    );

    if (attempts.empty) {
      return [];
    }

    /*
     * NEWEST FIRST, then the first attempt that is actually about THIS
     * assignment. `id` on the attempt is the quiz's own document id, which is
     * what production writes and what `attemptedAssignments` collects.
     */
    const sorted = [...attempts.docs].sort((a, b) => millis(b.data()) - millis(a.data()));

    for (const attempt of sorted) {
      const data = attempt.data() as { id?: unknown; questions?: AttemptQuestion[] };

      if (String(data.id ?? '') !== scope.assignmentId) {
        continue;
      }

      if (Array.isArray(data.questions) && data.questions.length > 0) {
        return data.questions;
      }
    }

    return [];
  }

  /**
   * The name for the row, off the teacher record.
   *
   * NO SECOND READ. The Students version fell back to `CustomAuthentication`
   * because a student document did not reliably carry a name; a teacher record
   * does, on `teacherMeta`, so the whole report costs one read fewer per row.
   *
   * Goes through `teacherMetaFrom` rather than reading `teacherMeta` directly, so
   * the flat legacy fields identity used to live in are picked up too — the same
   * reason `pickRegisteredName` does.
   *
   * FALLS BACK TO THE ID, never to blank. A row with marks and no label is worse
   * than a row labelled with an id somebody can look up.
   */
  async studentName(teacherDocId: string, data: Record<string, unknown>): Promise<string> {
    const meta = teacherMetaFrom(data);
    const joined = teacherFullName(meta.firstName ?? '', meta.lastName ?? '').trim();

    if (joined) {
      return joined;
    }

    const named = String(data['name'] ?? data['studentName'] ?? '').trim();

    return named || teacherDocId;
  }

  /**
   * Everything the two sheets need, in one pass.
   *
   * SEQUENTIAL RATHER THAN PARALLEL over students. Production fans out six at a
   * time; a report is not latency-sensitive and a class is tens of students, so
   * the simpler loop is worth more than the seconds — and it cannot flood the
   * client with concurrent reads on a large class.
   */
  async collectAttempts(scope: ReportScope): Promise<StudentAttempt[]> {
    const students = await this.listStudentsInScope(scope);
    const collected: StudentAttempt[] = [];

    for (const student of students) {
      const questions = await this.latestAttempt(student.id, scope);

      if (questions.length === 0) {
        continue;
      }

      collected.push({
        studentId: student.id,
        studentName: await this.studentName(student.id, student.data),
        questions
      });
    }

    return collected.sort((a, b) => a.studentName.localeCompare(b.studentName));
  }
}

/**
 * Whether a student's `classrooms` map places them in the chosen scope.
 *
 * Exported for the tests: this is the filter Firestore cannot do, so it is the
 * one place a wrong report would come from silently.
 */
export function matchesScope(
  data: Record<string, unknown>,
  scope: ReportScope
): boolean {
  const classrooms = (data['classrooms'] ?? {}) as Record<string, unknown>;

  return Object.values(classrooms).some(value => {
    const entry = (value ?? {}) as Record<string, unknown>;

    if (scope.institutionId && entry['institutionId'] !== scope.institutionId) {
      return false;
    }

    if (scope.classroomId && entry['classroomId'] !== scope.classroomId) {
      return false;
    }

    if (!scope.programmeId) {
      return true;
    }

    const programmes = Array.isArray(entry['programmes']) ? entry['programmes'] : [];

    return programmes.some(programme => {
      const row = (programme ?? {}) as Record<string, unknown>;

      return (row['programmeId'] ?? row['docId']) === scope.programmeId;
    });
  });
}

/** An attempt's timestamp in millis, however it was stored. 0 when absent. */
function millis(data: Record<string, unknown>): number {
  const value = data['attemptedAt'] ?? data['createdAt'] ?? data['updatedAt'];
  const stamp = value as { toMillis?: () => number; seconds?: number } | undefined;

  if (stamp?.toMillis) {
    return stamp.toMillis();
  }

  if (typeof stamp?.seconds === 'number') {
    return stamp.seconds * 1000;
  }

  return 0;
}

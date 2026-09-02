import {
  AttemptQuestion,
  ReportScope,
  StudentAttempt,
  buildQuestionAccuracy,
  buildStudentSummary,
  correctIndices,
  htmlToText,
  isAnswerCorrect,
  isTrue,
  matchesScope,
  reportFilename,
  sanitiseForFilename,
  selectedIndices,
  stripLeadingIndex
} from './assignment-report.service';

/**
 * The assignment report's scoring and row building.
 *
 * WHAT THESE COVER, AND WHAT THEY CANNOT. The Firestore reads in
 * AssignmentReportService cannot be exercised: this app has no `Students`
 * collection and no student in its model, so there is no submission data to read
 * anywhere in its database. Everything that turns submissions into spreadsheet
 * rows is a plain function for exactly that reason, and that is what is tested
 * here — against fixtures shaped like production's own attempt documents.
 *
 * Four of these guard mistakes that produce a report which is WRONG rather than
 * broken, which is the worse failure for a document somebody acts on:
 *
 *   1. `isCorrect` IS NOT ALWAYS A BOOLEAN. Production's player has written it as
 *      true, as 'true', and as 1. A strict check scores every string-stored answer
 *      wrong and reports a class that failed.
 *   2. CORRECTNESS IS EXACT SET EQUALITY. Overlap would mark a student who
 *      ticked every option as correct on everything.
 *   3. THE SCOPE FILTER runs in memory because Firestore cannot express it, so it
 *      is the one place a silently wrong cohort comes from.
 *   4. THE QUESTION LIST COMES FROM THE ATTEMPT, not the assignment, so a report
 *      describes what students were actually asked.
 */

function question(
  options: { isCorrect?: unknown; attemptedOption?: unknown }[],
  questionTitle = 'A question'
): AttemptQuestion {
  return { questionTitle, options };
}

function scope(overrides: Partial<ReportScope> = {}): ReportScope {
  return {
    assignmentId: 'a1',
    assignmentName: 'Deogiri Reflection - Day 2',
    institutionId: 'inst1',
    institutionName: 'BEACON HILL UNIVESITY',
    classroomId: 'room1',
    classroomName: '8 D',
    programmeId: 'prog1',
    programmeName: 'scott',
    learningUnitId: 'lu1',
    learningUnitName: 'Swimming (BA01)',
    ...overrides
  };
}

describe('isTrue', () => {

  /** Production's own tolerance, and the reason it exists. */
  it('accepts every form the player has written', () => {
    expect(isTrue(true)).toBe(true);
    expect(isTrue('true')).toBe(true);
    expect(isTrue(1)).toBe(true);
    expect(isTrue('1')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isTrue(false)).toBe(false);
    expect(isTrue('false')).toBe(false);
    expect(isTrue(0)).toBe(false);
    expect(isTrue(null)).toBe(false);
    expect(isTrue(undefined)).toBe(false);
    expect(isTrue('yes')).toBe(false);
  });
});

describe('reading a question', () => {

  it('finds the correct and the selected options', () => {
    const q = question([
      { isCorrect: false, attemptedOption: true },
      { isCorrect: true, attemptedOption: true },
      { isCorrect: true }
    ]);

    expect(correctIndices(q)).toEqual([1, 2]);
    expect(selectedIndices(q)).toEqual([0, 1]);
  });

  it('copes with a question that has no options at all', () => {
    expect(correctIndices({} as AttemptQuestion)).toEqual([]);
    expect(selectedIndices({ options: undefined })).toEqual([]);
  });

  /** A string-stored flag has to count, or a whole class reads as failing. */
  it('reads options stored as strings', () => {
    const q = question([
      { isCorrect: 'true', attemptedOption: 'true' },
      { isCorrect: 'false', attemptedOption: 'false' }
    ]);

    expect(isAnswerCorrect(q)).toBe(true);
  });
});

describe('isAnswerCorrect', () => {

  it('is true when the chosen options are exactly the correct ones', () => {
    expect(isAnswerCorrect(question([
      { isCorrect: true, attemptedOption: true },
      { isCorrect: false }
    ]))).toBe(true);
  });

  it('is false when one of two correct options was missed', () => {
    expect(isAnswerCorrect(question([
      { isCorrect: true, attemptedOption: true },
      { isCorrect: true },
      { isCorrect: false }
    ]))).toBe(false);
  });

  /**
   * EXACT SET EQUALITY, not overlap. Ticking everything must not score as right,
   * which is what an overlap check would do on every multi-answer question.
   */
  it('is false when everything was ticked', () => {
    expect(isAnswerCorrect(question([
      { isCorrect: true, attemptedOption: true },
      { isCorrect: false, attemptedOption: true },
      { isCorrect: false, attemptedOption: true }
    ]))).toBe(false);
  });

  it('is false when nothing was answered and something was correct', () => {
    expect(isAnswerCorrect(question([{ isCorrect: true }, { isCorrect: false }]))).toBe(false);
  });

  /** No correct options and no answer is vacuously equal, and counts as right. */
  it('is true for a question with nothing to get wrong', () => {
    expect(isAnswerCorrect(question([{ isCorrect: false }, { isCorrect: false }]))).toBe(true);
  });
});

describe('htmlToText', () => {

  it('strips tags and collapses whitespace', () => {
    expect(htmlToText('<p><strong>What</strong>  materials\ndid you need?</p>'))
      .toBe('What materials did you need?');
  });

  it('turns &nbsp; into a space', () => {
    expect(htmlToText('<p>a&nbsp;b</p>')).toBe('a b');
  });

  /**
   * IMAGES GO BEFORE THE TAGS COME OFF. Production stores base64 data URIs inside
   * question titles, and a bare tag-strip would put kilobytes of them into a
   * spreadsheet cell.
   */
  it('drops images and any base64 payload', () => {
    const html = '<p>Look <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="/> here</p>';

    expect(htmlToText(html)).toBe('Look here');
  });

  it('returns an empty string for nothing', () => {
    expect(htmlToText('')).toBe('');
    expect(htmlToText(null)).toBe('');
    expect(htmlToText(undefined)).toBe('');
  });
});

describe('stripLeadingIndex', () => {

  /** The sheet already has a Question No. column. */
  it('removes a number the question repeats', () => {
    expect(stripLeadingIndex('Q1. What materials?')).toBe('What materials?');
    expect(stripLeadingIndex('3) Why does it work?')).toBe('Why does it work?');
    expect(stripLeadingIndex('Question 2: How?')).toBe('How?');
  });

  it('leaves a question that opens with a real number', () => {
    expect(stripLeadingIndex('100 grams of what?')).toBe('100 grams of what?');
  });
});

describe('the filename', () => {

  it('joins the scope, as production names it', () => {
    expect(reportFilename(scope()))
      .toBe('BEACON HILL UNIVESITY_8 D_scott_Swimming (BA01)_Deogiri Reflection - Day 2.xlsx');
  });

  it('takes a suffix for the student-wise sheet', () => {
    expect(reportFilename(scope(), '_Student-wise')).toContain('_Student-wise.xlsx');
  });

  /** A '/' in a classroom name would otherwise break the download. */
  it('strips what a filename cannot carry', () => {
    expect(sanitiseForFilename('8 D / B*ch?')).toBe('8 D B ch');
    expect(reportFilename(scope({ classroomName: 'A/B' }))).toContain('_A B_');
  });

  it('falls back where a name is missing', () => {
    expect(reportFilename(scope({ institutionName: '', assignmentName: '' })))
      .toBe('Institution_8 D_scott_Swimming (BA01)_Assignment.xlsx');
  });
});

describe('buildQuestionAccuracy', () => {

  /** Two of three right on Q1, one of three on Q2. */
  it('counts how many got each question right', () => {
    const attempts: StudentAttempt[] = [
      {
        studentId: 's1', studentName: 'A',
        questions: [
          question([{ isCorrect: true, attemptedOption: true }], 'Q1. First'),
          question([{ isCorrect: true, attemptedOption: true }], 'Second')
        ]
      },
      {
        studentId: 's2', studentName: 'B',
        questions: [
          question([{ isCorrect: true, attemptedOption: true }], 'Q1. First'),
          question([{ isCorrect: true }], 'Second')
        ]
      },
      {
        studentId: 's3', studentName: 'C',
        questions: [
          question([{ isCorrect: true }], 'Q1. First'),
          question([{ isCorrect: true }], 'Second')
        ]
      }
    ];

    const rows = buildQuestionAccuracy(attempts);

    expect(rows.length).toBe(2);
    expect(rows[0]['Question No.']).toBe('Q1');
    // The leading 'Q1.' is stripped: the column already carries it.
    expect(rows[0]['Question Description']).toBe('First');
    expect(rows[0]['Correct Count']).toBe(2);
    expect(rows[0]['Percentage']).toBe('67%');

    expect(rows[1]['Correct Count']).toBe(1);
    expect(rows[1]['Percentage']).toBe('33%');
  });

  /**
   * THE QUESTION LIST COMES FROM THE FIRST ATTEMPT THAT HAS ONE, not from the
   * assignment. An assignment edited after the students sat it would otherwise be
   * reported against questions nobody saw.
   */
  it('takes the questions from the attempts', () => {
    const rows = buildQuestionAccuracy([
      { studentId: 's1', studentName: 'A', questions: [] },
      {
        studentId: 's2', studentName: 'B',
        questions: [question([{ isCorrect: true }], 'The one they saw')]
      }
    ]);

    expect(rows.length).toBe(1);
    expect(rows[0]['Question Description']).toBe('The one they saw');
  });

  /** A short attempt must not be counted against questions it did not include. */
  it('ignores questions past the end of a shorter attempt', () => {
    const rows = buildQuestionAccuracy([
      {
        studentId: 's1', studentName: 'A',
        questions: [
          question([{ isCorrect: true, attemptedOption: true }], 'One'),
          question([{ isCorrect: true, attemptedOption: true }], 'Two')
        ]
      },
      {
        studentId: 's2', studentName: 'B',
        questions: [question([{ isCorrect: true, attemptedOption: true }], 'One')]
      }
    ]);

    expect(rows[0]['Correct Count']).toBe(2);
    expect(rows[1]['Correct Count']).toBe(1);
    // Both students counted, so the second question is 1 of 2 rather than 1 of 1.
    expect(rows[1]['Percentage']).toBe('50%');
  });

  it('returns nothing when no attempt carries questions', () => {
    expect(buildQuestionAccuracy([])).toEqual([]);
    expect(buildQuestionAccuracy([
      { studentId: 's1', studentName: 'A', questions: [] }
    ])).toEqual([]);
  });

  /** A question with no text still gets a usable description. */
  it('falls back to the number when a question has no text', () => {
    const rows = buildQuestionAccuracy([
      { studentId: 's1', studentName: 'A', questions: [{ options: [] }] }
    ]);

    expect(rows[0]['Question Description']).toBe('Q1');
  });
});

describe('buildStudentSummary', () => {

  it('scores each student', () => {
    const rows = buildStudentSummary([
      {
        studentId: 's1', studentName: 'Arnav',
        questions: [
          question([{ isCorrect: true, attemptedOption: true }]),
          question([{ isCorrect: true }]),
          question([{ isCorrect: true, attemptedOption: true }])
        ]
      }
    ]);

    expect(rows[0]['Student Name']).toBe('Arnav');
    expect(rows[0]['Attempted Questions']).toBe(3);
    expect(rows[0]['Correct Answers']).toBe(2);
    expect(rows[0]['Percentage']).toBe('67%');
  });

  /** No divide-by-zero on an attempt with no questions. */
  it('reports 0% rather than NaN for an empty attempt', () => {
    const rows = buildStudentSummary([
      { studentId: 's1', studentName: 'A', questions: [] }
    ]);

    expect(rows[0]['Percentage']).toBe('0%');
  });

  /** The id is a usable label when the name could not be resolved. */
  it('falls back to the id when there is no name', () => {
    const rows = buildStudentSummary([
      { studentId: 'abc123', studentName: '', questions: [] }
    ]);

    expect(rows[0]['Student Name']).toBe('abc123');
  });
});

/**
 * THE FILTER FIRESTORE CANNOT DO.
 *
 * The query narrows by `attemptedAssignments array-contains`; the institution,
 * classroom and programme are matched here against the student's own `classrooms`
 * map, which is keyed by classroom id with the programmes nested inside. Getting
 * this wrong produces a report for the wrong cohort with nothing to show it.
 */
describe('matchesScope', () => {

  const student = (classrooms: Record<string, unknown>) => ({ classrooms });

  it('matches a student in the right classroom and programme', () => {
    const data = student({
      room1: {
        institutionId: 'inst1',
        classroomId: 'room1',
        programmes: [{ programmeId: 'prog1' }]
      }
    });

    expect(matchesScope(data, scope())).toBe(true);
  });

  it('rejects a different institution', () => {
    const data = student({
      room1: { institutionId: 'other', classroomId: 'room1', programmes: [{ programmeId: 'prog1' }] }
    });

    expect(matchesScope(data, scope())).toBe(false);
  });

  it('rejects a different classroom', () => {
    const data = student({
      room9: { institutionId: 'inst1', classroomId: 'room9', programmes: [{ programmeId: 'prog1' }] }
    });

    expect(matchesScope(data, scope())).toBe(false);
  });

  it('rejects a classroom that does not carry the programme', () => {
    const data = student({
      room1: { institutionId: 'inst1', classroomId: 'room1', programmes: [{ programmeId: 'other' }] }
    });

    expect(matchesScope(data, scope())).toBe(false);
  });

  /** Production reads either key, so a document using `docId` still matches. */
  it('accepts a programme identified by docId', () => {
    const data = student({
      room1: { institutionId: 'inst1', classroomId: 'room1', programmes: [{ docId: 'prog1' }] }
    });

    expect(matchesScope(data, scope())).toBe(true);
  });

  /** A student in several classrooms matches on ANY of them. */
  it('matches on any one of a student\'s classrooms', () => {
    const data = student({
      roomA: { institutionId: 'other', classroomId: 'roomA', programmes: [] },
      room1: { institutionId: 'inst1', classroomId: 'room1', programmes: [{ programmeId: 'prog1' }] }
    });

    expect(matchesScope(data, scope())).toBe(true);
  });

  it('rejects a student with no classrooms at all', () => {
    expect(matchesScope({}, scope())).toBe(false);
    expect(matchesScope({ classrooms: {} }, scope())).toBe(false);
  });

  /** An unset scope field is not a filter, so it must not exclude anybody. */
  it('ignores a scope field that is empty', () => {
    const data = student({ room1: { institutionId: 'inst1', classroomId: 'room1' } });

    expect(matchesScope(data, scope({ programmeId: '' }))).toBe(true);
  });
});

import {
  DEFAULT_ALLOWED_SUBMISSIONS,
  QuizAnswer,
  attemptMarks,
  stampAnswers
} from './quiz-submission.service';
import { AssignmentOption, QuizQuestion } from '../models/teaching.model';

/**
 * Recording a quiz attempt.
 *
 * WHAT IS WORTH TESTING HERE IS THE ARITHMETIC, and it is worth testing because it
 * is COPIED rather than designed. A score written into the same collection
 * production reads has to be computed the way production computes it, and its rules
 * are not the ones anybody would guess:
 *
 *   - An MCQ is all-or-nothing on EVERY option, not on the ones chosen.
 *   - A TEXT question scores FULL MARKS for any non-empty answer, without being
 *     compared to the stored answer at all.
 *   - Blanks score partial credit, rounded to two decimals.
 *   - A question with sub-parts ignores its own `marks` entirely.
 *
 * Each of those is a line in `quizzer.service.ts` that a reasonable person would
 * "fix" if they met it without knowing where it came from, and fixing any of them
 * would make this app's stored scores disagree with production's reports. The tests
 * pin them so the copy stays a copy.
 *
 * THE WRITE ITSELF IS NOT TESTED HERE. It is a Firestore transaction with three
 * sets in it; standing in for `runTransaction` would leave a test that asserts the
 * mock was called. It was verified against the database instead — see the path
 * helper's note for the live document the shape was read from.
 */

function option(name: string, isCorrect: boolean): AssignmentOption {
  return { name, isCorrect, optionType: 'TEXT', imagePath: '' };
}

function question(overrides: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    questionTitle: 'Q',
    questionType: 'MCQ',
    marks: 1,
    pedagogyType: 'FA',
    durationInHours: 0,
    durationInMinutes: 0,
    durationInSeconds: 0,
    ...overrides
  };
}

function answer(overrides: Partial<QuizAnswer> = {}): QuizAnswer {
  return { chosen: [], text: '', blanks: {}, ...overrides };
}

describe('attemptMarks', () => {

  describe('MCQ', () => {

    it('gives full marks for the correct single option', () => {
      const questions = [
        question({ marks: 2, options: [option('A', true), option('B', false)] })
      ];

      const marks = attemptMarks(questions, [answer({ chosen: [0] })]);

      expect(marks).toEqual({ studentScore: 2, maxScore: 2 });
    });

    it('gives nothing for the wrong option', () => {
      const questions = [
        question({ marks: 2, options: [option('A', true), option('B', false)] })
      ];

      const marks = attemptMarks(questions, [answer({ chosen: [1] })]);

      expect(marks).toEqual({ studentScore: 0, maxScore: 2 });
    });

    /**
     * TICKING EVERYTHING SCORES NOTHING, which is the rule that makes the copy
     * matter. Production compares `isCorrect === attemptedOption` on every option,
     * so a wrong option ticked fails the question even when all the right ones
     * were ticked too. "Contains a correct answer" would score full marks here.
     */
    it('gives nothing when every option is ticked', () => {
      const questions = [
        question({
          marks: 3,
          oneCorrectOption: false,
          options: [option('A', true), option('B', true), option('C', false)]
        })
      ];

      const marks = attemptMarks(questions, [answer({ chosen: [0, 1, 2] })]);

      expect(marks).toEqual({ studentScore: 0, maxScore: 3 });
    });

    /** AND A MISSING CORRECT OPTION FAILS IT TOO. All-or-nothing both ways. */
    it('gives nothing when one correct option is left out', () => {
      const questions = [
        question({
          marks: 3,
          oneCorrectOption: false,
          options: [option('A', true), option('B', true), option('C', false)]
        })
      ];

      const marks = attemptMarks(questions, [answer({ chosen: [0] })]);

      expect(marks).toEqual({ studentScore: 0, maxScore: 3 });
    });

    it('gives full marks for exactly the correct pair', () => {
      const questions = [
        question({
          marks: 3,
          oneCorrectOption: false,
          options: [option('A', true), option('B', true), option('C', false)]
        })
      ];

      const marks = attemptMarks(questions, [answer({ chosen: [1, 0] })]);

      expect(marks).toEqual({ studentScore: 3, maxScore: 3 });
    });

    /**
     * A QUESTION WITH NO CORRECT OPTION SCORES NOTHING EVEN WHEN NOTHING IS
     * CHOSEN — and that case is not hypothetical. It is the shape behind a real
     * report: a quiz whose author had ticked no answers. Under production's
     * comparison, choosing nothing MATCHES every option, so without the guard it
     * would score full marks for an empty answer sheet.
     *
     * `maxScore` STILL COUNTS ITS MARKS, which is why the player reports
     * `scorable` separately and says why the score is nought.
     */
    it('gives nothing for a question with no correct option, answered or not', () => {
      const questions = [
        question({ marks: 5, options: [option('A', false), option('B', false)] })
      ];

      expect(attemptMarks(questions, [answer()])).toEqual({
        studentScore: 0,
        maxScore: 5
      });
      expect(attemptMarks(questions, [answer({ chosen: [0] })])).toEqual({
        studentScore: 0,
        maxScore: 5
      });
    });

    /** An empty option list is not markable either, and must not throw. */
    it('survives a question with no options', () => {
      const questions = [question({ marks: 2, options: [] })];

      expect(attemptMarks(questions, [answer()])).toEqual({
        studentScore: 0,
        maxScore: 2
      });
    });
  });

  describe('TEXT', () => {

    /**
     * ANY TEXT SCORES FULL MARKS. This is production's rule verbatim — its
     * `calculateMarks` returns `ques.marks` for `ques?.text` being truthy and never
     * looks at the stored answer. Kept because a score computed differently from
     * production's would disagree with its own report on the same submission.
     */
    it('gives full marks for any non-empty answer', () => {
      const questions = [question({ questionType: 'TEXT', marks: 4, answer: 'photosynthesis' })];

      const marks = attemptMarks(questions, [answer({ text: 'anything at all' })]);

      expect(marks).toEqual({ studentScore: 4, maxScore: 4 });
    });

    it('gives nothing for an empty answer', () => {
      const questions = [question({ questionType: 'TEXT', marks: 4, answer: 'x' })];

      expect(attemptMarks(questions, [answer({ text: '   ' })])).toEqual({
        studentScore: 0,
        maxScore: 4
      });
    });
  });

  describe('the blank types', () => {

    /** PARTIAL CREDIT: marks / blanks × correct, which is production's formula. */
    it('gives a share of the marks per correct blank', () => {
      const questions = [
        question({
          questionType: 'FILL_IN_THE_BLANKS',
          marks: 4,
          blanks: {
            optionsBlank1: [option('sun', true), option('moon', false)],
            optionsBlank2: [option('water', true), option('sand', false)]
          }
        })
      ];

      const marks = attemptMarks(questions, [
        answer({ blanks: { optionsBlank1: 'sun', optionsBlank2: 'sand' } })
      ]);

      expect(marks).toEqual({ studentScore: 2, maxScore: 4 });
    });

    /** TWO DECIMALS, as production rounds it: 2 marks over 3 blanks, one right. */
    it('rounds a fractional share to two decimals', () => {
      const questions = [
        question({
          questionType: 'RICH_BLANKS',
          marks: 2,
          blanks: {
            a: [option('one', true)],
            b: [option('two', true)],
            c: [option('three', true)]
          }
        })
      ];

      const marks = attemptMarks(questions, [answer({ blanks: { a: 'one' } })]);

      expect(marks).toEqual({ studentScore: 0.67, maxScore: 2 });
    });

    /** MATCHED CASE-INSENSITIVELY, so 'Sun' is not marked wrong for its capital. */
    it('matches a typed blank regardless of case and spacing', () => {
      const questions = [
        question({
          questionType: 'FILL_IN_THE_BLANKS',
          marks: 1,
          blanks: { optionsBlank1: [option('Sun', true)] }
        })
      ];

      const marks = attemptMarks(questions, [
        answer({ blanks: { optionsBlank1: '  sun ' } })
      ]);

      expect(marks).toEqual({ studentScore: 1, maxScore: 1 });
    });

    it('gives nothing for a question with no blanks defined', () => {
      const questions = [
        question({ questionType: 'FILL_IN_THE_BLANKS', marks: 3, blanks: {} })
      ];

      expect(attemptMarks(questions, [answer()])).toEqual({
        studentScore: 0,
        maxScore: 3
      });
    });
  });

  describe('DESCRIPTIVE', () => {

    /**
     * SCORES ZERO AND DOES NOT POISON THE TOTAL — and this is the ONE PLACE the
     * copy deliberately departs from production.
     *
     * Its `calculateMarks` has no branch for DESCRIPTIVE, so it returns
     * `undefined`; `total + undefined` is NaN, and Firestore REFUSES NaN, so a
     * quiz with one descriptive question fails to submit at all in production.
     * Reproducing a crash for fidelity's sake would be fidelity to a bug.
     */
    it('scores zero rather than making the whole total NaN', () => {
      const questions = [
        question({ marks: 2, options: [option('A', true), option('B', false)] }),
        question({ questionType: 'DESCRIPTIVE', marks: 5 })
      ];

      const marks = attemptMarks(questions, [
        answer({ chosen: [0] }),
        answer({ text: 'a long answer' })
      ]);

      expect(marks).toEqual({ studentScore: 2, maxScore: 7 });
      expect(Number.isNaN(marks.studentScore)).toBe(false);
    });
  });

  describe('sub-parts', () => {

    /**
     * THE PARENT'S OWN MARKS ARE IGNORED, which is production's rule and easy to
     * get wrong: a question with sub-parts is worth the SUM of its sub-parts, so
     * this one is worth 3 and not the 10 written on it.
     */
    it('uses the sum of the sub-parts and ignores the parent marks', () => {
      const questions = [
        question({
          marks: 10,
          hasSubParts: true,
          subParts: [
            {
              label: 'a',
              subPartTitle: 'One',
              marks: 1,
              oneCorrectOption: true,
              options: [option('A', true), option('B', false)]
            },
            {
              label: 'b',
              subPartTitle: 'Two',
              marks: 2,
              oneCorrectOption: true,
              options: [option('C', false), option('D', true)]
            }
          ]
        })
      ];

      const marks = attemptMarks(questions, [answer({ subParts: [[0], [0]] })]);

      // Sub-part a right (1), sub-part b wrong (0), out of 3.
      expect(marks).toEqual({ studentScore: 1, maxScore: 3 });
    });

    /** A sub-part with no marks is worth 1, as production defaults it. */
    it('defaults a sub-part with no marks to one', () => {
      const questions = [
        question({
          hasSubParts: true,
          subParts: [
            {
              label: 'a',
              subPartTitle: 'One',
              marks: 0,
              oneCorrectOption: true,
              options: [option('A', true)]
            }
          ]
        })
      ];

      const marks = attemptMarks(questions, [answer({ subParts: [[0]] })]);

      expect(marks).toEqual({ studentScore: 1, maxScore: 1 });
    });
  });

  /** A question nobody touched must not throw — there is no answer entry for it. */
  it('survives a question with no answer recorded', () => {
    const questions = [
      question({ marks: 2, options: [option('A', true)] }),
      question({ questionType: 'TEXT', marks: 1 })
    ];

    expect(attemptMarks(questions, [])).toEqual({ studentScore: 0, maxScore: 3 });
  });
});

describe('stampAnswers', () => {

  /**
   * `attemptedOption` ON EVERY OPTION, which is production's stored shape and how
   * its report screens re-mark a submission without a separate answer sheet.
   * Verified on live data: its `attempts/attempt1` question 1 holds
   * `{name: ' It is safe', isCorrect: false, attemptedOption: true}`.
   */
  it('marks the chosen options and leaves the rest false', () => {
    const questions = [
      question({ options: [option('A', true), option('B', false), option('C', false)] })
    ];

    const stamped = stampAnswers(questions, [answer({ chosen: [2] })]);

    expect(
      (stamped[0].options ?? []).map(o => (o as { attemptedOption?: boolean }).attemptedOption)
    ).toEqual([false, false, true]);
  });

  /** THE `isCorrect` FLAGS SURVIVE, or the attempt could not be re-marked. */
  it('keeps the correct-answer flags', () => {
    const questions = [question({ options: [option('A', true), option('B', false)] })];

    const stamped = stampAnswers(questions, [answer({ chosen: [0] })]);

    expect((stamped[0].options ?? []).map(o => o.isCorrect)).toEqual([true, false]);
  });

  it('stamps sub-part options too', () => {
    const questions = [
      question({
        hasSubParts: true,
        subParts: [
          {
            label: 'a',
            subPartTitle: 'One',
            marks: 1,
            oneCorrectOption: true,
            options: [option('A', true), option('B', false)]
          }
        ]
      })
    ];

    const stamped = stampAnswers(questions, [answer({ subParts: [[1]] })]);

    expect(
      (stamped[0].subParts ?? [])[0].options.map(
        o => (o as { attemptedOption?: boolean }).attemptedOption
      )
    ).toEqual([false, true]);
  });

  it('carries a typed text answer through', () => {
    const questions = [question({ questionType: 'TEXT', marks: 1 })];

    const stamped = stampAnswers(questions, [answer({ text: 'because' })]);

    expect((stamped[0] as unknown as { text?: string }).text).toBe('because');
  });

  /**
   * NO `undefined` ANYWHERE, which is not a style point: Firestore refuses
   * `undefined` at any depth and the whole write fails. A question that carries no
   * options must not come back with `options: undefined`.
   */
  it('leaves no undefined in the stamped questions', () => {
    const questions = [
      question({ questionType: 'DESCRIPTIVE', marks: 1 }),
      question({ options: [option('A', true)] })
    ];

    const stamped = stampAnswers(questions, [answer(), answer({ chosen: [0] })]);

    expect(JSON.stringify(stamped)).not.toContain('undefined');
    stamped.forEach(entry =>
      Object.values(entry).forEach(value => expect(value).not.toBe(undefined))
    );
  });

  /** A question nobody answered still gets a stamped entry, all false. */
  it('stamps a question with no recorded answer', () => {
    const questions = [question({ options: [option('A', true), option('B', false)] })];

    const stamped = stampAnswers(questions, []);

    expect(
      (stamped[0].options ?? []).map(o => (o as { attemptedOption?: boolean }).attemptedOption)
    ).toEqual([false, false]);
  });
});

describe('the attempt cap', () => {

  /**
   * THREE, WHICH IS PRODUCTION'S FALLBACK — `numberOfAllowedSubmissions ?? 3`, and
   * it is doing real work: the field is present on only 36 of 81 quiz-like
   * assignment documents in the live database, so more than half of them get this.
   */
  it('defaults to production\'s three', () => {
    expect(DEFAULT_ALLOWED_SUBMISSIONS).toBe(3);
  });
});

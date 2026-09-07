import { ComponentFixture, TestBed } from '@angular/core/testing';
import { expect, vi } from 'vitest';

import { QuizOutcome, QuizPlayer, totalSeconds } from './quiz-player';
import { AssignmentOption, QuizAssignment, QuizQuestion } from '../../models/teaching.model';

/**
 * The quiz player.
 *
 * WHAT IS WORTH TESTING, and it is not the rail. Four things here are quiet when
 * wrong, and one of them would report a mark the reader did not earn:
 *
 *   1. SCORING IS EXACT SET EQUALITY on a multi-answer question. "Contains a
 *      correct option" would give full marks for ticking everything.
 *   2. ONLY WHAT CAN BE MARKED IS SCORED, and `scorable` says how much was in
 *      play — otherwise 2 out of 3 reads as 2 out of the whole quiz.
 *   3. THE DURATION COMES FROM THREE FIELDS, two of which are `number | string`
 *      and are stored EMPTY by production's wizard. A quiz with no duration must
 *      not open on a timer of zero, which would send the reader straight to Done.
 *   4. TIME UP GOES TO DONE, it does not submit for the reader.
 *
 * NOTHING IS RECORDED ANYWHERE. Submit emits an outcome and this suite asserts on
 * what it emits; there is no store to check because the app has no student records
 * to attach an attempt to.
 */

function option(name: string, isCorrect: boolean): AssignmentOption {
  return { name, isCorrect, optionType: 'TEXT', imagePath: '' };
}

function question(over: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    questionTitle: 'A question',
    questionType: 'MCQ',
    marks: 1,
    pedagogyType: 'FA',
    durationInHours: 0,
    durationInMinutes: 0,
    durationInSeconds: 0,
    ...over
  };
}

function quiz(questions: QuizQuestion[], duration?: Partial<QuizAssignment>): QuizAssignment {
  return {
    docId: 'a1',
    displayName: 'Bang Bang',
    type: 'QUIZ',
    totalDurationInHours: 0,
    totalDurationInMinutes: 5,
    totalDurationInSeconds: 0,
    questionsData: questions,
    ...duration
  } as unknown as QuizAssignment;
}

async function mount(assignment: QuizAssignment): Promise<{
  fixture: ComponentFixture<QuizPlayer>;
  component: QuizPlayer;
  outcomes: QuizOutcome[];
  closes: number;
}> {
  TestBed.configureTestingModule({ imports: [QuizPlayer] });

  const fixture = TestBed.createComponent(QuizPlayer);

  fixture.componentRef.setInput('quiz', assignment);
  fixture.detectChanges();
  await fixture.whenStable();

  const state = { fixture, component: fixture.componentInstance, outcomes: [] as QuizOutcome[], closes: 0 };

  state.component.submitted.subscribe(outcome => state.outcomes.push(outcome));
  state.component.closed.subscribe(() => (state.closes += 1));

  return state;
}

describe('QuizPlayer', () => {

  describe('answering', () => {

    /** A single-answer question REPLACES the choice rather than adding to it. */
    it('replaces the choice on a single-answer question', async () => {
      const { component } = await mount(
        quiz([question({ options: [option('A', true), option('B', false)] })])
      );

      component.choose(0);
      component.choose(1);

      expect(component.isChosen(0)).toBe(false);
      expect(component.isChosen(1)).toBe(true);
    });

    /**
     * A MULTI-ANSWER QUESTION TOGGLES. Production renders a checkbox when more
     * than one option is correct, so the control follows the question — and a
     * multi-answer question offered as radios cannot be answered at all.
     */
    it('toggles choices on a multi-answer question', async () => {
      const { component } = await mount(
        quiz([
          question({
            oneCorrectOption: false,
            options: [option('A', true), option('B', true), option('C', false)]
          })
        ])
      );

      component.choose(0);
      component.choose(1);

      expect(component.isChosen(0)).toBe(true);
      expect(component.isChosen(1)).toBe(true);

      component.choose(0);

      expect(component.isChosen(0)).toBe(false);
    });

    it('keeps answers per question', async () => {
      const { component } = await mount(
        quiz([
          question({ options: [option('A', true), option('B', false)] }),
          question({ questionType: 'TEXT' })
        ])
      );

      component.choose(1);
      component.next();
      component.setText('an answer');
      component.previous();

      expect(component.isChosen(1)).toBe(true);

      component.next();

      expect(component.textValue()).toBe('an answer');
    });

    /** THE RAIL MARKS WHAT HAS ANYTHING IN IT, whichever kind of question. */
    it('counts a question as answered for any kind of entry', async () => {
      const { component } = await mount(
        quiz([
          question({ options: [option('A', true)] }),
          question({ questionType: 'TEXT' }),
          question({ questionType: 'FILL_IN_THE_BLANKS', blanks: { one: [] } })
        ])
      );

      expect(component.answeredCount()).toBe(0);

      component.choose(0);
      component.goTo(1);
      component.setText('  ');
      expect(component.isAnswered(1)).toBe(false);

      component.setText('something');
      component.goTo(2);
      component.setBlank('one', 'filled');

      expect(component.answeredCount()).toBe(3);
    });
  });

  describe('navigation', () => {

    it('walks forward to the Done panel and back', async () => {
      const { component } = await mount(quiz([question(), question()]));

      expect(component.onDone()).toBe(false);

      component.next();
      component.next();

      expect(component.onDone()).toBe(true);

      component.previous();

      expect(component.onDone()).toBe(false);
      expect(component.index()).toBe(1);
    });

    /** EVERY CIRCLE IS REACHABLE — production's rail lets a reader go back. */
    it('jumps to any question', async () => {
      const { component } = await mount(quiz([question(), question(), question()]));

      component.goTo(2);

      expect(component.index()).toBe(2);
    });

    it('refuses an index outside the quiz', async () => {
      const { component } = await mount(quiz([question()]));

      component.goTo(-1);
      expect(component.index()).toBe(0);

      component.goTo(9);
      expect(component.index()).toBe(0);
    });
  });

  describe('scoring', () => {

    /*
     * EXACT SET EQUALITY, split across two tests because TestBed cannot be
     * reconfigured once a component has been created — one mount per `it`.
     *
     * This is the pair that would report a mark nobody earned: "contains a correct
     * option" gives full marks for ticking everything.
     */
    const multiAnswer = () =>
      quiz([
        question({
          marks: 4,
          oneCorrectOption: false,
          options: [option('A', true), option('B', true), option('C', false)]
        })
      ]);

    it('scores nothing when every option is ticked', async () => {
      const { component, outcomes } = await mount(multiAnswer());

      component.choose(0);
      component.choose(1);
      component.choose(2);
      component.submit();

      expect(outcomes[0].scored).toBe(0);
      expect(outcomes[0].scorable).toBe(4);
    });

    it('scores full marks for exactly the correct set', async () => {
      const { component, outcomes } = await mount(multiAnswer());

      component.choose(0);
      component.choose(1);
      component.submit();

      expect(outcomes[0].scored).toBe(4);
    });

    /**
     * ONLY WHAT CAN BE MARKED IS COUNTED, and `scorable` reports how much that
     * was — otherwise "2 of 3" reads as two marks out of the whole quiz.
     */
    it('scores only the questions it can mark', async () => {
      const { component, outcomes } = await mount(
        quiz([
          question({ marks: 2, options: [option('A', true), option('B', false)] }),
          question({ questionType: 'DESCRIPTIVE', marks: 5 }),
          question({ questionType: 'TEXT', marks: 3, answer: 'Delhi' })
        ])
      );

      component.choose(0);
      component.goTo(2);
      component.setText('  delhi  ');
      component.submit();

      const outcome = outcomes[0];

      // The descriptive question's 5 marks are not in play.
      expect(outcome.scorable).toBe(5);
      expect(outcome.scored).toBe(5);
      expect(outcome.total).toBe(3);
      expect(outcome.answered).toBe(2);
    });

    /** A TEXT question with no stored answer cannot be marked either way. */
    it('does not score a text question that has no answer', async () => {
      const { component, outcomes } = await mount(
        quiz([question({ questionType: 'TEXT', marks: 3 })])
      );

      component.setText('anything');
      component.submit();

      expect(outcomes[0].scorable).toBe(0);
      expect(outcomes[0].scored).toBe(0);
    });

    /**
     * AN MCQ WITH NO CORRECT OPTION IS NOT MARKABLE — its marks are not in play.
     *
     * THIS TEST ASSERTED THE OPPOSITE and the difference was a real complaint: a
     * quiz whose author had ticked no answers reported "0 of 5 marks", which reads
     * as "you got everything wrong" rather than "nothing here could be marked".
     * Counting those marks as available was what made the two indistinguishable.
     */
    it('does not put an unmarkable MCQ’s marks in play', async () => {
      const { component, outcomes } = await mount(
        quiz([question({ marks: 2, options: [option('A', false), option('B', false)] })])
      );

      component.choose(0);
      component.submit();

      expect(outcomes[0].scored).toBe(0);
      expect(outcomes[0].scorable).toBe(0);
      expect(outcomes[0].markable).toBe(0);
      // The question was still ANSWERED — that is a separate count.
      expect(outcomes[0].answered).toBe(1);
    });

    /**
     * THE WHOLE-QUIZ CASE, which is the one that was reported: five questions, all
     * answered, none with a correct answer set. `markable: 0` is what lets the
     * panel say why there is no score instead of showing a score of nought.
     */
    it('reports nothing markable when no question has an answer set', async () => {
      const { component, outcomes } = await mount(
        quiz([
          question({ marks: 1, options: [option('A', false), option('B', false)] }),
          question({ marks: 1, options: [option('C', false), option('D', false)] })
        ])
      );

      component.choose(0);
      component.goTo(1);
      component.choose(1);
      component.submit();

      expect(outcomes[0]).toMatchObject({
        answered: 2,
        total: 2,
        scored: 0,
        scorable: 0,
        markable: 0
      });

      /*
       * AND PRODUCTION'S OWN PAIR SAYS SOMETHING DIFFERENT, which is the whole
       * point of carrying both. `maxScore` counts every question's marks whether
       * it can be marked or not, so this quiz is 0 out of 2 by production's
       * arithmetic and 0 out of 0 by the panel's. The panel shows the second and
       * explains it; the attempt document stores the first, because that is what
       * production's report screens read.
       */
      expect(outcomes[0].studentScore).toBe(0);
      expect(outcomes[0].maxScore).toBe(2);
    });

    /** And a mixed quiz reports how many of its questions could be marked. */
    it('counts the markable questions', async () => {
      const { component, outcomes } = await mount(
        quiz([
          question({ marks: 1, options: [option('A', true), option('B', false)] }),
          question({ marks: 1, options: [option('C', false), option('D', false)] }),
          question({ questionType: 'DESCRIPTIVE', marks: 5 }),
          question({ questionType: 'TEXT', marks: 2, answer: 'Delhi' })
        ])
      );

      component.submit();

      expect(outcomes[0].markable).toBe(2);
      expect(outcomes[0].scorable).toBe(3);
      expect(outcomes[0].total).toBe(4);
    });

    it('reports the outcome and keeps it for the panel', async () => {
      const { component } = await mount(quiz([question({ options: [option('A', true)] })]));

      component.submit();

      expect(component.outcome()).not.toBeNull();
    });
  });

  describe('the timer', () => {

    /**
     * THE DURATION IS THE QUIZ'S TOTAL, from three fields — two of which
     * production's wizard leaves as the EMPTY STRING rather than zero.
     */
    it('reads the duration from all three fields', () => {
      expect(
        totalSeconds({
          totalDurationInHours: 1,
          totalDurationInMinutes: 2,
          totalDurationInSeconds: 3
        } as unknown as QuizAssignment)
      ).toBe(3723);
    });

    it('copes with the empty strings the wizard stores', () => {
      expect(
        totalSeconds({
          totalDurationInHours: 0,
          totalDurationInMinutes: 10,
          totalDurationInSeconds: ''
        } as unknown as QuizAssignment)
      ).toBe(600);
    });

    /**
     * A QUIZ WITH NO DURATION GETS TEN MINUTES, not zero. Zero would send the
     * reader to the Done panel before they saw question one.
     */
    it('falls back to ten minutes when there is no duration', () => {
      expect(totalSeconds({} as unknown as QuizAssignment)).toBe(600);
      expect(
        totalSeconds({
          totalDurationInHours: 0,
          totalDurationInMinutes: 0,
          totalDurationInSeconds: 0
        } as unknown as QuizAssignment)
      ).toBe(600);
    });

    it('opens on the quiz’s duration, formatted mm:ss', async () => {
      const { component } = await mount(
        quiz([question()], { totalDurationInMinutes: 2, totalDurationInSeconds: 5 })
      );

      expect(component.remaining()).toBe(125);
      expect(component.clock()).toBe('02:05');
    });

    /**
     * TIME UP GOES TO DONE, IT DOES NOT SUBMIT. Submitting for the reader takes
     * the decision away at the moment they are least able to react, and
     * production's Done panel is a stop rather than a send.
     */
    it('moves to Done when the time runs out, without submitting', async () => {
      vi.useFakeTimers();

      try {
        const { component, outcomes } = await mount(
          quiz([question(), question()], {
            totalDurationInHours: 0,
            totalDurationInMinutes: 0,
            totalDurationInSeconds: 2
          })
        );

        expect(component.remaining()).toBe(2);

        vi.advanceTimersByTime(2000);

        expect(component.remaining()).toBe(0);
        expect(component.onDone()).toBe(true);
        expect(outcomes).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    /** Under a minute the clock warns. */
    it('flags the last minute', async () => {
      const { component } = await mount(
        quiz([question()], {
          totalDurationInHours: 0,
          totalDurationInMinutes: 0,
          totalDurationInSeconds: 45
        })
      );

      expect(component.runningOut()).toBe(true);
    });

    /**
     * THE INTERVAL IS CLEARED ON DESTROY. A timer left running keeps ticking a
     * signal nothing reads, which in a zoneless app is a render every second for
     * the life of the tab.
     */
    it('stops ticking once destroyed', async () => {
      vi.useFakeTimers();

      try {
        const { fixture, component } = await mount(
          quiz([question()], {
            totalDurationInHours: 0,
            totalDurationInMinutes: 5,
            totalDurationInSeconds: 0
          })
        );

        vi.advanceTimersByTime(2000);

        const afterTwo = component.remaining();

        fixture.destroy();
        vi.advanceTimersByTime(5000);

        expect(component.remaining()).toBe(afterTwo);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('asks the caller to close', async () => {
    const state = await mount(quiz([question()]));

    state.component.close();

    expect(state.closes).toBe(1);
  });

  it('copes with a quiz that has no questions', async () => {
    const { component } = await mount(quiz([]));

    expect(component.questions()).toEqual([]);
    expect(component.onDone()).toBe(true);
  });
});

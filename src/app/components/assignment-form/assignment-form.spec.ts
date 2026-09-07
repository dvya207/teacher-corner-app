import { ComponentRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AssignmentForm, FormOutcome } from './assignment-form';
import { ConfigurationService } from '../../services/configuration.service';
import { FormQuestion } from '../../models/teaching.model';

/**
 * A FORM assignment inside a workflow step.
 *
 * WHAT IS WORTH TESTING HERE, and why each of these is a rule rather than a
 * preference:
 *
 *   - ANSWERS UNLOCK IN ORDER. Production disables every field until the one
 *     before it is answered. It is easy to mistake for a bug and delete.
 *   - AND AN UNANSWERABLE QUESTION MUST NOT BLOCK. A `none` heading or a dropdown
 *     with no resolvable options has nothing to fill in, and in production either
 *     one dead-ends the rest of the form. That is the one place this deliberately
 *     departs, so it is pinned.
 *   - THE PREFILL MATCHES BY `questionNumber`, NOT BY POSITION. A form has no
 *     version history — production's `versions` block for forms is commented out
 *     — so resubmitting overwrites, and attaching one question's old answer to
 *     another would silently destroy the real one.
 *   - THE RECORD KEEPS EVERY QUESTION, answered or not, and a star rating's answer
 *     is a NUMBER. Both were read off a live submission.
 */

function question(overrides: Partial<FormQuestion> = {}): FormQuestion {
  return {
    questionType: 'text',
    questionNumber: 1,
    question: 'How did it go?',
    prompt: '',
    isSubquestion: false,
    dropDownOptions: '',
    dropDownOptionsDynamic: '',
    dropDownOptionsDependent: '',
    fieldIcon: '',
    ...overrides
  };
}

interface Mounted {
  component: AssignmentForm;
  reference: ComponentRef<AssignmentForm>;
  outcomes: FormOutcome[];
  /**
   * Applies a changed input and runs the effects it triggers.
   *
   * NEEDED BECAUSE THE CLEAR IS AN EFFECT. `setInput` alone marks the component
   * dirty and returns; the effect that empties the form does not run until a
   * change-detection pass. In the app that pass is the next frame, which is why
   * this is a test-harness detail and not a behaviour difference.
   */
  setInput: (name: string, value: unknown) => void;
}

function mount(questions: FormQuestion[]): Mounted {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: ConfigurationService,
        useValue: { dynamicOptions: () => ['Alpha', 'Beta'] }
      }
    ]
  });

  const fixture = TestBed.createComponent(AssignmentForm);

  fixture.componentRef.setInput('questions', questions);
  fixture.detectChanges();

  const outcomes: FormOutcome[] = [];

  fixture.componentInstance.submitted.subscribe(outcome => outcomes.push(outcome));

  return {
    component: fixture.componentInstance,
    reference: fixture.componentRef,
    outcomes,
    setInput: (name, value) => {
      fixture.componentRef.setInput(name, value);
      fixture.detectChanges();
    }
  };
}

describe('AssignmentForm', () => {

  describe('the question label', () => {

    /** 'Question 3:' for a question, bare '3:' for a subquestion. */
    it('names a question and numbers a subquestion', () => {
      const { component } = mount([question()]);

      expect(component.label(question({ questionNumber: 3 }))).toBe('Question 3:');
      expect(
        component.label(question({ questionNumber: 3, isSubquestion: true }))
      ).toBe('3:');
    });

    /**
     * THE NUMBER COMES FROM THE QUESTION, NOT FROM THE LOOP. Production's live
     * Feedback Form stores `questionNumber` on every question, and a subquestion's
     * numbering is what makes it read as nested — renumbering from the array index
     * would flatten that.
     */
    it('uses the stored number rather than the position', () => {
      const { component } = mount([question({ questionNumber: 7 })]);

      expect(component.label(component.questions()[0])).toBe('Question 7:');
    });
  });

  describe('the placeholder', () => {

    /**
     * THE QUESTION'S OWN `prompt`. It looks like dead data — all 209 questions in
     * this app's collection store '' — but production's live form uses it on three
     * of five questions as an example answer: 'Enjoyed the Story the most'.
     */
    it('is the prompt when there is one', () => {
      const { component } = mount([question({ prompt: '60 minutes' })]);

      expect(component.placeholder(component.questions()[0])).toBe('60 minutes');
    });

    /** PRODUCTION'S LITERAL DEFAULT, which its own records carry. */
    it('falls back to production\'s default', () => {
      const { component } = mount([question({ prompt: '   ' })]);

      expect(component.placeholder(component.questions()[0])).toBe(
        'Enter the answer here'
      );
    });
  });

  describe('answering in order', () => {

    it('opens the first question', () => {
      const { component } = mount([
        question({ questionNumber: 1 }),
        question({ questionNumber: 2 })
      ]);

      expect(component.isOpen(0)).toBe(true);
    });

    /** PRODUCTION'S RULE: every field after the first starts locked. */
    it('locks the second until the first is answered', () => {
      const { component } = mount([
        question({ questionNumber: 1 }),
        question({ questionNumber: 2 })
      ]);

      expect(component.isOpen(1)).toBe(false);

      component.set(0, 'because');

      expect(component.isOpen(1)).toBe(true);
    });

    /** Blank space is not an answer, so it does not unlock the next field. */
    it('does not count whitespace as an answer', () => {
      const { component } = mount([question(), question({ questionNumber: 2 })]);

      component.set(0, '    ');

      expect(component.isOpen(1)).toBe(false);
    });

    /**
     * A `none` QUESTION IS A HEADING AND MUST NOT BLOCK — production's own label
     * for the type is "Display Only". In production a heading part-way down a form
     * seals everything after it, because the next field waits on an answer nobody
     * can give. This is the deliberate departure.
     */
    it('lets a display-only question pass the unlock through', () => {
      const { component } = mount([
        question({ questionNumber: 1, questionType: 'none' }),
        question({ questionNumber: 2 })
      ]);

      expect(component.isOpen(1)).toBe(true);
    });

    /** And the same for a dropdown whose options could not be resolved. */
    it('lets an unresolvable dropdown pass the unlock through', () => {
      const { component } = mount([
        question({
          questionNumber: 1,
          questionType: 'dropDownDependent',
          dropDownOptionsDependent: 'SomeDoc,someMap,someKey'
        }),
        question({ questionNumber: 2 })
      ]);

      expect(component.canAnswer(component.questions()[0])).toBe(false);
      expect(component.isUnresolvedDropdown(component.questions()[0])).toBe(true);
      expect(component.isOpen(1)).toBe(true);
    });

    /** IT SKIPS PAST a heading to the real question before it, not around it. */
    it('waits on the nearest answerable question, not the nearest one', () => {
      const { component } = mount([
        question({ questionNumber: 1 }),
        question({ questionNumber: 2, questionType: 'none' }),
        question({ questionNumber: 3 })
      ]);

      expect(component.isOpen(2)).toBe(false);

      component.set(0, 'answered');

      expect(component.isOpen(2)).toBe(true);
    });

    /** A star rating counts as answered only once a star is actually chosen. */
    it('treats a zero rating as unanswered', () => {
      const { component } = mount([
        question({ questionNumber: 1, questionType: 'starRating' }),
        question({ questionNumber: 2 })
      ]);

      component.set(0, 0);
      expect(component.isOpen(1)).toBe(false);

      component.set(0, 4);
      expect(component.isOpen(1)).toBe(true);
    });
  });

  describe('the checkBoxGroup type', () => {

    /*
     * THIS APP'S OWN TYPE, and the only form question whose answer is a LIST.
     * Every assertion here is about that difference: what counts as answered,
     * what order the picks are stored in, and what reaches the record.
     */

    const multi = () =>
      question({
        questionType: 'checkBoxGroup',
        dropDownOptions: 'Time, Materials , Noise'
      });

    it('reads its options from dropDownOptions, like a plain dropdown', () => {
      const { component } = mount([multi()]);

      expect(component.options(multi())).toEqual(['Time', 'Materials', 'Noise']);
    });

    it('is unanswered until a box is ticked', () => {
      const { component } = mount([multi()]);

      expect(component.hasAnswer(0)).toBe(false);

      component.toggle(0, 'Noise', true);

      expect(component.hasAnswer(0)).toBe(true);
    });

    /* Unticking the last box returns the question to unanswered, which is what
       locks the questions after it again. An empty array is not an answer. */
    it('is unanswered again once every box is cleared', () => {
      const { component } = mount([multi()]);

      component.toggle(0, 'Noise', true);
      component.toggle(0, 'Noise', false);

      expect(component.chosen(0)).toEqual([]);
      expect(component.hasAnswer(0)).toBe(false);
    });

    /*
     * STORED IN THE QUESTION'S ORDER, NOT IN TICK ORDER. Two teachers who pick
     * the same boxes must store the same array, or a report comparing answers
     * would treat one order as different data from the other.
     */
    it('stores the picks in the order the question asks them', () => {
      const { component } = mount([multi()]);

      component.toggle(0, 'Noise', true);
      component.toggle(0, 'Time', true);

      expect(component.chosen(0)).toEqual(['Time', 'Noise']);
    });

    it('ticking the same box twice does not double it', () => {
      const { component } = mount([multi()]);

      component.toggle(0, 'Time', true);
      component.toggle(0, 'Time', true);

      expect(component.chosen(0)).toEqual(['Time']);
    });

    /* `value()` feeds text inputs. An array reaching one would render 'a,b' in a
       box, so it is deliberately blank for this type. */
    it('reports no single value, so no text field can render the array', () => {
      const { component } = mount([multi()]);

      component.toggle(0, 'Time', true);

      expect(component.value(0)).toBe('');
    });

    it('submits the array itself', () => {
      const { component, outcomes } = mount([multi()]);

      component.toggle(0, 'Materials', true);
      component.toggle(0, 'Time', true);
      component.submit();

      expect(outcomes[0].questions[0].answer).toEqual(['Time', 'Materials']);
      expect(outcomes[0].answered).toBe(1);
    });

    /* Same rule as an unresolvable dropdown: a group with no boxes has nothing
       to pick, so it must not seal the questions after it. */
    it('with no options, passes the unlock through', () => {
      const { component } = mount([
        question({ questionType: 'checkBoxGroup', dropDownOptions: '' }),
        question({ questionNumber: 2 })
      ]);

      expect(component.canAnswer(
        question({ questionType: 'checkBoxGroup', dropDownOptions: '' })
      )).toBe(false);
      expect(component.isOpen(1)).toBe(true);
    });
  });

  describe('the radioGroup type', () => {

    /*
     * ANSWERED EXACTLY LIKE A DROPDOWN, a single string, and that is the point of
     * these tests: it shares the checkbox group's option field and its markup but
     * none of its answer handling.
     */

    const radio = () =>
      question({
        questionType: 'radioGroup',
        dropDownOptions: ['Yes', 'No', 'Only partly, we ran out of time']
      });

    it('reads its options from the stored array', () => {
      const { component } = mount([radio()]);

      expect(component.options(radio()))
        .toEqual(['Yes', 'No', 'Only partly, we ran out of time']);
    });

    it('is unanswered until one is picked', () => {
      const { component } = mount([radio()]);

      expect(component.hasAnswer(0)).toBe(false);

      component.set(0, 'No');

      expect(component.hasAnswer(0)).toBe(true);
    });

    /* A SINGLE STRING, so picking again REPLACES rather than accumulating. This
       is the difference from the checkbox group, which would hold both. */
    it('picking a second option replaces the first', () => {
      const { component } = mount([radio()]);

      component.set(0, 'Yes');
      component.set(0, 'No');

      expect(component.value(0)).toBe('No');
    });

    it('submits the picked option as a string, not an array', () => {
      const { component, outcomes } = mount([radio()]);

      component.set(0, 'Only partly, we ran out of time');
      component.submit();

      expect(outcomes[0].questions[0].answer)
        .toBe('Only partly, we ran out of time');
      expect(outcomes[0].answered).toBe(1);
    });

    /* An option holding a comma survives, which is the reason these types store
       an array rather than a joined string. */
    it('keeps an option containing a comma whole', () => {
      const { component } = mount([radio()]);

      expect(component.options(radio())[2])
        .toBe('Only partly, we ran out of time');
    });

    it('with no options, passes the unlock through', () => {
      const empty = question({ questionType: 'radioGroup', dropDownOptions: [] });
      const { component } = mount([empty, question({ questionNumber: 2 })]);

      expect(component.canAnswer(empty)).toBe(false);
      expect(component.isOpen(1)).toBe(true);
    });
  });

  describe('the dropdown variants', () => {

    /** A LITERAL LIST, split on commas and trimmed. */
    it('splits a plain dropdown\'s own options', () => {
      const { component } = mount([
        question({ questionType: 'dropDown', dropDownOptions: 'Yes, No , Maybe' })
      ]);

      expect(component.options(component.questions()[0])).toEqual([
        'Yes',
        'No',
        'Maybe'
      ]);
    });

    /** A trailing comma must not become a blank option that answers nothing. */
    it('drops empty entries', () => {
      const { component } = mount([
        question({ questionType: 'dropDown', dropDownOptions: 'Yes,No,' })
      ]);

      expect(component.options(component.questions()[0])).toEqual(['Yes', 'No']);
    });

    /**
     * A DYNAMIC DROPDOWN NAMES A CONFIGURATION DOCUMENT AND FIELD, not options:
     * 'RYSI_Categories,subjects'. Resolved, which production's workflow form does
     * NOT do — its resolving pass is commented out, so it renders an empty select.
     */
    it('resolves a dynamic dropdown through Configuration', () => {
      const { component } = mount([
        question({
          questionType: 'dropDownDynamic',
          dropDownOptionsDynamic: 'RYSI_Categories,subjects'
        })
      ]);

      expect(component.options(component.questions()[0])).toEqual(['Alpha', 'Beta']);
    });

    /** A dynamic field naming only half of what it needs resolves to nothing. */
    it('resolves nothing from an incomplete reference', () => {
      const { component } = mount([
        question({
          questionType: 'dropDownDynamic',
          dropDownOptionsDynamic: 'RYSI_Categories'
        })
      ]);

      expect(component.options(component.questions()[0])).toEqual([]);
    });
  });

  /*
   * THE PREFILL TESTS WERE HERE, and they went with the prefill itself. The form
   * matched production and opened showing the stored submission; on instruction it
   * now opens EMPTY every time. What that removed is worth remembering: a reader
   * who submitted over a prefill was overwriting answers the fields had supplied,
   * and a form keeps no version history to get them back from.
   */

  describe('emptying the form after a successful submission', () => {

    /**
     * ON INSTRUCTION, AND A DEPARTURE FROM PRODUCTION, whose form stays filled
     * after submitting. Pinned because the two halves fight each other: the form
     * also PREFILLS from the stored submission, so the parent has to clear its
     * stored copy in the same breath as bumping this counter, or every field
     * refills the instant it empties.
     */
    it('empties the fields when the counter changes', () => {
      const { component, setInput } = mount([
        question({ questionNumber: 1 }),
        question({ questionNumber: 2 })
      ]);

      component.set(0, 'first');
      component.set(1, 'second');

      setInput('clearedAt', 1);

      expect(component.value(0)).toBe('');
      expect(component.value(1)).toBe('');
    });

    /** AND THE UNLOCK RESETS WITH IT, so the emptied form starts from question 1. */
    it('re-locks the later questions', () => {
      const { component, setInput } = mount([
        question({ questionNumber: 1 }),
        question({ questionNumber: 2 })
      ]);

      component.set(0, 'first');
      expect(component.isOpen(1)).toBe(true);

      setInput('clearedAt', 1);

      expect(component.isOpen(1)).toBe(false);
    });

    /**
     * A COUNTER, NOT A FLAG, and this is the test that proves why: a boolean
     * flipped to true stays true, so the SECOND submission would clear nothing.
     */
    it('empties again on a second submission', () => {
      const { component, setInput } = mount([question({ questionNumber: 1 })]);

      component.set(0, 'first');
      setInput('clearedAt', 1);
      expect(component.value(0)).toBe('');

      component.set(0, 'second');
      setInput('clearedAt', 2);

      expect(component.value(0)).toBe('');
    });

  });

  describe('what submit reports', () => {

    /**
     * EVERY QUESTION, ANSWERED OR NOT, which is production's: its live submission
     * carries a fifth question with `answer: ''`. A record holding only the
     * answered ones could not be told apart from a shorter form.
     */
    it('includes an unanswered question', () => {
      const { component, outcomes } = mount([
        question({ questionNumber: 1 }),
        question({ questionNumber: 2 })
      ]);

      component.set(0, 'first');
      component.submit();

      expect(outcomes[0].questions).toHaveLength(2);
      expect(outcomes[0].questions[1].answer).toBe('');
    });

    /** A STAR RATING'S ANSWER IS A NUMBER, as the live record stores it. */
    it('reports a rating as a number', () => {
      const { component, outcomes } = mount([
        question({ questionNumber: 1, questionType: 'starRating' })
      ]);

      component.set(0, 5);
      component.submit();

      expect(outcomes[0].questions[0].answer).toBe(5);
      expect(typeof outcomes[0].questions[0].answer).toBe('number');
    });

    /**
     * `fieldIcon` IS `null` RATHER THAN '' WHERE THERE IS NONE, matching the live
     * records — and it cannot simply be left out, because Firestore refuses
     * `undefined` at any depth and would reject the whole write.
     */
    it('writes a null field icon rather than undefined', () => {
      const { component, outcomes } = mount([question({ fieldIcon: '' })]);

      component.submit();

      expect(outcomes[0].questions[0].fieldIcon).toBeNull();
      expect(JSON.stringify(outcomes[0])).not.toContain('undefined');
    });

    /** `dropDownOptions` IS AN ARRAY in the record, a string on the assignment. */
    it('reports the options as an array', () => {
      const { component, outcomes } = mount([
        question({ questionType: 'dropDown', dropDownOptions: 'Yes,No' }),
        question({ questionNumber: 2 })
      ]);

      component.submit();

      expect(outcomes[0].questions[0].dropDownOptions).toEqual(['Yes', 'No']);
      // AND `[]` FOR A NON-DROPDOWN, which is what its live records hold.
      expect(outcomes[0].questions[1].dropDownOptions).toEqual([]);
    });

    /** THE PROMPT AS SHOWN, so the record says what the reader was prompted with. */
    it('reports the prompt that was displayed', () => {
      const { component, outcomes } = mount([
        question({ questionNumber: 1, prompt: '60 minutes' }),
        question({ questionNumber: 2, prompt: '' })
      ]);

      component.submit();

      expect(outcomes[0].questions[0].prompt).toBe('60 minutes');
      expect(outcomes[0].questions[1].prompt).toBe('Enter the answer here');
    });

    /** The counts exclude headings, which are not questions to answer. */
    it('counts only the answerable questions', () => {
      const { component, outcomes } = mount([
        question({ questionNumber: 1, questionType: 'none' }),
        question({ questionNumber: 2 }),
        question({ questionNumber: 3 })
      ]);

      component.set(1, 'yes');
      component.submit();

      expect(outcomes[0].total).toBe(2);
      expect(outcomes[0].answered).toBe(1);
      // The heading is still in the record.
      expect(outcomes[0].questions).toHaveLength(3);
    });
  });
});

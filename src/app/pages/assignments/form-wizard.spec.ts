import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FormAssignment, FormQuestion } from '../../models/teaching.model';
import { AuthService } from '../../services/auth.service';
import { FORM_STEPS, FormWizard } from './form-wizard';

/**
 * Create Form Assignment — the three-step wizard.
 *
 * WHAT IS WORTH TESTING HERE, and it is not the markup. Five things in this
 * component are quiet when wrong, and each produces a document that looks saved:
 *
 *   1. THE NINE KEYS. Every question production stores carries all nine, whatever
 *      its type — a `text` question still has the three dropDown fields as empty
 *      strings. A narrower document is one nothing else has, and `undefined` on
 *      any of them fails the whole write.
 *   2. THE THREE DROPDOWN FIELDS ARE NOT INTERCHANGEABLE. dropDown writes
 *      `dropDownOptions`, dropDownDynamic writes `dropDownOptionsDynamic`, and
 *      dropDownDependent writes `dropDownOptionsDependent`. Crossing them wires a
 *      question to the wrong source.
 *   3. `questionType` IS LOWERCASE. A quiz question's is uppercase ('MCQ'), a
 *      form's is camelCase ('dropDownDependent'), and the player matches the
 *      stored string.
 *   4. `questionNumber` IS POSITIONAL, so reordering and removing have to
 *      renumber or two questions claim the same place.
 *   5. THE EDIT PREFILL COPIES. The questions arrive on a signal input and are the
 *      rows the table is rendering.
 */

class StubAuthService {
  displayName(): string {
    return 'Santosh Kanta';
  }
}

/** The nine keys production writes on every form question. */
const QUESTION_KEYS = [
  'questionType',
  'questionNumber',
  'question',
  'prompt',
  'isSubquestion',
  'dropDownOptions',
  'dropDownOptionsDynamic',
  'dropDownOptionsDependent',
  'fieldIcon'
];

async function mount(existing: FormAssignment | null = null): Promise<{
  fixture: ComponentFixture<FormWizard>;
  component: FormWizard;
  saved: FormAssignment[];
}> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [FormWizard],
    providers: [{ provide: AuthService, useValue: new StubAuthService() }]
  }).compileComponents();

  const fixture = TestBed.createComponent(FormWizard);
  const component = fixture.componentInstance;
  const saved: FormAssignment[] = [];

  fixture.componentRef.setInput('assignment', existing);
  component.submitted.subscribe(draft => saved.push(draft as FormAssignment));
  fixture.detectChanges();

  return { fixture, component, saved };
}

function fillBasics(component: FormWizard): void {
  component.displayName.set('Deogiri Reflection - Day 2');
  component.author.set('Aashray Millindar');
  component.status.set('LIVE');
}

/** Fills the two fields a question needs before step two will pass. */
function fillQuestion(
  component: FormWizard,
  index: number,
  text: string,
  type = 'text'
): void {
  component.setQuestionText(index, text);
  component.setQuestionType(index, type);
}

/** A stored form, shaped like a real production document. */
function storedForm(overrides: Partial<FormAssignment> = {}): FormAssignment {
  return {
    docId: 'f1',
    displayName: 'Innovation submission',
    type: 'FORM',
    status: 'LIVE',
    creator: 'Chandra',
    author: 'Chandra',
    ownerId: 'uid',
    createdAt: null,
    updatedAt: null,
    instructions: 'Please answer all the questions in the fields provided below',
    questions: [
      {
        questionType: 'dropDownDynamic',
        questionNumber: 1,
        question: 'Select the subject below',
        prompt: '',
        isSubquestion: false,
        dropDownOptions: '',
        dropDownOptionsDynamic: 'RYSI_Categories,subjects',
        dropDownOptionsDependent: '',
        fieldIcon: 'subject'
      }
    ],
    ...overrides
  } as FormAssignment;
}

/** Walks a value tree for `undefined` at any depth. Firestore rejects all of them. */
function findUndefined(value: unknown, path = '$'): string[] {
  if (value === undefined) {
    return [path];
  }

  if (value === null || typeof value !== 'object') {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findUndefined(entry, `${path}[${index}]`));
  }

  return Object.entries(value).flatMap(([key, entry]) =>
    findUndefined(entry, `${path}.${key}`)
  );
}

describe('FormWizard', () => {

  it('opens on step one with one question', async () => {
    const { component } = await mount();

    expect(component.step()).toBe(1);
    expect(component.questions().length).toBe(1);
    expect(FORM_STEPS.length).toBe(3);
  });

  /** Production's step 2 prefills this exact sentence. */
  it('prefills the instructions sentence', async () => {
    const { component } = await mount();

    expect(component.instructions())
      .toBe('Please answer all the questions in the fields provided below');
  });

  it('takes the creator from the signed-in user', async () => {
    const { component } = await mount();

    expect(component.creator()).toBe('Santosh Kanta');
  });

  /** An edit keeps the ORIGINAL creator: it records who made the assignment. */
  it('keeps the stored creator when editing', async () => {
    const { component } = await mount(storedForm());

    expect(component.creator()).toBe('Chandra');
  });

  describe('navigation', () => {

    it('will not advance past step one until the required fields are filled', async () => {
      const { component } = await mount();

      expect(component.continueBlocked()).toBe(true);

      component.next();
      expect(component.step()).toBe(1);

      fillBasics(component);
      expect(component.continueBlocked()).toBe(false);

      component.next();
      expect(component.step()).toBe(2);
    });

    /** Status opens unselected, and that alone must block Next. */
    it('blocks step one while the status is unselected', async () => {
      const { component } = await mount();

      component.displayName.set('A');
      component.author.set('B');
      expect(component.continueBlocked()).toBe(true);

      component.status.set('LIVE');
      expect(component.continueBlocked()).toBe(false);
    });

    /**
     * A TYPE IS REQUIRED, not just text. A question stored with an empty type is
     * one production's player cannot render — it appears as a labelled gap.
     */
    it('blocks step two until every question has text and a type', async () => {
      const { component } = await mount();

      fillBasics(component);
      component.next();

      expect(component.continueBlocked()).toBe(true);

      component.setQuestionText(0, 'What materials did you need?');
      expect(component.continueBlocked()).toBe(true);

      component.setQuestionType(0, 'text');
      expect(component.continueBlocked()).toBe(false);

      component.addQuestion();
      expect(component.continueBlocked()).toBe(true);
    });
  });

  describe('the blocked reason', () => {

    it('names the question and what it wants', async () => {
      const { component } = await mount();

      fillBasics(component);
      component.next();

      expect(component.blockedReason()).toBe('Question 1 needs its text and a type.');

      component.setQuestionText(0, 'Anything?');
      expect(component.blockedReason()).toBe('Question 1 needs a type.');

      component.setQuestionType(0, 'text');
      expect(component.blockedReason()).toBe('');
    });

    it('counts the others when more than one is unfinished', async () => {
      const { component } = await mount();

      fillBasics(component);
      component.next();
      component.addQuestion();
      component.addQuestion();

      expect(component.alsoIncomplete()).toBe(2);
    });

    it('says nothing on the other steps', async () => {
      const { component } = await mount();

      expect(component.blockedReason()).toBe('');
    });
  });

  describe('the questions', () => {

    it('adds and numbers a question', async () => {
      const { component } = await mount();

      component.addQuestion();

      expect(component.questions().length).toBe(2);
      expect(component.questions()[1].questionNumber).toBe(2);
    });

    /** `questionNumber` is positional; a gap would misnumber every later one. */
    it('renumbers after a removal', async () => {
      const { component } = await mount();

      fillQuestion(component, 0, 'first');
      component.addQuestion();
      fillQuestion(component, 1, 'second');
      component.addQuestion();
      fillQuestion(component, 2, 'third');

      component.removeQuestion(1);

      expect(component.questions().map(q => q.question)).toEqual(['first', 'third']);
      expect(component.questions().map(q => q.questionNumber)).toEqual([1, 2]);
    });

    it('refuses to remove the last question', async () => {
      const { component } = await mount();

      component.removeQuestion(0);

      expect(component.questions().length).toBe(1);
    });

    it('moves a question up and down, renumbering as it goes', async () => {
      const { component } = await mount();

      fillQuestion(component, 0, 'first');
      component.addQuestion();
      fillQuestion(component, 1, 'second');

      component.moveQuestion(1, -1);

      expect(component.questions().map(q => q.question)).toEqual(['second', 'first']);
      expect(component.questions().map(q => q.questionNumber)).toEqual([1, 2]);

      component.moveQuestion(0, 1);
      expect(component.questions().map(q => q.question)).toEqual(['first', 'second']);
    });

    it('will not move past either end', async () => {
      const { component } = await mount();

      component.addQuestion();

      expect(component.canMoveUp(0)).toBe(false);
      expect(component.canMoveDown(1)).toBe(false);

      component.moveQuestion(0, -1);
      component.moveQuestion(1, 1);

      expect(component.questions().length).toBe(2);
    });

    /**
     * REPLACED, NOT MUTATED. The template reads `questions()`, and an assignment
     * into the stored object is a change the signal never announces — under
     * zoneless change detection the edit simply would not appear.
     */
    it('replaces the question object on every edit', async () => {
      const { component } = await mount();

      const before = component.questions()[0];
      component.setQuestionText(0, 'changed');

      expect(component.questions()[0]).not.toBe(before);
      expect(before.question).toBe('');
    });
  });

  /**
   * THE PER-TYPE FIELD, read off production's own template rather than inferred:
   * four of the seven types get one, and each writes a different key.
   */
  describe('the checkBoxGroup option rows', () => {

    /*
     * AUTHORED AS ROWS, STORED AS AN ARRAY, which is the whole difference from
     * `dropDown`. It shares the `dropDownOptions` field and nothing else about
     * how that field is edited or written.
     */

    /* BOTH ROW TYPES, one editor. Whether one option may be picked or several is
       decided when the form is ANSWERED, so there is nothing for the author to
       do differently and no reason for two editors. */
    it('uses rows rather than the comma text field, for both row types', async () => {
      const { component } = await mount();

      for (const type of ['checkBoxGroup', 'radioGroup']) {
        component.setQuestionType(0, type);
        const question = component.questions()[0];

        expect(component.usesOptionRows(question)).toBe(true);
        // The comma box is dropDown's alone; two editors for one field.
        expect(component.needsOptions(question)).toBe(false);
      }
    });

    it('authors a radioGroup through the same rows', async () => {
      const { component } = await mount();

      component.setQuestionType(0, 'radioGroup');
      component.setOptionAt(0, 0, 'Yes');
      component.addOption(0);
      component.setOptionAt(0, 1, 'Only partly, we ran out of time');

      expect(component.optionRows(component.questions()[0]))
        .toEqual(['Yes', 'Only partly, we ran out of time']);
    });

    /* A header with nothing under it gives an author nowhere to start. */
    it('starts with one empty row', async () => {
      const { component } = await mount();

      component.setQuestionType(0, 'checkBoxGroup');

      expect(component.optionRows(component.questions()[0])).toEqual(['']);
    });

    it('adds and fills rows', async () => {
      const { component } = await mount();

      component.setQuestionType(0, 'checkBoxGroup');
      component.setOptionAt(0, 0, 'Time');
      component.addOption(0);
      component.setOptionAt(0, 1, 'Materials');

      expect(component.optionRows(component.questions()[0]))
        .toEqual(['Time', 'Materials']);
    });

    it('removes the row asked for, not the last one', async () => {
      const { component } = await mount();

      component.setQuestionType(0, 'checkBoxGroup');
      component.setOptionAt(0, 0, 'Time');
      component.addOption(0);
      component.setOptionAt(0, 1, 'Materials');
      component.addOption(0);
      component.setOptionAt(0, 2, 'Noise');

      component.removeOption(0, 1);

      expect(component.optionRows(component.questions()[0]))
        .toEqual(['Time', 'Noise']);
    });

    /* NEVER DOWN TO NOTHING, or the editor reaches a state with no box to type
       in and no way back except changing the type and back again. */
    it('clearing the last row leaves an empty one', async () => {
      const { component } = await mount();

      component.setQuestionType(0, 'checkBoxGroup');
      component.setOptionAt(0, 0, 'Time');
      component.removeOption(0, 0);

      expect(component.optionRows(component.questions()[0])).toEqual(['']);
    });

    /*
     * THE REASON THIS TYPE STORES AN ARRAY. An author typing a comma into a row
     * means one option; a comma joined string would silently make it two, and
     * nobody would find out until a teacher saw the mangled list.
     */
    it('keeps an option that contains a comma whole', async () => {
      const { component } = await mount();

      component.setQuestionType(0, 'checkBoxGroup');
      component.setOptionAt(0, 0, 'Ran out of time, mostly');

      expect(component.optionRows(component.questions()[0]))
        .toEqual(['Ran out of time, mostly']);
    });

    /* Switching type must not leave the other editor's shape behind: a string
       reaching the row editor would show one row that cannot be typed into. */
    it('clears to an array when the type becomes a row type', async () => {
      for (const type of ['checkBoxGroup', 'radioGroup']) {
        const { component } = await mount();

        component.setQuestionType(0, 'dropDown');
        component.setDropDownOptions(0, 'Yes,No');
        component.setQuestionType(0, type);

        expect(component.questions()[0].dropDownOptions).toEqual([]);
      }
    });

    /* Switching BETWEEN the two row types keeps the options, because both edit
       and store them the same way. Clearing here would lose an author's work for
       a change that alters nothing about how the options are written. */
    it('keeps the options when switching between the two row types', async () => {
      const { component } = await mount();

      component.setQuestionType(0, 'checkBoxGroup');
      component.setOptionAt(0, 0, 'Yes');
      component.setQuestionType(0, 'radioGroup');

      expect(component.optionRows(component.questions()[0])).toEqual(['Yes']);
    });

    it('clears to a string when the type stops being checkBoxGroup', async () => {
      const { component } = await mount();

      component.setQuestionType(0, 'checkBoxGroup');
      component.setOptionAt(0, 0, 'Time');
      component.setQuestionType(0, 'dropDown');

      expect(component.questions()[0].dropDownOptions).toBe('');
    });

    /* A stored question written before this type existed, or edited by hand, can
       hold the comma string. The row editor has to be able to open it. */
    it('opens a comma string stored on a checkBoxGroup question as rows', async () => {
      const { component } = await mount(
        storedForm({
          questions: [
            {
              questionType: 'checkBoxGroup',
              questionNumber: 1,
              question: 'What got in the way?',
              prompt: '',
              isSubquestion: false,
              dropDownOptions: 'Time,Materials',
              dropDownOptionsDynamic: '',
              dropDownOptionsDependent: '',
              fieldIcon: ''
            }
          ]
        })
      );

      expect(component.optionRows(component.questions()[0]))
        .toEqual(['Time', 'Materials']);
    });
  });

  describe('the per-type field', () => {

    it('offers Drop Down Options only for dropDown', async () => {
      const { component } = await mount();

      component.setQuestionType(0, 'dropDown');
      const question = component.questions()[0];

      expect(component.needsOptions(question)).toBe(true);
      expect(component.needsDynamicName(question)).toBe(false);
      expect(component.needsDependentName(question)).toBe(false);
      expect(component.needsPrompt(question)).toBe(false);
    });

    it('offers the Configuration Document only for dropDownDynamic', async () => {
      const { component } = await mount();

      component.setQuestionType(0, 'dropDownDynamic');

      expect(component.needsDynamicName(component.questions()[0])).toBe(true);
      expect(component.needsOptions(component.questions()[0])).toBe(false);
    });

    it('offers the Dependent name only for dropDownDependent', async () => {
      const { component } = await mount();

      component.setQuestionType(0, 'dropDownDependent');

      expect(component.needsDependentName(component.questions()[0])).toBe(true);
    });

    /**
     * `text` GETS A PROMPT, which was the surprise. All 209 stored questions have
     * `prompt: ''`, which reads like a field nothing collects — but production's
     * template offers it on a text question and it becomes that field's
     * placeholder. Unfilled is not the same as dead.
     */
    it('offers a Prompt only for text', async () => {
      const { component } = await mount();

      component.setQuestionType(0, 'text');

      expect(component.needsPrompt(component.questions()[0])).toBe(true);

      component.setQuestionType(0, 'textBox');
      expect(component.needsPrompt(component.questions()[0])).toBe(false);
    });

    it('offers nothing extra for Display Only or Star Rating', async () => {
      const { component } = await mount();

      for (const type of ['none', 'starRating']) {
        component.setQuestionType(0, type);
        const question = component.questions()[0];

        expect(component.needsOptions(question)).toBe(false);
        expect(component.needsDynamicName(question)).toBe(false);
        expect(component.needsDependentName(question)).toBe(false);
        expect(component.needsPrompt(question)).toBe(false);
      }
    });

    /**
     * CHANGING THE TYPE CLEARS THE OTHERS. Switching dropDownDependent to text
     * would otherwise leave 'RYSI_Categories,rysiCategoryMap,categories' behind on
     * a question with no dropdown — invisible, because the field showing it is
     * gone, and still in the saved document.
     */
    it('clears every type-specific field when the type changes', async () => {
      const { component } = await mount();

      component.setQuestionType(0, 'dropDownDependent');
      component.setDependentName(0, 'RYSI_Categories,rysiCategoryMap,categories');

      component.setQuestionType(0, 'text');
      component.setPrompt(0, 'Type here');

      expect(component.questions()[0].dropDownOptionsDependent).toBe('');
      expect(component.questions()[0].prompt).toBe('Type here');

      component.setQuestionType(0, 'none');
      expect(component.questions()[0].prompt).toBe('');
    });
  });

  /**
   * A SUB-QUESTION IS LETTERED, which is production's own behaviour: ticking the
   * box changes the heading from 'Question 1: …' to 'i: …'.
   */
  describe('the question label', () => {

    it('numbers a full question and letters a sub-question', async () => {
      const { component } = await mount();

      component.setQuestionText(0, 'Parent');
      expect(component.questionLabel(component.questions()[0], 0)).toBe('Question 1: Parent');

      component.addQuestion();
      component.setQuestionText(1, 'Child');
      component.setSubquestion(1, true);

      expect(component.questionLabel(component.questions()[1], 1)).toBe('i: Child');
    });

    /** A sub-question does not advance the parent numbering. */
    it('does not let a sub-question consume a number', async () => {
      const { component } = await mount();

      component.setQuestionText(0, 'One');
      component.addQuestion();
      component.setQuestionText(1, 'Sub');
      component.setSubquestion(1, true);
      component.addQuestion();
      component.setQuestionText(2, 'Two');

      expect(component.questionLabel(component.questions()[2], 2)).toBe('Question 2: Two');
    });

    it('counts consecutive sub-questions i, ii, iii', async () => {
      const { component } = await mount();

      component.setQuestionText(0, 'Parent');
      for (const [offset, text] of ['a', 'b', 'c'].entries()) {
        component.addQuestion();
        component.setQuestionText(offset + 1, text);
        component.setSubquestion(offset + 1, true);
      }

      expect(component.questionLabel(component.questions()[1], 1)).toBe('i: a');
      expect(component.questionLabel(component.questions()[2], 2)).toBe('ii: b');
      expect(component.questionLabel(component.questions()[3], 3)).toBe('iii: c');
    });

    /** An empty question still gets a label, so the block is identifiable. */
    it('labels an empty question', async () => {
      const { component } = await mount();

      expect(component.questionLabel(component.questions()[0], 0)).toBe('Question 1:');
    });

    /** The review labels by RAW position, as production's does — a flat list. */
    it('labels the review rows by position', async () => {
      const { component } = await mount();

      component.setSubquestion(0, true);

      expect(component.reviewLabel(0)).toBe('Question 1');
    });
  });

  describe('the edit prefill', () => {

    /**
     * ngOnInit, not the constructor: a signal input is not bound until after
     * construction, so a constructor read sees null and opens an empty dialog over
     * a real document — which the first save then overwrites with nothing.
     */
    it('loads the stored form', async () => {
      const { component } = await mount(storedForm());

      expect(component.isEdit()).toBe(true);
      expect(component.heading()).toBe('Edit Form Assignment');
      expect(component.saveLabel()).toBe('Update Form');
      expect(component.displayName()).toBe('Innovation submission');
      expect(component.questions().length).toBe(1);
      expect(component.questions()[0].dropDownOptionsDynamic)
        .toBe('RYSI_Categories,subjects');
    });

    /**
     * COPIED, NOT REFERENCED. The questions are objects on an input and the row is
     * what the table is rendering: editing in place would show unsaved changes in
     * the list, and cancelling would not undo them.
     */
    it('does not mutate the row it was given', async () => {
      const stored = storedForm();
      const original = stored.questions[0].question;

      const { component } = await mount(stored);
      component.setQuestionText(0, 'edited in the dialog');

      expect(stored.questions[0].question).toBe(original);
    });

    /** The collection holds `dropDownOptions` as both a string and an array. */
    it('joins a stored array of options into the text field', async () => {
      const stored = storedForm();
      (stored.questions[0] as unknown as Record<string, unknown>)['dropDownOptions'] =
        ['Yes', 'No'];

      const { component } = await mount(stored);

      expect(component.questions()[0].dropDownOptions).toBe('Yes,No');
    });

    /**
     * A KEY THIS APP DOES NOT MODEL SURVIVES. Older questions carry `options` and
     * `allowMultiple` from an `mcq` type this dialog does not offer; dropping them
     * on read would delete them on the next save.
     */
    it('carries through fields the current dialog does not offer', async () => {
      const stored = storedForm();
      (stored.questions[0] as unknown as Record<string, unknown>)['allowMultiple'] = true;

      const { component, saved } = await mount(stored);
      component.step.set(3);
      component.save();

      const question = saved[0].questions[0] as unknown as Record<string, unknown>;
      expect(question['allowMultiple']).toBe(true);
    });

    /** A form with no questions would open step two on nothing. */
    it('gives a questionless document one question to edit', async () => {
      const { component } = await mount(storedForm({ questions: [] }));

      expect(component.questions().length).toBe(1);
    });
  });

  describe('saving', () => {

    /*
     * BLANK ROWS DROPPED, and the array kept as an array.
     *
     * `addOption` appends an empty row before it is filled in and the editor
     * keeps one so there is always somewhere to type, so without this a saved
     * document would carry '' entries no author added. The players filter blanks
     * on read, so this is not what stops a blank checkbox appearing; it is what
     * stops the editor showing the author rows they never made.
     */
    it('saves checkBoxGroup options as a trimmed array', async () => {
      const { component, saved } = await mount();

      fillBasics(component);
      fillQuestion(component, 0, 'What got in the way?', 'checkBoxGroup');
      component.setOptionAt(0, 0, '  Time  ');
      component.addOption(0);
      component.setOptionAt(0, 1, 'Ran out of materials, mostly');
      // Left empty on purpose: this is the row `addOption` just made.
      component.addOption(0);
      component.save();

      expect(saved[0].questions[0].dropDownOptions)
        .toEqual(['Time', 'Ran out of materials, mostly']);
    });

    /* dropDown is untouched by any of this: same field, still a string. */
    it('leaves a dropDown question storing its comma string', async () => {
      const { component, saved } = await mount();

      fillBasics(component);
      fillQuestion(component, 0, 'Did it run to time?', 'dropDown');
      component.setDropDownOptions(0, 'Yes,No');
      component.save();

      expect(saved[0].questions[0].dropDownOptions).toBe('Yes,No');
    });

    it('emits the base fields production stores', async () => {
      const { component, saved } = await mount();

      fillBasics(component);
      fillQuestion(component, 0, 'What materials did you need?');
      component.save();

      expect(saved.length).toBe(1);

      const draft = saved[0];
      expect(draft.type).toBe('FORM');
      expect(draft.displayName).toBe('Deogiri Reflection - Day 2');
      expect(draft.author).toBe('Aashray Millindar');
      expect(draft.creator).toBe('Santosh Kanta');
      expect(draft.status).toBe('LIVE');
      expect(draft.instructions)
        .toBe('Please answer all the questions in the fields provided below');
    });

    /**
     * A FORM STORES `questions`, NOT `questionsData`. A quiz uses the other name
     * for the same idea, and swapping them writes a document production reads as
     * having no content at all.
     */
    it('emits questions, never questionsData', async () => {
      const { component, saved } = await mount();

      fillBasics(component);
      fillQuestion(component, 0, 'Anything?');
      component.save();

      const draft = saved[0] as unknown as Record<string, unknown>;
      expect('questions' in draft).toBe(true);
      expect('questionsData' in draft).toBe(false);
    });

    /** All nine keys, pinned. A missing one is narrower than any stored question. */
    it('emits every key production writes on a question', async () => {
      const { component, saved } = await mount();

      fillBasics(component);
      fillQuestion(component, 0, 'Anything?', 'starRating');
      component.save();

      const question = saved[0].questions[0] as unknown as Record<string, unknown>;

      for (const key of QUESTION_KEYS) {
        expect(key in question).toBe(true);
      }
    });

    /** A form's type is camelCase, unlike a quiz's uppercase. */
    it('stores the type exactly as configured', async () => {
      const { component, saved } = await mount();

      fillBasics(component);
      fillQuestion(component, 0, 'Pick a category', 'dropDownDependent');
      component.setDependentName(0, 'RYSI_Categories,rysiCategoryMap,categories');
      component.save();

      expect(saved[0].questions[0].questionType).toBe('dropDownDependent');
      expect(saved[0].questions[0].dropDownOptionsDependent)
        .toBe('RYSI_Categories,rysiCategoryMap,categories');
      expect(saved[0].questions[0].dropDownOptions).toBe('');
      expect(saved[0].questions[0].dropDownOptionsDynamic).toBe('');
    });

    it('trims the text and renumbers on the way out', async () => {
      const { component, saved } = await mount();

      fillBasics(component);
      fillQuestion(component, 0, '  first  ');
      component.addQuestion();
      fillQuestion(component, 1, 'second');
      component.save();

      expect(saved[0].questions.map(q => q.question)).toEqual(['first', 'second']);
      expect(saved[0].questions.map(q => q.questionNumber)).toEqual([1, 2]);
    });

    it('keeps the sub-question flag', async () => {
      const { component, saved } = await mount();

      fillBasics(component);
      fillQuestion(component, 0, 'Parent');
      component.addQuestion();
      fillQuestion(component, 1, 'Child');
      component.setSubquestion(1, true);
      component.save();

      expect(saved[0].questions[0].isSubquestion).toBe(false);
      expect(saved[0].questions[1].isSubquestion).toBe(true);
    });

    /**
     * FIRESTORE REJECTS `undefined` ANYWHERE and fails the WHOLE write. This is the
     * bug that made the quiz wizard's Update button look dead. Walked here on the
     * real stored shape.
     */
    it('emits no undefined at any depth', async () => {
      const { component, saved } = await mount(storedForm());

      component.addQuestion();
      fillQuestion(component, 1, 'A second question', 'dropDown');
      component.setDropDownOptions(1, 'Yes,No');
      component.step.set(3);
      component.save();

      expect(findUndefined(saved[0])).toEqual([]);
    });

    /**
     * NAVIGATES TO THE PROBLEM rather than returning silently. A refused save on
     * the last step, with the offending field two steps back, is what reads as a
     * button that does nothing.
     */
    it('jumps back to the step that is blocking instead of doing nothing', async () => {
      const { component, saved } = await mount();

      component.step.set(3);
      component.save();

      expect(saved.length).toBe(0);
      expect(component.step()).toBe(1);

      fillBasics(component);
      component.step.set(3);
      component.save();

      expect(saved.length).toBe(0);
      expect(component.step()).toBe(2);
    });

    it('does not emit twice while a save is in flight', async () => {
      const { fixture, component, saved } = await mount();

      fillBasics(component);
      fillQuestion(component, 0, 'Anything?');
      fixture.componentRef.setInput('saving', true);

      component.save();

      expect(saved.length).toBe(0);
    });
  });

  describe('the review step', () => {

    it('labels the configured types', async () => {
      const { component } = await mount();

      expect(component.typeLabel('none')).toBe('Display Only');
      expect(component.typeLabel('text')).toBe('Text Field');
      expect(component.typeLabel('dropDownDependent')).toBe('Drop Down (Dependent)');
    });

    /** An unknown type shows itself rather than nothing. */
    it('falls back to the stored value for an unknown type', async () => {
      const { component } = await mount();

      expect(component.typeLabel('somethingNew')).toBe('somethingNew');
      expect(component.typeLabel('')).toBe('—');
    });

    it('ticks the steps already passed', async () => {
      const { component } = await mount();

      component.step.set(3);

      expect(component.isDone(1)).toBe(true);
      expect(component.isDone(2)).toBe(true);
      expect(component.isDone(3)).toBe(false);
    });
  });

  /** The question type is what production reads; the compiler is the check. */
  it('builds a question the interface accepts', async () => {
    const { component } = await mount();

    const question: FormQuestion = component.questions()[0];

    expect(question.prompt).toBe('');
  });
});

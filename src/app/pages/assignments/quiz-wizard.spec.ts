import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  QUIZ_QUESTION_TYPES,
  QuizAssignment,
  QuizQuestion
} from '../../models/teaching.model';
import { AuthService } from '../../services/auth.service';
import { QUIZ_STEPS, QuizWizard } from './quiz-wizard';

/**
 * Create Quiz — the four-step wizard.
 *
 * WHAT IS WORTH TESTING HERE, and it is not the markup. Three things in this
 * component are quiet when wrong, and all three produce a document that looks
 * saved and cannot be marked:
 *
 *   1. THE CORRECT-ANSWER RULES. A single-answer MCQ with two ticked options is
 *      unanswerable, and nothing on screen says so. Both the radio behaviour and
 *      the Multiple Correct toggle have to enforce it.
 *   2. THE BLANK KEYS. FILL_IN_THE_BLANKS uses 'optionsBlank1'; RICH_BLANKS uses
 *      'blank a'. Production's player looks them up BY NAME, so a wrong key is a
 *      blank that can never be answered.
 *   3. THE PAYLOAD SHAPE. `questionsData`, not `questions`; option fields
 *       including optionType and imagePath; and NO `optionalResource`, which was
 *       written empty until resources were dropped from the model entirely.
 */

class StubAuthService {
  displayName(): string {
    return 'Divya Jain';
  }
}

async function mount(): Promise<{
  fixture: ComponentFixture<QuizWizard>;
  component: QuizWizard;
  saved: QuizAssignment[];
}> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [QuizWizard],
    providers: [{ provide: AuthService, useValue: new StubAuthService() }]
  }).compileComponents();

  const fixture = TestBed.createComponent(QuizWizard);
  const component = fixture.componentInstance;
  const saved: QuizAssignment[] = [];

  component.submitted.subscribe(draft => saved.push(draft as QuizAssignment));
  fixture.detectChanges();

  return { fixture, component, saved };
}

/** Fills step 1 so the wizard can advance. */
function fillBasics(component: QuizWizard): void {
  component.displayName.set('test2');
  component.author.set('aseed');
  component.authenticationType.set('login');
  component.status.set('LIVE');
}

describe('QuizWizard', () => {

  /* ---- Shape -------------------------------------------------------------- */

  it('has production\'s four steps', () => {
    expect(QUIZ_STEPS.map(step => step.label)).toEqual([
      'Basic Info',
      'Background / Case Study',
      'Questions',
      'Review'
    ]);
  });

  it('offers all five question types, in production\'s menu order', () => {
    expect(QUIZ_QUESTION_TYPES.map(entry => entry.type)).toEqual([
      'MCQ',
      'FILL_IN_THE_BLANKS',
      'TEXT',
      'RICH_BLANKS',
      'DESCRIPTIVE'
    ]);
  });

  /* ---- Step gating -------------------------------------------------------- */

  it('blocks step 1 until title, author, auth type and status are set', async () => {
    const { component } = await mount();

    expect(component.continueBlocked()).toBe(true);

    component.displayName.set('test2');
    component.author.set('aseed');
    component.authenticationType.set('login');
    expect(component.continueBlocked()).toBe(true);

    component.status.set('LIVE');
    expect(component.continueBlocked()).toBe(false);
  });

  /** Step 2 is optional in full — it has its own Skip button. */
  it('never blocks step 2', async () => {
    const { component } = await mount();

    component.step.set(2);

    expect(component.continueBlocked()).toBe(false);
  });

  it('Skip clears the case study and lands on questions', async () => {
    const { component } = await mount();

    component.step.set(2);
    component.caseStudyTitle.set('Something');
    component.caseStudyDescription.set('<p>Context</p>');

    component.skipBackground();

    expect(component.step()).toBe(3);
    expect(component.caseStudyTitle()).toBe('');
    expect(component.caseStudyDescription()).toBe('');
  });

  /**
   * A TITLELESS QUESTION IS BLOCKED. Production lets one through and the quiz
   * then shows a student a blank prompt, which is worse than a stopped Next.
   * '<p><br></p>' counts as empty — it is what a browser leaves in a
   * contenteditable that has been typed into and cleared.
   */
  it('blocks step 3 until every question has a title', async () => {
    const { component } = await mount();

    component.step.set(3);
    expect(component.continueBlocked()).toBe(true);

    component.addQuestion('MCQ');
    expect(component.continueBlocked()).toBe(true);

    component.setQuestionTitle(0, '<p><br></p>');
    expect(component.continueBlocked()).toBe(true);

    component.setQuestionTitle(0, '<p>What colour?</p>');
    expect(component.continueBlocked()).toBe(false);
  });

  /* ---- Questions ---------------------------------------------------------- */

  it('adds a question of the chosen type with that type\'s fields only', async () => {
    const { component } = await mount();

    component.addQuestion('MCQ');
    component.addQuestion('TEXT');
    component.addQuestion('FILL_IN_THE_BLANKS');

    const [mcq, text, blanks] = component.questions();

    // An MCQ opens with three options, as production's editor does.
    expect(mcq.options?.length).toBe(3);
    expect(mcq.answer).toBeUndefined();

    // TEXT gets an answer and a 400-character cap; no options.
    expect(text.answer).toBe('');
    expect(text.maxCharLength).toBe(400);
    expect(text.options).toBeUndefined();

    expect(blanks.blanks).toEqual({});
    expect(blanks.options).toBeUndefined();
  });

  /** DESCRIPTIVE differs from TEXT only in the cap, which is what the data shows. */
  it('gives DESCRIPTIVE a longer cap than TEXT', async () => {
    const { component } = await mount();

    component.addQuestion('DESCRIPTIVE');

    expect(component.questions()[0].maxCharLength).toBe(2000);
  });

  it('removes a question by position', async () => {
    const { component } = await mount();

    component.addQuestion('MCQ');
    component.addQuestion('TEXT');
    component.removeQuestion(0);

    expect(component.questions().length).toBe(1);
    expect(component.questions()[0].questionType).toBe('TEXT');
  });

  /* ---- Correct answers, the load-bearing rules ---------------------------- */

  /**
   * SINGLE-ANSWER: choosing one CLEARS the others. A question with two right
   * answers under a one-answer rule cannot be marked, and nothing in the form
   * would show the contradiction.
   */
  it('keeps one correct option when the question is single-answer', async () => {
    const { component } = await mount();

    component.addQuestion('MCQ');
    component.markCorrect(0, 0);
    component.markCorrect(0, 2);

    const correct = component.questions()[0].options?.filter(option => option.isCorrect);

    expect(correct?.length).toBe(1);
    expect(component.questions()[0].options?.[2].isCorrect).toBe(true);
  });

  /** With the toggle on, several can be right and each one toggles alone. */
  it('allows several correct options once Multiple is on', async () => {
    const { component } = await mount();

    component.addQuestion('MCQ');
    component.toggleMultipleCorrect(0);

    component.markCorrect(0, 0);
    component.markCorrect(0, 1);

    expect(component.questions()[0].options?.filter(o => o.isCorrect).length).toBe(2);

    // And toggling one off leaves the other alone.
    component.markCorrect(0, 0);
    expect(component.questions()[0].options?.filter(o => o.isCorrect).length).toBe(1);
  });

  /**
   * TURNING MULTIPLE BACK OFF keeps only the FIRST correct option. Leaving two
   * ticked under a single-answer rule is the same unmarkable state, arrived at
   * from the other direction.
   */
  it('drops the extra correct options when Multiple is turned off', async () => {
    const { component } = await mount();

    component.addQuestion('MCQ');
    component.toggleMultipleCorrect(0);
    component.markCorrect(0, 0);
    component.markCorrect(0, 2);

    component.toggleMultipleCorrect(0);

    const options = component.questions()[0].options ?? [];
    expect(options.filter(option => option.isCorrect).length).toBe(1);
    expect(options[0].isCorrect).toBe(true);
  });

  it('adds and removes options', async () => {
    const { component } = await mount();

    component.addQuestion('MCQ');
    component.addOption(0);
    expect(component.questions()[0].options?.length).toBe(4);

    component.removeOption(0, 0);
    expect(component.questions()[0].options?.length).toBe(3);
  });

  /** An IMAGE option stores a path; a TEXT option stores a label. Both fields
   *  exist on every option, because production's do. */
  it('keeps both option fields whichever type is chosen', async () => {
    const { component } = await mount();

    component.addQuestion('MCQ');
    component.setOptionType(0, 0, 'IMAGE');
    component.setOptionImage(0, 0, 'quizzer_resources/a.png');

    const option = component.questions()[0].options?.[0];

    expect(option?.optionType).toBe('IMAGE');
    expect(option?.imagePath).toBe('quizzer_resources/a.png');
    expect(option?.name).toBe('');
  });

  /* ---- Blanks ------------------------------------------------------------- */

  /**
   * THE KEY NAMES ARE THE CONTRACT. Production's player looks each blank up by
   * name, so 'optionsBlank1' for one type and 'blank a' for the other are not
   * cosmetic.
   */
  it('names fill-in-the-blanks keys optionsBlank1, optionsBlank2', async () => {
    const { component } = await mount();

    component.addQuestion('FILL_IN_THE_BLANKS');
    component.addBlank(0);
    component.addBlank(0);

    expect(component.blankLabels(component.questions()[0]))
      .toEqual(['optionsBlank1', 'optionsBlank2']);
  });

  it('names rich-blanks keys "blank a", "blank b"', async () => {
    const { component } = await mount();

    component.addQuestion('RICH_BLANKS');
    component.addBlank(0);
    component.addBlank(0);

    expect(component.blankLabels(component.questions()[0])).toEqual(['blank a', 'blank b']);
  });

  /** One right answer per blank — two would make it unanswerable. */
  it('keeps exactly one correct choice per blank', async () => {
    const { component } = await mount();

    component.addQuestion('FILL_IN_THE_BLANKS');
    component.addBlank(0);
    component.addBlankOption(0, 'optionsBlank1');
    component.markBlankCorrect(0, 'optionsBlank1', 2);

    const choices = component.questions()[0].blanks?.['optionsBlank1'] ?? [];

    expect(choices.filter(choice => choice.isCorrect).length).toBe(1);
    expect(choices[2].isCorrect).toBe(true);
  });

  it('removes a blank and its choices', async () => {
    const { component } = await mount();

    component.addQuestion('FILL_IN_THE_BLANKS');
    component.addBlank(0);
    component.removeBlank(0, 'optionsBlank1');

    expect(component.blankLabels(component.questions()[0])).toEqual([]);
  });

  /* ---- Sub-questions ------------------------------------------------------ */

  it('seeds one lettered part when sub-questions are enabled', async () => {
    const { component } = await mount();

    component.addQuestion('MCQ');
    component.toggleSubParts(0);

    expect(component.questions()[0].hasSubParts).toBe(true);
    expect(component.questions()[0].subParts?.length).toBe(1);
    expect(component.questions()[0].subParts?.[0].label).toBe('a');
  });

  /**
   * TURNING IT OFF EMPTIES THE ARRAY. Production reads `subParts`, so a question
   * whose flag says it has none while the array still holds two would render
   * orphaned parts.
   */
  it('clears the parts when sub-questions are disabled', async () => {
    const { component } = await mount();

    component.addQuestion('MCQ');
    component.toggleSubParts(0);
    component.addSubPart(0);
    component.toggleSubParts(0);

    expect(component.questions()[0].hasSubParts).toBe(false);
    expect(component.questions()[0].subParts).toEqual([]);
  });

  /** Letters stay a, b, c rather than leaving a gap where one was removed. */
  it('relabels the remaining parts after a removal', async () => {
    const { component } = await mount();

    component.addQuestion('MCQ');
    component.toggleSubParts(0);
    component.addSubPart(0);
    component.addSubPart(0);

    component.removeSubPart(0, 1);

    expect(component.questions()[0].subParts?.map(part => part.label)).toEqual(['a', 'b']);
  });

  /* ---- The saved document ------------------------------------------------- */

  it('emits a quiz in production\'s shape', async () => {
    const { component, saved } = await mount();

    fillBasics(component);
    component.numberOfAllowedSubmissions.set(2);
    component.totalDurationInHours.set(4);
    component.totalDurationInMinutes.set(5);
    component.totalDurationInSeconds.set(4);
    component.displayCorrectAnswers.set(true);
    component.caseStudyTitle.set('A case');
    component.caseStudyDescription.set('<p>Context</p>');
    component.addQuestion('MCQ');
    component.setQuestionTitle(0, '<p>What colour?</p>');

    component.save();

    expect(saved.length).toBe(1);
    const quiz = saved[0];

    expect(quiz.type).toBe('QUIZ');
    expect(quiz.displayName).toBe('test2');
    expect(quiz.creator).toBe('Divya Jain');
    expect(quiz.authenticationType).toBe('login');
    expect(quiz.numberOfAllowedSubmissions).toBe(2);
    expect(quiz.totalDurationInHours).toBe(4);
    expect(quiz.displayCorrectAnswers).toBe(true);
    expect(quiz.backgroundInfo.title).toBe('A case');
    expect(quiz.backgroundInfo.description).toBe('<p>Context</p>');
    // Inline media is not built, so the array is empty — but present, because
    // production's documents always carry it.
    expect(quiz.backgroundInfo.images).toEqual([]);

    // questionsData, NOT questions — the two types use different keys.
    expect(quiz.questionsData.length).toBe(1);
    expect((quiz as unknown as Record<string, unknown>)['questions']).toBeUndefined();

    /*
     * NO `optionalResource`. It was written as an empty array while the field was
     * modelled; the Add Resources section was excluded on instruction, so the key
     * was one nothing in this app could ever fill and it has been dropped.
     */
    expect('optionalResource' in quiz.questionsData[0]).toBe(false);
  });

  it('refuses to save without a titled question', async () => {
    const { component, saved } = await mount();

    fillBasics(component);
    component.save();

    expect(saved).toEqual([]);
  });

  it('refuses to save with step 1 incomplete', async () => {
    const { component, saved } = await mount();

    component.addQuestion('MCQ');
    component.setQuestionTitle(0, '<p>Q</p>');
    component.save();

    expect(saved).toEqual([]);
  });

  /* ---- Review ------------------------------------------------------------- */

  it('prints the duration the way the review shows it', async () => {
    const { component } = await mount();

    component.totalDurationInHours.set(4);
    component.totalDurationInMinutes.set(5);
    component.totalDurationInSeconds.set(4);

    expect(component.durationLabel()).toBe('4h 5m 4s');
  });

  it('totals the marks across questions', async () => {
    const { component } = await mount();

    component.addQuestion('MCQ');
    component.addQuestion('TEXT');
    component.setQuestionField(1, 'marks', '5');

    expect(component.totalMarks()).toBe(6);
  });

  /** The review shows titles as text: rendering the HTML would let a stray
   *  heading restyle the summary. */
  it('strips markup for the review', async () => {
    const { component } = await mount();

    expect(component.plainText('<p>Hello <strong>there</strong></p>')).toBe('Hello there');
    expect(component.plainText('<p><br></p>')).toBe('');
  });

  /* ---- The two Add New Question buttons ----------------------------------- */

  /**
   * THE BUG THIS PINS. There are two of these buttons, above and below the list,
   * as production has. They shared one boolean, and the menu was rendered only at
   * the top — so clicking the lower one opened a menu several hundred pixels up,
   * usually scrolled out of sight, and the button read as dead.
   *
   * The state is a POSITION now, and each button owns its own popover.
   */
  it('opens only the menu belonging to the button that was pressed', async () => {
    const { component } = await mount();

    component.toggleTypeMenu('top');
    expect(component.typeMenuAt()).toBe('top');

    component.toggleTypeMenu('bottom');
    expect(component.typeMenuAt()).toBe('bottom');
  });

  it('closes the menu when the same button is pressed again', async () => {
    const { component } = await mount();

    component.toggleTypeMenu('bottom');
    component.toggleTypeMenu('bottom');

    expect(component.typeMenuAt()).toBeNull();
  });

  it('closes the menu once a question is added', async () => {
    const { component } = await mount();

    component.toggleTypeMenu('bottom');
    component.addQuestion('TEXT');

    expect(component.typeMenuAt()).toBeNull();
    expect(component.questions().length).toBe(1);
  });

  /** Both buttons add to the SAME list, at the end. */
  it('appends from either button', async () => {
    const { component } = await mount();

    component.toggleTypeMenu('top');
    component.addQuestion('MCQ');
    component.toggleTypeMenu('bottom');
    component.addQuestion('TEXT');

    expect(component.questions().map(q => q.questionType)).toEqual(['MCQ', 'TEXT']);
  });

  /**
   * ESCAPE SHUTS THE MENU FIRST. Closing a four-step form because someone
   * dismissed a popover would throw away everything typed into it.
   */
  it('Escape closes the menu before the dialog', async () => {
    const { component, fixture } = await mount();
    let closed = 0;
    component.closed.subscribe(() => closed++);
    fixture.detectChanges();

    component.toggleTypeMenu('bottom');
    component.onEscape();

    expect(component.typeMenuAt()).toBeNull();
    expect(closed).toBe(0);

    component.onEscape();
    expect(closed).toBe(1);
  });

  /** Production gives MCQ its own mark and the other four a pencil: MCQ is the
   *  only type whose answer is chosen from a list rather than written. */
  it('gives every menu item an icon, with MCQ distinct', () => {
    expect(QUIZ_QUESTION_TYPES.every(entry => entry.icon !== '')).toBe(true);
    expect(QUIZ_QUESTION_TYPES.find(entry => entry.type === 'MCQ')?.icon).toBe('list');
    expect(QUIZ_QUESTION_TYPES.filter(entry => entry.icon === 'edit').length).toBe(4);
  });

  /* ==========================================================================
     EDIT MODE
     ========================================================================== */

  /**
   * ONE COMPONENT FOR BOTH, as production has it: the same four steps titled
   * "Edit Quiz" with "Update Quiz" at the end.
   *
   * The two assertions worth the most here are the ones about NOT losing data:
   * `backgroundInfo.images` must survive (this app cannot insert inline media, so
   * writing [] would orphan files the description still references), and the
   * loaded questions must be COPIES (editing an input's nested objects in place
   * mutates the row the table is rendering, so cancelling would not undo it).
   */
  describe('editing an existing quiz', () => {

    function storedQuiz(): QuizAssignment {
      return {
        docId: 'q1',
        displayName: 'Case Study Quiz',
        type: 'QUIZ',
        status: 'LIVE',
        creator: 'Siddaveer Swamy',
        author: 'Siddaveer',
        ownerId: 'uid-1',
        createdAt: null,
        updatedAt: null,
        authenticationType: 'login',
        allowExitAndReEntry: false,
        displayCorrectAnswers: true,
        numberOfAllowedSubmissions: 2,
        totalDurationInHours: 1,
        totalDurationInMinutes: 30,
        totalDurationInSeconds: 15,
        backgroundInfo: {
          title: 'Sample Case Study',
          description: '<p>Lorem Ipsum</p>',
          images: [
            { storagePath: 'quizzer-casestudy-resources/a.pdf', filename: 'a.pdf', order: 0, type: 'pdf' }
          ]
        },
        questionsData: [
          {
            questionTitle: '<p>What colour?</p>',
            questionType: 'MCQ',
            marks: 3,
            pedagogyType: 'FA',
            durationInHours: 0,
            durationInMinutes: 2,
            durationInSeconds: 0,
            oneCorrectOption: true,
            options: [
              { name: 'Blue', isCorrect: true, optionType: 'TEXT', imagePath: '' },
              { name: 'Red', isCorrect: false, optionType: 'TEXT', imagePath: '' }
            ]
          }
        ]
      };
    }

    async function mountEdit(quiz = storedQuiz()): Promise<{
      component: QuizWizard;
      saved: QuizAssignment[];
      quiz: QuizAssignment;
    }> {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [QuizWizard],
        providers: [{ provide: AuthService, useValue: new StubAuthService() }]
      }).compileComponents();

      const fixture = TestBed.createComponent(QuizWizard);
      const component = fixture.componentInstance;
      const saved: QuizAssignment[] = [];

      component.submitted.subscribe(draft => saved.push(draft as QuizAssignment));
      fixture.componentRef.setInput('quiz', quiz);
      fixture.detectChanges();

      return { component, saved, quiz };
    }

    it('titles itself Edit Quiz and ends on Update Quiz', async () => {
      const { component } = await mountEdit();

      expect(component.isEdit()).toBe(true);
      expect(component.heading()).toBe('Edit Quiz');
      expect(component.saveLabel()).toBe('Update Quiz');
    });

    it('says Create Quiz and Save Quiz when there is nothing to edit', async () => {
      const { component } = await mount();

      expect(component.isEdit()).toBe(false);
      expect(component.heading()).toBe('Create Quiz');
      expect(component.saveLabel()).toBe('Save Quiz');
    });

    it('prefills every step from the stored document', async () => {
      const { component } = await mountEdit();

      expect(component.displayName()).toBe('Case Study Quiz');
      expect(component.author()).toBe('Siddaveer');
      expect(component.status()).toBe('LIVE');
      expect(component.authenticationType()).toBe('login');
      expect(component.numberOfAllowedSubmissions()).toBe(2);
      expect(component.totalDurationInHours()).toBe(1);
      expect(component.totalDurationInMinutes()).toBe(30);
      expect(component.displayCorrectAnswers()).toBe(true);
      expect(component.caseStudyTitle()).toBe('Sample Case Study');
      expect(component.questions().length).toBe(1);
      expect(component.questions()[0].options?.length).toBe(2);
    });

    /**
     * THE STORED CREATOR WINS. It records who made the quiz; showing the current
     * user while editing somebody else's would be wrong on screen and would
     * rewrite the field on save.
     */
    it('keeps the original creator rather than the signed-in user', async () => {
      const { component, saved } = await mountEdit();

      expect(component.creator()).toBe('Siddaveer Swamy');

      component.save();

      expect(saved[0].creator).toBe('Siddaveer Swamy');
    });

    /**
     * THE IMAGES SURVIVE. This app cannot insert inline media, but a quiz written
     * by production has entries here, and writing [] would leave broken images in
     * the case study's HTML with no way to restore them.
     */
    it('carries backgroundInfo.images through an edit', async () => {
      const { component, saved } = await mountEdit();

      component.caseStudyTitle.set('Renamed');
      component.save();

      expect(saved[0].backgroundInfo.title).toBe('Renamed');
      expect(saved[0].backgroundInfo.images.length).toBe(1);
      expect(saved[0].backgroundInfo.images[0].filename).toBe('a.pdf');
    });

    /**
     * THE LOADED QUESTIONS ARE COPIES. They are nested objects on an input, and
     * editing them in place would mutate the row the table is rendering — so the
     * list would show unsaved edits and cancelling would not undo them.
     */
    it('does not mutate the input when a question is edited', async () => {
      const { component, quiz } = await mountEdit();

      component.setQuestionTitle(0, '<p>Changed</p>');
      component.setOptionText(0, 0, 'Green');

      expect(quiz.questionsData[0].questionTitle).toBe('<p>What colour?</p>');
      expect(quiz.questionsData[0].options?.[0].name).toBe('Blue');
      expect(component.questions()[0].options?.[0].name).toBe('Green');
    });

    it('emits the edited quiz in full, questionsData included', async () => {
      const { component, saved } = await mountEdit();

      component.addQuestion('TEXT');
      component.setQuestionTitle(1, '<p>Explain</p>');
      component.save();

      expect(saved[0].questionsData.length).toBe(2);
      expect(saved[0].questionsData[1].questionType).toBe('TEXT');
      expect(saved[0].displayName).toBe('Case Study Quiz');
    });
  });

  /* ---- Sub-part options --------------------------------------------------- */

  /**
   * A SUB-PART HAS ITS OWN OPTIONS, its own marks and its own Multiple Correct
   * rule — production's editor shows all three, and the stored `subParts` entries
   * carry them.
   */
  describe('an unmarked MCQ', () => {

    /** Mounted per test, since `missingCorrectOption` is an instance method. */

    /**
     * WARNED ABOUT ON REVIEW, because nothing else says so.
     *
     * Four options with no tick look the same as four you have not looked at, and
     * a quiz saved that way cannot be marked when it is run — a real one with five
     * such questions reported "0 of 5 marks", which reads as every answer being
     * wrong rather than as no answer having been set.
     */
    it('is flagged when no option is correct', async () => {
      const { component } = await mount();
      const question = {
        questionType: 'MCQ',
        options: [
          { name: 'A', isCorrect: false, optionType: 'TEXT', imagePath: '' },
          { name: 'B', isCorrect: false, optionType: 'TEXT', imagePath: '' }
        ]
      } as unknown as QuizQuestion;

      expect(component.missingCorrectOption(question)).toBe(true);
    });

    it('is not flagged once one is correct', async () => {
      const { component } = await mount();
      const question = {
        questionType: 'MCQ',
        options: [
          { name: 'A', isCorrect: true, optionType: 'TEXT', imagePath: '' },
          { name: 'B', isCorrect: false, optionType: 'TEXT', imagePath: '' }
        ]
      } as unknown as QuizQuestion;

      expect(component.missingCorrectOption(question)).toBe(false);
    });

    /** A question type that has no options is not an unmarked MCQ. */
    it('does not flag a non-MCQ or an MCQ with no options yet', async () => {
      const { component } = await mount();

      expect(
        component.missingCorrectOption({
          questionType: 'DESCRIPTIVE'
        } as unknown as QuizQuestion)
      ).toBe(false);

      expect(
        component.missingCorrectOption({
          questionType: 'MCQ',
          options: []
        } as unknown as QuizQuestion)
      ).toBe(false);
    });
  });

  describe('sub-part options', () => {

    async function withSubPart(): Promise<QuizWizard> {
      const { component } = await mount();

      component.addQuestion('MCQ');
      component.toggleSubParts(0);

      return component;
    }

    it('adds and removes a sub-part\'s own options', async () => {
      const component = await withSubPart();

      component.addSubPartOption(0, 0);
      component.addSubPartOption(0, 0);
      expect(component.questions()[0].subParts?.[0].options.length).toBe(2);

      component.removeSubPartOption(0, 0, 0);
      expect(component.questions()[0].subParts?.[0].options.length).toBe(1);
    });

    it('applies the same single-answer rule to a sub-part', async () => {
      const component = await withSubPart();

      component.addSubPartOption(0, 0);
      component.addSubPartOption(0, 0);
      component.markSubPartCorrect(0, 0, 0);
      component.markSubPartCorrect(0, 0, 1);

      const options = component.questions()[0].subParts?.[0].options ?? [];

      expect(options.filter(option => option.isCorrect).length).toBe(1);
      expect(options[1].isCorrect).toBe(true);
    });

    it('drops the extras when a sub-part\'s Multiple is turned off', async () => {
      const component = await withSubPart();

      component.addSubPartOption(0, 0);
      component.addSubPartOption(0, 0);
      component.toggleSubPartMultiple(0, 0);
      component.markSubPartCorrect(0, 0, 0);
      component.markSubPartCorrect(0, 0, 1);
      component.toggleSubPartMultiple(0, 0);

      const options = component.questions()[0].subParts?.[0].options ?? [];
      expect(options.filter(option => option.isCorrect).length).toBe(1);
    });

    /** Production prints this under the list; the parts' marks and the question's
     *  own are separate numbers and it is easy to set one and forget the other. */
    it('totals the sub-parts\' marks', async () => {
      const component = await withSubPart();

      component.addSubPart(0);
      component.setSubPartField(0, 1, 'marks', '4');

      expect(component.subPartMarks(component.questions()[0])).toBe(5);
    });
  });

  /* ==========================================================================
     THE UPDATE-DID-NOTHING BUG
     ========================================================================== */

  /**
   * Reproduced from the ACTUAL document in teacher-corner-dev, one question of
   * each of the five types, exactly as stored — because that is the shape that
   * broke it and a hand-written fixture had not.
   *
   * WHAT WENT WRONG. The copy taken when the wizard opened read
   *
   *   options: question.options ? question.options.map(…) : undefined
   *
   * A TEXT question has no `options`, so this ADDED an `options: undefined` key,
   * and the same for `blanks` and `subParts` on the types that lack them.
   * Firestore rejects `undefined` anywhere in a value tree and fails the entire
   * write, so Update Quiz did nothing on a document that was otherwise valid.
   */
  /**
   * REMOVING A FIELD FROM WHAT THIS APP WRITES IS NOT DESTROYING DATA IT DID NOT
   * CREATE, and this is the test that keeps the two apart.
   *
   * `optionalResource` is gone from the model: the Add Resources section was
   * excluded on instruction, so an empty array on every question was a key nothing
   * here could ever fill. But a quiz created in PRODUCTION carries real entries —
   * a YouTube link, a PDF under `quizzer_resources/` — and editing it in this app
   * must not silently drop them. clone()'s bare spread is what carries them
   * through as an unmodelled key.
   */
  describe('a stored resource list survives an edit', () => {

    /** A production question with two real resources, as its data has them. */
    function quizWithResources(): QuizAssignment {
      return {
        docId: 'prod-1',
        displayName: 'Case Study Quiz',
        type: 'QUIZ',
        status: 'LIVE',
        creator: 'Siddaveer Swamy',
        author: 'Siddaveer',
        ownerId: 'uid-1',
        createdAt: null,
        updatedAt: null,
        authenticationType: 'login',
        allowExitAndReEntry: false,
        displayCorrectAnswers: false,
        numberOfAllowedSubmissions: 1,
        totalDurationInHours: 0,
        totalDurationInMinutes: 0,
        totalDurationInSeconds: 0,
        backgroundInfo: { title: '', description: '', images: [] },
        questionsData: [
          {
            questionTitle: 'What happens to the colour?',
            questionType: 'MCQ',
            marks: 1,
            pedagogyType: 'FA',
            durationInHours: 0,
            durationInMinutes: 0,
            durationInSeconds: 0,
            oneCorrectOption: true,
            options: [{ name: 'Blue', isCorrect: true, optionType: 'TEXT', imagePath: '' }],
            // Not in the interface any more; a stored document still has it.
            optionalResource: [
              {
                resourceName: 'Video Testing',
                resourcePath: 'https://www.youtube.com/watch?v=aG3WkJfy-_U',
                type: 'VIDEO'
              },
              {
                resourceName: 'Additional Resource',
                resourcePath: 'quizzer_resources/Observation Sheet Template.pdf',
                type: 'PDF'
              }
            ]
          }
        ]
      } as unknown as QuizAssignment;
    }

    /** Mounts with a stored quiz, the way the neighbouring block does. */
    async function mountStored(): Promise<{
      component: QuizWizard;
      saved: QuizAssignment[];
    }> {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [QuizWizard],
        providers: [{ provide: AuthService, useValue: new StubAuthService() }]
      }).compileComponents();

      const fixture = TestBed.createComponent(QuizWizard);
      const component = fixture.componentInstance;
      const saved: QuizAssignment[] = [];

      component.submitted.subscribe(draft => saved.push(draft as QuizAssignment));
      fixture.componentRef.setInput('quiz', quizWithResources());
      fixture.detectChanges();

      return { component, saved };
    }

    it('carries production\'s resources through an edit untouched', async () => {
      const { component, saved } = await mountStored();

      // Edit something else entirely, then save.
      component.displayName.set('Case Study Quiz v2');
      component.step.set(4);
      component.save();

      expect(saved.length).toBe(1);

      const question = saved[0].questionsData[0] as unknown as Record<string, unknown>;
      const resources = question['optionalResource'] as Record<string, string>[];

      expect(resources).toBeDefined();
      expect(resources.length).toBe(2);
      expect(resources[0]['resourcePath'])
        .toBe('https://www.youtube.com/watch?v=aG3WkJfy-_U');
      expect(resources[1]['type']).toBe('PDF');
    });

    /** And a NEW question beside it still gets no such key. */
    it('does not add the key to a question created here', async () => {
      const { component, saved } = await mountStored();

      component.addQuestion('TEXT');
      component.setQuestionTitle(1, 'A new one');
      component.step.set(4);
      component.save();

      const created = saved[0].questionsData[1] as unknown as Record<string, unknown>;

      expect('optionalResource' in created).toBe(false);
    });
  });

  describe('loading the real stored quiz', () => {

    /** One of each type, keys exactly as the live document carries them. */
    function liveQuiz(): QuizAssignment {
      const timing = { durationInHours: 0, durationInMinutes: 0, durationInSeconds: 0 };
      const option = (name: string, isCorrect: boolean) =>
        ({ name, isCorrect, optionType: 'TEXT', imagePath: '' });

      return {
        docId: 'BpZaZnFfbdJgp2Cx0Pdw',
        displayName: 'Singing',
        type: 'QUIZ',
        status: 'LIVE',
        creator: 'Divya Jain',
        author: 'shaa',
        ownerId: 'uid-1',
        createdAt: null,
        updatedAt: null,
        authenticationType: 'login',
        allowExitAndReEntry: false,
        displayCorrectAnswers: false,
        numberOfAllowedSubmissions: 1,
        totalDurationInHours: 0,
        totalDurationInMinutes: 0,
        totalDurationInSeconds: 0,
        backgroundInfo: { title: 'lyrics', description: '', images: [] },
        questionsData: [
          {
            ...timing, questionTitle: "Who's Shawn Mendes?", questionType: 'MCQ',
            marks: 1, pedagogyType: 'FA', hasSubParts: false,
            subParts: [], oneCorrectOption: true,
            options: [option('', false), option('Singer', true), option('', false)]
          },
          {
            ...timing, questionTitle: "Whose Song is this 'TREAT YOU BETTER'?",
            questionType: 'FILL_IN_THE_BLANKS', marks: 1, pedagogyType: 'FA',
            hasSubParts: false, subParts: [],
            blanks: { optionsBlank1: [option('Shawn Mendes', true), option('', false)] }
          },
          {
            ...timing, questionTitle: "Who's Spider-man in real life?",
            questionType: 'TEXT', marks: 1, pedagogyType: 'FA',
            hasSubParts: false, subParts: [],
            answer: 'Tom Holland', maxCharLength: 400
          },
          {
            ...timing, questionTitle: 'Where is LA?', questionType: 'RICH_BLANKS',
            marks: 1, pedagogyType: 'FA', hasSubParts: false,
            subParts: [],
            blanks: { 'blank a': [option('', false), option('America', true)] }
          },
          {
            ...timing, questionTitle: 'Explain Games of Thrones .',
            questionType: 'DESCRIPTIVE', marks: 1, pedagogyType: 'FA',
            hasSubParts: false, subParts: [],
            answer: 'A show', maxCharLength: 2000
          }
        ]
      };
    }

    async function mountLive(): Promise<{ component: QuizWizard; saved: QuizAssignment[] }> {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [QuizWizard],
        providers: [{ provide: AuthService, useValue: new StubAuthService() }]
      }).compileComponents();

      const fixture = TestBed.createComponent(QuizWizard);
      const component = fixture.componentInstance;
      const saved: QuizAssignment[] = [];

      component.submitted.subscribe(draft => saved.push(draft as QuizAssignment));
      fixture.componentRef.setInput('quiz', liveQuiz());
      fixture.detectChanges();

      return { component, saved };
    }

    it('loads all five questions and both steps validate', async () => {
      const { component } = await mountLive();

      expect(component.questions().length).toBe(5);
      expect(component.stepOneValid()).toBe(true);
      expect(component.stepThreeValid()).toBe(true);
    });

    /**
     * NO `undefined` ANYWHERE in what is emitted. This is the assertion that
     * would have caught the bug: it walks the whole value tree, because the
     * offending key was three levels down inside an array.
     */
    it('emits a payload with no undefined at any depth', async () => {
      const { component, saved } = await mountLive();

      component.save();

      expect(saved.length).toBe(1);

      const paths: string[] = [];
      const walk = (value: unknown, path: string): void => {
        if (value === undefined) {
          paths.push(path);
          return;
        }
        if (Array.isArray(value)) {
          value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
          return;
        }
        if (value !== null && typeof value === 'object' && value.constructor === Object) {
          for (const [key, entry] of Object.entries(value)) {
            walk(entry, `${path}.${key}`);
          }
        }
      };

      walk(saved[0], 'quiz');

      expect(paths).toEqual([]);
    });

    /** A type that has no options must not GAIN an options key on the way through. */
    it('does not invent keys the stored question does not have', async () => {
      const { component, saved } = await mountLive();

      component.save();
      const [mcq, fill, text] = saved[0].questionsData;

      expect('options' in mcq).toBe(true);
      expect('options' in text).toBe(false);
      expect('blanks' in text).toBe(false);
      expect('blanks' in fill).toBe(true);
      expect('options' in fill).toBe(false);
    });

    /** And the content itself survives the round trip unchanged. */
    it('keeps every question\'s content', async () => {
      const { component, saved } = await mountLive();

      component.save();
      const questions = saved[0].questionsData;

      expect(questions.map(q => q.questionType)).toEqual([
        'MCQ', 'FILL_IN_THE_BLANKS', 'TEXT', 'RICH_BLANKS', 'DESCRIPTIVE'
      ]);
      expect(questions[0].options?.[1].name).toBe('Singer');
      expect(questions[1].blanks?.['optionsBlank1'][0].isCorrect).toBe(true);
      expect(questions[2].answer).toBe('Tom Holland');
      expect(questions[3].blanks?.['blank a'][1].name).toBe('America');
      expect(questions[4].maxCharLength).toBe(2000);
    });
  });
});

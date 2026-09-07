import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';

import { Icon } from '../../components/icon/icon';
import { RichText } from '../../components/rich-text/rich-text';
import {
  AssignmentOption,
  QuizAssignment,
  QuizQuestion,
  QuizSubPart,
  emptyOption,
  emptyQuizPayload,
  emptyQuizQuestion
} from '../../models/teaching.model';
import { AuthService } from '../../services/auth.service';
import { ConfigurationService } from '../../services/configuration.service';

/** The four steps, in production's order. Labels are for the stepper's tooltip. */
export const QUIZ_STEPS = [
  { index: 1, label: 'Basic Info' },
  { index: 2, label: 'Background / Case Study' },
  { index: 3, label: 'Questions' },
  { index: 4, label: 'Review' }
] as const;

/** What the wizard emits: a complete quiz, minus what the service supplies. */
export type QuizDraft = Omit<QuizAssignment, 'docId' | 'ownerId' | 'createdAt' | 'updatedAt'>;

/**
 * Create Quiz — production's four-step dialog.
 *
 *   1  Basic Info                title, submissions, creator, author, auth type,
 *                                status, total duration, exit/re-entry, answers
 *   2  Background / Case Study   optional, and SKIPPABLE — its own Skip button
 *   3  Questions                 add one at a time, five types
 *   4  Review                    every field and every question, then Save Quiz
 *
 * WHAT IS DELIBERATELY NOT BUILT, and both were called out rather than dropped
 * quietly:
 *
 *   - "Add Resources (Optional)" per question. Excluded on instruction, and the
 *     field is now GONE rather than written empty: a `optionalResource: []` on
 *     every question was a key nothing in this app could ever fill. A quiz created
 *     in production keeps whatever it already has — see clone().
 *
 *   - Inline image and PDF insertion in the rich-text fields. That needs an
 *     upload per insertion; see the note on RichText. Formatting works, and HTML
 *     written by production — images included — renders and round-trips.
 *
 * ZONELESS. Every field the template reads is a signal, and the question list is
 * replaced rather than mutated so the template sees each change.
 */
@Component({
  selector: 'app-quiz-wizard',
  imports: [Icon, RichText],
  templateUrl: './quiz-wizard.html',
  styleUrl: './quiz-wizard.css',
  /*
   * Escape shuts the MENU first and the dialog only when no menu is open. Closing
   * a four-step form because the user dismissed a popover would throw away
   * everything typed into it.
   */
  host: { '(document:keydown.escape)': 'onEscape()' }
})
export class QuizWizard implements OnInit {

  /**
   * The quiz being edited, or null to create one.
   *
   * ONE COMPONENT FOR BOTH, which is what production does: its dialog is the same
   * four steps titled "Edit Quiz" with "Update Quiz" at the end. A second
   * component would be the same 500 lines with the labels changed, and the first
   * field either of them gained would be missing from the other.
   */
  readonly quiz = input<QuizAssignment | null>(null);

  readonly saving = input(false);
  readonly error = input('');

  readonly submitted = output<QuizDraft>();
  readonly closed = output<void>();

  /* Injections first: the option lists below read from the configuration
     service, and a field cannot use one declared after it. */
  private auth = inject(AuthService);
  private config = inject(ConfigurationService);

  readonly steps = QUIZ_STEPS;
  /*
   * FROM CONFIGURATION, not from the constants any more. Each is a signal on the
   * service, so a Firestore edit reaches these dropdowns without a release; the
   * constants they used to read are now the fallback when the read is refused.
   */
  readonly statuses = this.config.assignmentStatuses;
  readonly authTypes = this.config.quizAuthTypes;
  readonly pedagogyTypes = this.config.quizPedagogyTypes;
  readonly questionTypes = this.config.quizQuestionTypes;

  readonly step = signal(1);

  readonly isEdit = computed(() => this.quiz() !== null);

  readonly heading = computed(() => (this.isEdit() ? 'Edit Quiz' : 'Create Quiz'));

  /** 'Update Quiz' when editing, as production's final button reads. */
  readonly saveLabel = computed(() => (this.isEdit() ? 'Update Quiz' : 'Save Quiz'));

  /**
   * Loads the stored quiz into the form.
   *
   * ngOnInit, NOT the constructor: a signal input is not bound until after
   * construction, so reading `quiz()` there would see null for an edit and open an
   * empty form over an existing document — which the first save would then
   * overwrite with nothing. The same timing trap the programme wizard's code
   * preview hit.
   *
   * The questions are COPIED, not referenced. They are nested objects on an input,
   * and editing them in place would mutate the row the table is rendering — so the
   * list would show unsaved edits, and cancelling would not undo them.
   */
  ngOnInit(): void {
    const existing = this.quiz();

    if (!existing) {
      return;
    }

    this.displayName.set(existing.displayName);
    this.author.set(existing.author);
    this.status.set(existing.status);
    this.authenticationType.set(existing.authenticationType);
    this.numberOfAllowedSubmissions.set(Number(existing.numberOfAllowedSubmissions) || 1);
    this.totalDurationInHours.set(Number(existing.totalDurationInHours) || 0);
    this.totalDurationInMinutes.set(Number(existing.totalDurationInMinutes) || 0);
    this.totalDurationInSeconds.set(Number(existing.totalDurationInSeconds) || 0);
    this.allowExitAndReEntry.set(existing.allowExitAndReEntry === true);
    this.displayCorrectAnswers.set(existing.displayCorrectAnswers === true);

    this.caseStudyTitle.set(existing.backgroundInfo?.title ?? '');
    this.caseStudyDescription.set(existing.backgroundInfo?.description ?? '');

    this.questions.set((existing.questionsData ?? []).map(question => this.clone(question)));
  }

  /**
   * A deep copy of one stored question — WITHOUT inventing keys it does not have.
   *
   * THE BUG THIS FIXES, and it made Update Quiz do nothing at all. The copy used
   * to read:
   *
   *   options: question.options ? question.options.map(…) : undefined
   *
   * A TEXT question has no `options`, so that ADDED an `options: undefined` key —
   * and the same for `blanks` and `subParts`. Firestore rejects `undefined`
   * anywhere in a value tree ("Unsupported field value: undefined"), so the whole
   * write failed on a document that was otherwise perfectly valid.
   *
   * Spreading and then replacing only what IS there cannot produce that: a key
   * absent from the source stays absent.
   */
  private clone(question: QuizQuestion): QuizQuestion {
    /*
     * THE BARE SPREAD IS WHAT KEEPS A STORED RESOURCE LIST ALIVE.
     *
     * This app no longer writes `optionalResource` — the Add Resources section was
     * excluded on instruction and the field has now been dropped from the model —
     * but a quiz created in production carries real entries there. Spreading the
     * stored question passes them through as an unmodelled key rather than
     * deleting links this app cannot show: removing a field from what this app
     * WRITES is not the same as destroying data it did not create.
     */
    const copy: QuizQuestion = { ...question };

    if (question.options) {
      copy.options = question.options.map(option => ({ ...option }));
    }

    if (question.subParts) {
      copy.subParts = question.subParts.map(part => ({
        ...part,
        options: (part.options ?? []).map(option => ({ ...option }))
      }));
    }

    if (question.blanks) {
      copy.blanks = Object.fromEntries(
        Object.entries(question.blanks).map(([key, choices]) => [
          key,
          choices.map(choice => ({ ...choice }))
        ])
      );
    }

    return copy;
  }

  /**
   * WHICH "Add New Question" button opened the menu, or null.
   *
   * A POSITION, NOT A BOOLEAN. There are two of these buttons — one above the
   * list and one below it, as production has — and a single boolean rendered the
   * menu only at the top, so clicking the lower one opened a menu several hundred
   * pixels up and usually scrolled out of view. Each button owns its own popover
   * now, and the bottom one opens UPWARD.
   */
  readonly typeMenuAt = signal<'top' | 'bottom' | null>(null);

  // ---- Step 1 ------------------------------------------------------------

  readonly displayName = signal('');
  readonly author = signal('');
  readonly numberOfAllowedSubmissions = signal(1);

  /**
   * UNSELECTED ON OPEN, both of them, as production's are: its step 1 shows
   * "Select" and "Select the status" with Next disabled. Status decides whether
   * classrooms can be set this immediately, which is not a choice to make on
   * someone's behalf.
   */
  readonly authenticationType = signal('');
  readonly status = signal('');

  readonly totalDurationInHours = signal(0);
  readonly totalDurationInMinutes = signal(0);
  readonly totalDurationInSeconds = signal(0);

  /**
   * Production renders these two as True/False SELECTS rather than checkboxes,
   * and the stored value is a boolean. Kept as selects so the form matches, with
   * the string converted on the way in.
   */
  readonly allowExitAndReEntry = signal(false);
  readonly displayCorrectAnswers = signal(false);

  /**
   * Read once and shown disabled — see the note on AssignmentBase.creator.
   *
   * ON AN EDIT THE STORED VALUE WINS. `creator` records who made the quiz, so
   * showing the current user's name while editing somebody else's would be wrong
   * on screen and, worse, would rewrite the field on save. A computed rather than
   * a plain field, because the input is not bound when the class is constructed.
   */
  readonly creator = computed(() => this.quiz()?.creator || this.auth.displayName());

  // ---- Step 2 ------------------------------------------------------------

  readonly caseStudyTitle = signal('');
  readonly caseStudyDescription = signal('');

  // ---- Step 3 ------------------------------------------------------------

  readonly questions = signal<QuizQuestion[]>([]);

  // ---- Validity ----------------------------------------------------------

  readonly stepOneValid = computed(() =>
    this.displayName().trim() !== '' &&
    this.author().trim() !== '' &&
    this.authenticationType() !== '' &&
    this.status() !== ''
  );

  /**
   * AT LEAST ONE QUESTION, and every one of them titled.
   *
   * Production lets a titleless question through and the quiz then renders a
   * blank prompt to a student, which is worse than a blocked Next. The rest of a
   * question — marks, options — has defaults that are usable as they stand.
   */
  readonly stepThreeValid = computed(() =>
    this.questions().length > 0 &&
    this.questions().every(question => this.isBlank(question.questionTitle) === false)
  );

  readonly continueBlocked = computed(() => {
    if (this.step() === 1) {
      return !this.stepOneValid();
    }

    // Step 2 is optional in full: it has a Skip button of its own.
    if (this.step() === 3) {
      return !this.stepThreeValid();
    }

    return false;
  });

  /** 'Hh Mm Ss', as the review step prints it. */
  readonly durationLabel = computed(
    () =>
      `${this.totalDurationInHours()}h ` +
      `${this.totalDurationInMinutes()}m ` +
      `${this.totalDurationInSeconds()}s`
  );

  readonly totalMarks = computed(() =>
    this.questions().reduce((sum, question) => sum + (Number(question.marks) || 0), 0)
  );

  // ---- Navigation --------------------------------------------------------

  next(): void {
    if (this.continueBlocked()) {
      return;
    }

    this.step.update(current => Math.min(current + 1, this.steps.length));
  }

  back(): void {
    this.step.update(current => Math.max(current - 1, 1));
  }

  /** Step 2's own button: leaves the case study empty and moves on. */
  skipBackground(): void {
    this.caseStudyTitle.set('');
    this.caseStudyDescription.set('');
    this.step.set(3);
  }

  isDone(index: number): boolean {
    return this.step() > index;
  }

  // ---- Questions ---------------------------------------------------------

  toggleTypeMenu(at: 'top' | 'bottom'): void {
    this.typeMenuAt.update(current => (current === at ? null : at));
  }

  closeTypeMenu(): void {
    this.typeMenuAt.set(null);
  }

  addQuestion(questionType: string): void {
    this.closeTypeMenu();
    this.questions.update(list => [...list, emptyQuizQuestion(questionType)]);
  }

  removeQuestion(index: number): void {
    this.questions.update(list => list.filter((_unused, position) => position !== index));
  }

  /**
   * Replaces one question with an edited copy.
   *
   * REPLACED, NOT MUTATED. The array is a signal, and mutating an entry in place
   * changes nothing the template is watching — the reference is the same, so
   * nothing re-renders. Every edit below goes through here.
   */
  private patchQuestion(index: number, patch: Partial<QuizQuestion>): void {
    this.questions.update(list =>
      list.map((question, position) =>
        position === index ? { ...question, ...patch } : question
      )
    );
  }

  setQuestionTitle(index: number, html: string): void {
    this.patchQuestion(index, { questionTitle: html });
  }

  setQuestionField(index: number, field: 'marks' | 'maxCharLength', value: string): void {
    this.patchQuestion(index, { [field]: Number(value) || 0 });
  }

  setQuestionText(index: number, field: 'pedagogyType' | 'answer', value: string): void {
    this.patchQuestion(index, { [field]: value });
  }

  setQuestionDuration(
    index: number,
    field: 'durationInHours' | 'durationInMinutes' | 'durationInSeconds',
    value: string
  ): void {
    this.patchQuestion(index, { [field]: Number(value) || 0 });
  }

  labelFor(questionType: string): string {
    return this.questionTypes().find(entry => entry.type === questionType)?.label ?? questionType;
  }

  /** Whether this type asks for options — only MCQ does. */
  hasOptions(question: QuizQuestion): boolean {
    return question.questionType === 'MCQ';
  }

  /**
   * Whether an MCQ has no correct option ticked.
   *
   * WORTH WARNING ABOUT ON REVIEW, and the reason is concrete: a quiz saved this
   * way cannot be marked, and nothing on the review says so — four options with no
   * tick look the same as four options you have not scrolled to yet. It surfaced
   * when a quiz with five such questions was run and reported "0 of 5 marks",
   * which reads as every answer being wrong.
   *
   * NOT AN ERROR, so it does not block saving: a quiz can legitimately be built
   * before its answers are decided, and production does not require them either.
   */
  missingCorrectOption(question: QuizQuestion): boolean {
    return (
      question.questionType === 'MCQ' &&
      (question.options ?? []).length > 0 &&
      !(question.options ?? []).some(option => option.isCorrect)
    );
  }

  /** Whether this type asks for a model answer — TEXT and DESCRIPTIVE. */
  hasAnswer(question: QuizQuestion): boolean {
    return question.questionType === 'TEXT' || question.questionType === 'DESCRIPTIVE';
  }

  /** Whether this type collects blanks — both blank types. */
  hasBlanks(question: QuizQuestion): boolean {
    return (
      question.questionType === 'FILL_IN_THE_BLANKS' ||
      question.questionType === 'RICH_BLANKS'
    );
  }

  // ---- Options -----------------------------------------------------------

  addOption(index: number): void {
    const question = this.questions()[index];

    this.patchQuestion(index, { options: [...(question.options ?? []), emptyOption()] });
  }

  removeOption(index: number, optionIndex: number): void {
    const question = this.questions()[index];

    this.patchQuestion(index, {
      options: (question.options ?? []).filter((_unused, position) => position !== optionIndex)
    });
  }

  setOptionText(index: number, optionIndex: number, value: string): void {
    this.editOption(index, optionIndex, { name: value });
  }

  setOptionType(index: number, optionIndex: number, value: string): void {
    this.editOption(index, optionIndex, { optionType: value });
  }

  setOptionImage(index: number, optionIndex: number, value: string): void {
    this.editOption(index, optionIndex, { imagePath: value });
  }

  /**
   * Marks an option correct.
   *
   * WITH `oneCorrectOption` OFF, this toggles that option alone — several can be
   * right. WITH IT ON, choosing one clears the others, because a single-answer
   * question with two correct options cannot be marked at all and nothing else in
   * the form would show the contradiction.
   */
  markCorrect(index: number, optionIndex: number): void {
    const question = this.questions()[index];
    const single = question.oneCorrectOption !== false;

    this.patchQuestion(index, {
      options: (question.options ?? []).map((option, position) =>
        position === optionIndex
          ? { ...option, isCorrect: single ? true : !option.isCorrect }
          : single
            ? { ...option, isCorrect: false }
            : option
      )
    });
  }

  /**
   * The "Multiple Correct Options" toggle.
   *
   * Turning it OFF keeps only the FIRST correct option. Leaving several ticked
   * under a single-answer rule is the same contradiction markCorrect avoids, and
   * silently keeping them would surface later as an unmarkable question.
   */
  toggleMultipleCorrect(index: number): void {
    const question = this.questions()[index];
    const nextSingle = question.oneCorrectOption === false;

    let seen = false;
    const options = (question.options ?? []).map(option => {
      if (!nextSingle || !option.isCorrect) {
        return option;
      }

      if (seen) {
        return { ...option, isCorrect: false };
      }

      seen = true;
      return option;
    });

    this.patchQuestion(index, { oneCorrectOption: nextSingle, options });
  }

  isSingleAnswer(question: QuizQuestion): boolean {
    return question.oneCorrectOption !== false;
  }

  private editOption(
    index: number,
    optionIndex: number,
    patch: Partial<AssignmentOption>
  ): void {
    const question = this.questions()[index];

    this.patchQuestion(index, {
      options: (question.options ?? []).map((option, position) =>
        position === optionIndex ? { ...option, ...patch } : option
      )
    });
  }

  // ---- Blanks ------------------------------------------------------------

  blankLabels(question: QuizQuestion): string[] {
    return Object.keys(question.blanks ?? {});
  }

  /**
   * Adds a blank, named the way the type names them.
   *
   * FILL_IN_THE_BLANKS uses 'optionsBlank1', 'optionsBlank2' — production's own
   * keys, matched exactly, because the player looks them up by name. RICH_BLANKS
   * uses 'blank a', 'blank b', which is the label the author writes into the HTML.
   */
  addBlank(index: number): void {
    const question = this.questions()[index];
    const blanks = { ...(question.blanks ?? {}) };
    const count = Object.keys(blanks).length;

    const key =
      question.questionType === 'RICH_BLANKS'
        ? `blank ${String.fromCharCode(97 + count)}`
        : `optionsBlank${count + 1}`;

    blanks[key] = [emptyOption(true), emptyOption()];
    this.patchQuestion(index, { blanks });
  }

  removeBlank(index: number, key: string): void {
    const question = this.questions()[index];
    const blanks = { ...(question.blanks ?? {}) };

    delete blanks[key];
    this.patchQuestion(index, { blanks });
  }

  addBlankOption(index: number, key: string): void {
    this.withBlank(index, key, options => [...options, emptyOption()]);
  }

  removeBlankOption(index: number, key: string, optionIndex: number): void {
    this.withBlank(index, key, options =>
      options.filter((_unused, position) => position !== optionIndex)
    );
  }

  setBlankOptionText(index: number, key: string, optionIndex: number, value: string): void {
    this.withBlank(index, key, options =>
      options.map((option, position) =>
        position === optionIndex ? { ...option, name: value } : option
      )
    );
  }

  /** One right answer per blank — a blank with two is unanswerable. */
  markBlankCorrect(index: number, key: string, optionIndex: number): void {
    this.withBlank(index, key, options =>
      options.map((option, position) => ({ ...option, isCorrect: position === optionIndex }))
    );
  }

  private withBlank(
    index: number,
    key: string,
    change: (options: AssignmentOption[]) => AssignmentOption[]
  ): void {
    const question = this.questions()[index];
    const blanks = { ...(question.blanks ?? {}) };

    blanks[key] = change(blanks[key] ?? []);
    this.patchQuestion(index, { blanks });
  }

  // ---- Sub-questions -----------------------------------------------------

  /**
   * The "Enable Sub-questions" toggle.
   *
   * Turning it on seeds ONE part labelled 'a', because an enabled toggle with no
   * parts reads as a broken control. Turning it off EMPTIES the array as well as
   * clearing the flag: production reads `subParts` and would render orphaned
   * parts for a question whose flag says it has none.
   */
  toggleSubParts(index: number): void {
    const question = this.questions()[index];
    const enabled = question.hasSubParts === true;

    this.patchQuestion(index, {
      hasSubParts: !enabled,
      subParts: enabled ? [] : [this.newSubPart(0)]
    });
  }

  addSubPart(index: number): void {
    const question = this.questions()[index];
    const parts = question.subParts ?? [];

    this.patchQuestion(index, { subParts: [...parts, this.newSubPart(parts.length)] });
  }

  removeSubPart(index: number, partIndex: number): void {
    const question = this.questions()[index];

    this.patchQuestion(index, {
      subParts: (question.subParts ?? [])
        .filter((_unused, position) => position !== partIndex)
        // RELABELLED after a removal, so the letters stay a, b, c rather than
        // leaving a gap where the deleted part was.
        .map((part, position) => ({ ...part, label: String.fromCharCode(97 + position) }))
    });
  }

  setSubPartField(
    index: number,
    partIndex: number,
    field: 'subPartTitle' | 'marks',
    value: string
  ): void {
    const question = this.questions()[index];

    this.patchQuestion(index, {
      subParts: (question.subParts ?? []).map((part, position) =>
        position === partIndex
          ? { ...part, [field]: field === 'marks' ? Number(value) || 0 : value }
          : part
      )
    });
  }

  /** The parts' marks, summed. Production prints this under the list. */
  subPartMarks(question: QuizQuestion): number {
    return (question.subParts ?? []).reduce((sum, part) => sum + (Number(part.marks) || 0), 0);
  }

  addSubPartOption(index: number, partIndex: number): void {
    this.withSubPart(index, partIndex, part => ({
      ...part,
      options: [...(part.options ?? []), emptyOption()]
    }));
  }

  removeSubPartOption(index: number, partIndex: number, optionIndex: number): void {
    this.withSubPart(index, partIndex, part => ({
      ...part,
      options: (part.options ?? []).filter((_unused, position) => position !== optionIndex)
    }));
  }

  setSubPartOptionText(
    index: number,
    partIndex: number,
    optionIndex: number,
    value: string
  ): void {
    this.withSubPart(index, partIndex, part => ({
      ...part,
      options: (part.options ?? []).map((option, position) =>
        position === optionIndex ? { ...option, name: value } : option
      )
    }));
  }

  /** The same single-answer rule the parent question's options follow. */
  markSubPartCorrect(index: number, partIndex: number, optionIndex: number): void {
    this.withSubPart(index, partIndex, part => {
      const single = part.oneCorrectOption !== false;

      return {
        ...part,
        options: (part.options ?? []).map((option, position) =>
          position === optionIndex
            ? { ...option, isCorrect: single ? true : !option.isCorrect }
            : single
              ? { ...option, isCorrect: false }
              : option
        )
      };
    });
  }

  /** And the same "keep only the first" rule when the toggle goes off. */
  toggleSubPartMultiple(index: number, partIndex: number): void {
    this.withSubPart(index, partIndex, part => {
      const nextSingle = part.oneCorrectOption === false;
      let seen = false;

      const options = (part.options ?? []).map(option => {
        if (!nextSingle || !option.isCorrect) {
          return option;
        }

        if (seen) {
          return { ...option, isCorrect: false };
        }

        seen = true;
        return option;
      });

      return { ...part, oneCorrectOption: nextSingle, options };
    });
  }

  private withSubPart(
    index: number,
    partIndex: number,
    change: (part: QuizSubPart) => QuizSubPart
  ): void {
    const question = this.questions()[index];

    this.patchQuestion(index, {
      subParts: (question.subParts ?? []).map((part, position) =>
        position === partIndex ? change(part) : part
      )
    });
  }

  private newSubPart(position: number): QuizSubPart {
    return {
      label: String.fromCharCode(97 + position),
      subPartTitle: '',
      marks: 1,
      oneCorrectOption: true,
      options: []
    };
  }

  // ---- Save --------------------------------------------------------------

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  /** Production's selects hold the strings 'true' and 'false'. */
  boolFrom(value: string): boolean {
    return value === 'true';
  }

  /**
   * NAVIGATES TO THE PROBLEM rather than returning silently.
   *
   * This used to be a bare `return` when anything was invalid, and that is half of
   * why a failed Update read as "the button does nothing": the click had no
   * visible effect at all, on step 4, with the offending field two steps back.
   * Jumping to the step that is blocking makes the refusal legible.
   */
  save(): void {
    if (this.saving()) {
      return;
    }

    if (!this.stepOneValid()) {
      this.step.set(1);
      return;
    }

    if (!this.stepThreeValid()) {
      this.step.set(3);
      return;
    }

    this.submitted.emit({
      ...emptyQuizPayload(),
      type: 'QUIZ',
      displayName: this.displayName().trim(),
      author: this.author().trim(),
      creator: this.creator(),
      status: this.status(),
      authenticationType: this.authenticationType(),
      numberOfAllowedSubmissions: this.numberOfAllowedSubmissions(),
      totalDurationInHours: this.totalDurationInHours(),
      totalDurationInMinutes: this.totalDurationInMinutes(),
      totalDurationInSeconds: this.totalDurationInSeconds(),
      allowExitAndReEntry: this.allowExitAndReEntry(),
      displayCorrectAnswers: this.displayCorrectAnswers(),
      backgroundInfo: {
        title: this.caseStudyTitle().trim(),
        description: this.caseStudyDescription(),
        /*
         * CARRIED THROUGH ON AN EDIT, not blanked.
         *
         * This app cannot insert inline media, but a quiz written by production
         * has entries here — and writing [] would delete files the case study's
         * HTML still references, leaving broken images in the description with no
         * way to put them back.
         */
        images: [...(this.quiz()?.backgroundInfo?.images ?? [])]
      },
      questionsData: this.questions()
    });
  }

  close(): void {
    this.closed.emit();
  }

  onEscape(): void {
    if (this.typeMenuAt() !== null) {
      this.closeTypeMenu();
      return;
    }

    this.close();
  }

  /** Strips the markup a browser leaves behind, so '<p><br></p>' counts as empty. */
  private isBlank(html: string): boolean {
    return (html ?? '').replace(/<br\s*\/?>|<\/?[a-z][^>]*>|&nbsp;|\s/gi, '') === '';
  }

  /** The review step shows titles as text, so the HTML has to come off. */
  plainText(html: string): string {
    return (html ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

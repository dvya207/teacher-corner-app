import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';

import { Icon } from '../../components/icon/icon';
import {
  FormAssignment,
  FormQuestion,
  emptyFormPayload,
  emptyFormQuestion
} from '../../models/teaching.model';
import { AuthService } from '../../services/auth.service';
import { ConfigurationService } from '../../services/configuration.service';
import { splitOptions } from '../../services/form-submission.service';

/**
 * The form question types whose options are authored as ROWS and stored as an
 * ARRAY, rather than typed into one comma separated box.
 *
 * A SET RATHER THAN A LITERAL PER SITE, because four places branch on this and a
 * typo in any of them would silently fall back to the comma text field, which
 * looks like nothing more than a styling glitch until an option with a comma in
 * it splits in two.
 *
 * The two differ only in how many options may be picked, which is the PLAYER's
 * concern. Authoring them is identical, so they share one editor.
 */
const ROW_OPTION_TYPES: ReadonlySet<string> = new Set([
  'checkBoxGroup',
  'radioGroup'
]);

/** Whether a type's options are authored as rows. */
function hasOptionRows(questionType: string): boolean {
  return ROW_OPTION_TYPES.has(questionType);
}

/**
 * The stored options, in the shape the type's own editor edits.
 *
 * `checkBoxGroup` IS EDITED AS ROWS and so wants an array, whatever the document
 * happens to carry: a question authored before this type existed, or edited by
 * hand, can hold the comma string, and the row editor has to be able to open it.
 * Every other type is edited in a text field and so wants the string, because an
 * array reaching a text input renders as '[object Object]'.
 */
function normaliseOptions(
  stored: string | string[] | undefined,
  questionType: string
): string | string[] {
  if (hasOptionRows(questionType)) {
    return Array.isArray(stored) ? stored : splitOptions(stored);
  }

  return Array.isArray(stored) ? stored.join(',') : (stored ?? '');
}

/** The three steps, in production's order. Labels are the stepper's tooltips. */
export const FORM_STEPS = [
  { index: 1, label: 'Basic Info' },
  { index: 2, label: 'Questions' },
  { index: 3, label: 'Review' }
] as const;

/** What the wizard emits: a whole form, minus what the service supplies. */
export type FormDraft = Omit<
  FormAssignment,
  'docId' | 'ownerId' | 'createdAt' | 'updatedAt'
>;

/**
 * Create Form Assignment — production's three-step dialog.
 *
 *   1  Basic Info   FOUR FIELDS ONLY: name, creator, author, status
 *   2  Questions    the instructions sentence, then a block per question
 *   3  Review       the fields and every question with its type, then Save Form
 *
 * STEP ONE IS SHORTER THAN THE OTHER TWO WIZARDS', and that is production's own
 * shape rather than an omission: a form has no submission count and no duration.
 * The newest form documents carry exactly eight keys — author, creator,
 * displayName, docId, instructions, status, type, updatedAt — and adding the
 * fields the quiz and upload dialogs collect would write a document unlike any
 * production has.
 *
 * WHAT A QUESTION STORES was read off the live collection, and three details are
 * load-bearing:
 *
 *   - ALL NINE KEYS ON EVERY QUESTION, whatever the type. A `text` question still
 *     carries the three dropDown fields as empty strings. See emptyFormQuestion.
 *
 *   - THE THREE DROPDOWN VARIANTS EACH FILL A DIFFERENT FIELD, and they are not
 *     interchangeable:
 *       dropDown           dropDownOptions           'Yes,No'
 *       dropDownDynamic    dropDownOptionsDynamic    'RYSI_Categories,subjects'
 *       dropDownDependent  dropDownOptionsDependent  'RYSI_Categories,rysiCategoryMap,categories'
 *     Comma-separated in all three cases, but meaning different things: a list of
 *     options, a collection and field, a collection and map and key.
 *
 *   - `questionType` IS LOWERCASE HERE. A quiz question's is uppercase ('MCQ');
 *     a form's is camelCase ('dropDownDependent'). Same idea, different casing,
 *     and production's player matches on the stored string.
 *
 * ZONELESS. Every field the template reads is a signal, and the question list is
 * replaced rather than mutated so the template sees each change.
 */
@Component({
  selector: 'app-form-wizard',
  imports: [Icon],
  templateUrl: './form-wizard.html',
  styleUrl: './form-wizard.css',
  host: { '(document:keydown.escape)': 'close()' }
})
export class FormWizard implements OnInit {

  /** The row being edited, or null to create one. */
  readonly assignment = input<FormAssignment | null>(null);

  readonly saving = input(false);
  readonly error = input('');

  readonly submitted = output<FormDraft>();
  readonly closed = output<void>();

  /* Injections first: the option lists below read from the configuration
     service, and a field cannot use one declared after it. */
  private auth = inject(AuthService);
  private config = inject(ConfigurationService);

  readonly steps = FORM_STEPS;
  /* From Configuration/AssignmentStatuses; the constant is now the fallback. */
  readonly statuses = this.config.assignmentStatuses;

  /**
   * The seven question types, from Configuration/AssignmentTypes.questionTypesForm.
   *
   * Read through the service so a type added to that document appears without a
   * release. Production's own order and spellings: Display Only, Text Field, Text
   * Box, Drop Down, Star Rating, Drop Down (Dynamic), Drop Down (Dependent).
   */
  readonly questionTypes = this.config.formQuestionTypes;

  readonly step = signal(1);

  readonly displayName = signal('');
  readonly author = signal('');

  /** Unselected on open, as production's does. Status is not ours to assume. */
  readonly status = signal('');

  /**
   * The sentence production prefills on step 2, FROM CONFIGURATION.
   *
   * `emptyFormPayload()` remains the fallback and is still what the saved document
   * carries if this is never touched, so the two cannot drift into disagreement
   * about what a new form says.
   */
  readonly instructions = signal(
    this.config.assignmentDefaults().formInstructions ?? emptyFormPayload().instructions
  );

  /**
   * One question to begin with.
   *
   * Production opens step 2 with NO questions and only the `+` button, then adds
   * the first block when it is pressed. Starting with one is the single departure
   * here, and a small one: an empty panel with one round button reads as a dialog
   * that has not finished loading, and the first thing anyone does is press it.
   */
  readonly questions = signal<FormQuestion[]>([emptyFormQuestion(1)]);

  readonly isEdit = computed(() => this.assignment() !== null);

  readonly heading = computed(() =>
    this.isEdit() ? 'Edit Form Assignment' : 'Create Form Assignment'
  );

  /** 'Save Form' is production's own label, and it is correct on a form. */
  readonly saveLabel = computed(() => (this.isEdit() ? 'Update Form' : 'Save Form'));

  /**
   * The signed-in teacher's name, shown disabled.
   *
   * A snapshot, as production takes one: `creator` records who made the
   * assignment, so an edit by somebody else keeps the original name.
   */
  readonly creator = computed(() => this.assignment()?.creator || this.auth.displayName());

  /**
   * Loads the stored form.
   *
   * ngOnInit, NOT the constructor: a signal input is not bound until after
   * construction, so reading `assignment()` there would see null on an edit and
   * open an empty dialog over a real document, which the first save would then
   * overwrite with nothing.
   *
   * The questions are COPIED. They are objects on an input and the row is what the
   * table is rendering, so editing them in place would show unsaved changes in the
   * list and cancelling would not undo them.
   */
  ngOnInit(): void {
    const existing = this.assignment();

    if (!existing) {
      return;
    }

    this.displayName.set(existing.displayName);
    this.author.set(existing.author);
    this.status.set(existing.status);
    this.instructions.set(existing.instructions ?? '');

    const stored = (existing.questions ?? []).map((question, index) =>
      this.clone(question, index)
    );

    this.questions.set(stored.length > 0 ? stored : [emptyFormQuestion(1)]);
  }

  /**
   * A copy of one stored question, with the nine fields normalised.
   *
   * KEYS THIS APP DOES NOT MODEL ARE SPREAD THROUGH, not dropped: older questions
   * carry `options` and `allowMultiple` from an `mcq` type this dialog does not
   * offer, and dropping them on read would delete them on the next save.
   *
   * `dropDownOptions` IS NORMALISED TO THE SHAPE ITS TYPE EDITS, because the
   * collection holds both a string and an array for it. `checkBoxGroup` is edited
   * one option per row and so wants an array; every other type is edited in a
   * text field and so wants the comma separated string. Handing either editor the
   * other's shape is what rendered '[object Object]' in the box before.
   *
   * `questionNumber` is re-derived from the position rather than trusted, so a gap
   * left by an old removal cannot survive into the saved document.
   */
  private clone(question: FormQuestion, index: number): FormQuestion {
    const options = question.dropDownOptions;

    return {
      ...question,
      questionType: question.questionType ?? '',
      questionNumber: index + 1,
      question: question.question ?? '',
      prompt: question.prompt ?? '',
      isSubquestion: question.isSubquestion === true,
      dropDownOptions: normaliseOptions(options, question.questionType ?? ''),
      dropDownOptionsDynamic: question.dropDownOptionsDynamic ?? '',
      dropDownOptionsDependent: question.dropDownOptionsDependent ?? '',
      fieldIcon: question.fieldIcon ?? ''
    };
  }

  // ---- Validation --------------------------------------------------------

  readonly stepOneValid = computed(() =>
    this.displayName().trim() !== '' &&
    this.author().trim() !== '' &&
    this.status() !== ''
  );

  /**
   * Every question needs text AND a type.
   *
   * The type especially: production's select opens on "Select the question type",
   * and a question saved with an empty type is one its player cannot render at all
   * — it would appear in the form as a labelled gap.
   */
  readonly stepTwoValid = computed(() =>
    this.questions().length > 0 &&
    this.questions().every(
      question => question.question.trim() !== '' && question.questionType !== ''
    )
  );

  readonly continueBlocked = computed(() => {
    if (this.step() === 1) {
      return !this.stepOneValid();
    }

    if (this.step() === 2) {
      return !this.stepTwoValid();
    }

    return false;
  });

  /**
   * WHY NEXT IS REFUSING, named.
   *
   * Less acute here than in the upload wizard, where one slot shows at a time and
   * the offending one can be off screen entirely — every question is visible on
   * this step. It is still worth saying: with eight questions the one missing a
   * type is a scroll away, and a disabled button that cannot explain itself reads
   * as a broken one either way.
   */
  private readonly incomplete = computed(() =>
    this.questions()
      .map((question, index) => ({ index, question, missing: this.missingFor(question) }))
      .filter(entry => entry.missing.length > 0)
  );

  /** What one question is still missing, in the order its fields appear. */
  missingFor(question: FormQuestion): string[] {
    const missing: string[] = [];

    if (question.question.trim() === '') {
      missing.push('its text');
    }

    if (question.questionType === '') {
      missing.push('a type');
    }

    return missing;
  }

  readonly blockedReason = computed(() => {
    const first = this.incomplete()[0];

    if (!first || this.step() !== 2) {
      return '';
    }

    return `Question ${first.index + 1} needs ${this.listOf(first.missing)}.`;
  });

  readonly alsoIncomplete = computed(() => Math.max(this.incomplete().length - 1, 0));

  /** 'its text and a type' — an Oxford-less list, as English reads. */
  private listOf(items: string[]): string {
    if (items.length <= 1) {
      return items[0] ?? '';
    }

    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
  }

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

  isDone(index: number): boolean {
    return this.step() > index;
  }

  // ---- Questions ---------------------------------------------------------

  addQuestion(): void {
    this.questions.update(list => [...list, emptyFormQuestion(list.length + 1)]);
  }

  /**
   * Removes a question and renumbers the rest.
   *
   * `questionNumber` is positional, so leaving a gap would save a form whose
   * questions claim numbers that no longer match their order.
   */
  removeQuestion(index: number): void {
    if (this.questions().length <= 1) {
      return;
    }

    this.questions.update(list =>
      list
        .filter((_, position) => position !== index)
        .map((question, position) => ({ ...question, questionNumber: position + 1 }))
    );
  }

  /** Production's up and down arrows beside each block. */
  moveQuestion(index: number, direction: -1 | 1): void {
    const target = index + direction;

    if (target < 0 || target >= this.questions().length) {
      return;
    }

    this.questions.update(list => {
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];

      return next.map((question, position) => ({
        ...question,
        questionNumber: position + 1
      }));
    });
  }

  canMoveUp(index: number): boolean {
    return index > 0;
  }

  canMoveDown(index: number): boolean {
    return index < this.questions().length - 1;
  }

  /**
   * Writes one field of one question.
   *
   * REPLACES THE ARRAY AND THE QUESTION rather than assigning into them. The
   * template reads `questions()`, and a mutation in place is a change the signal
   * never announces — under zoneless change detection the edit would not appear.
   */
  private patch(index: number, patch: Partial<FormQuestion>): void {
    this.questions.update(list =>
      list.map((question, position) =>
        position === index ? { ...question, ...patch } : question
      )
    );
  }

  setQuestionText(index: number, value: string): void {
    this.patch(index, { question: value });
  }

  /**
   * Changes the type, AND CLEARS EVERY TYPE-SPECIFIC FIELD.
   *
   * Switching dropDownDependent to text would otherwise leave
   * 'RYSI_Categories,rysiCategoryMap,categories' behind on a question that no
   * longer has a dropdown — invisible in the dialog, because the field showing it
   * is gone, and still in the saved document. `prompt` is cleared for the same
   * reason in the other direction.
   */
  setQuestionType(index: number, value: string): void {
    const was = this.questions()[index].questionType ?? '';

    this.patch(index, {
      questionType: value,
      /*
       * KEPT WHEN BOTH TYPES AUTHOR ROWS, cleared otherwise.
       *
       * `checkBoxGroup` and `radioGroup` write the same options the same way and
       * differ only in how many may be picked when the form is answered, so
       * switching between them changes nothing about what was authored. Clearing
       * there would throw away an author's typed options for a change that did
       * not affect them, which is the kind of loss nobody expects from a
       * dropdown.
       *
       * Everywhere else it is CLEARED TO THE SHAPE THE NEW TYPE EDITS, not to ''
       * for all of them: the row editor reads an array, and handing it a string
       * would put one empty row on screen that cannot be typed into.
       */
      dropDownOptions: hasOptionRows(value) && hasOptionRows(was)
        ? normaliseOptions(this.questions()[index].dropDownOptions, value)
        : (hasOptionRows(value) ? [] : ''),
      dropDownOptionsDynamic: '',
      dropDownOptionsDependent: '',
      prompt: ''
    });
  }

  setFieldIcon(index: number, value: string): void {
    this.patch(index, { fieldIcon: value });
  }

  setSubquestion(index: number, value: boolean): void {
    this.patch(index, { isSubquestion: value });
  }

  setDropDownOptions(index: number, value: string): void {
    this.patch(index, { dropDownOptions: value });
  }

  // ---- The row option editor, for checkBoxGroup and radioGroup -----------
  //
  // ONE OPTION PER ROW, added and removed with a button, which is how the quiz
  // wizard has always authored its MCQ options. A form's rows carry none of the
  // quiz's scoring furniture: there is no correct answer to tick, because a form
  // is not marked.
  //
  // ONE EDITOR FOR BOTH TYPES. Whether one option may be picked or several is
  // decided when the form is ANSWERED, not when it is written, so there is
  // nothing for the author to do differently and no reason for two editors.

  /**
   * The rows to render. Always AT LEAST ONE, so a fresh question shows an empty
   * box to type into rather than a header with nothing under it.
   */
  optionRows(question: FormQuestion): string[] {
    const stored = question.dropDownOptions;
    const rows = Array.isArray(stored) ? [...stored] : splitOptions(stored);

    return rows.length > 0 ? rows : [''];
  }

  addOption(index: number): void {
    this.patch(index, {
      dropDownOptions: [...this.optionRows(this.questions()[index]), '']
    });
  }

  /**
   * Removes one row.
   *
   * NEVER DOWN TO NOTHING: clearing the last row empties it instead of deleting
   * it, so the editor cannot reach a state with no box to type in and no way
   * back except changing the type and back again.
   */
  removeOption(index: number, optionIndex: number): void {
    const rows = this.optionRows(this.questions()[index]);
    const left = rows.filter((_, position) => position !== optionIndex);

    this.patch(index, { dropDownOptions: left.length > 0 ? left : [''] });
  }

  setOptionAt(index: number, optionIndex: number, value: string): void {
    const rows = this.optionRows(this.questions()[index]);

    this.patch(index, {
      dropDownOptions: rows.map((row, position) =>
        position === optionIndex ? value : row
      )
    });
  }

  /** Whether this question's options are authored as rows. */
  usesOptionRows(question: FormQuestion): boolean {
    return hasOptionRows(question.questionType);
  }

  setDynamicName(index: number, value: string): void {
    this.patch(index, { dropDownOptionsDynamic: value });
  }

  setDependentName(index: number, value: string): void {
    this.patch(index, { dropDownOptionsDependent: value });
  }

  setPrompt(index: number, value: string): void {
    this.patch(index, { prompt: value });
  }

  // ---- Per-type fields ---------------------------------------------------

  /*
   * ONE EXTRA FIELD FOR FOUR OF THE SEVEN TYPES, read off production's own
   * template rather than inferred from its screenshots:
   *
   *   dropDown           Drop Down Options       dropDownOptions
   *   dropDownDynamic    Configuration Document  dropDownOptionsDynamic
   *   dropDownDependent  Dependent Drop Down Name  dropDownOptionsDependent
   *   text               Prompt                  prompt
   *
   * `text` GETTING A PROMPT was the surprise. Every one of the 209 questions in
   * the collection stores `prompt: ''`, which reads like a field nothing collects
   * — but production's template offers it on a text question, and it becomes that
   * field's placeholder. Nobody has filled it in yet; that is not the same as it
   * being dead.
   *
   * `dropDownDynamic` IS LABELLED "Configuration Document", not "Dynamic Drop
   * Down Name". Its value is a document in the Configuration collection plus the
   * field inside it — 'RYSI_Categories,subjects' — so production's label is
   * describing what the value is, and the symmetrical-sounding name would have
   * been wrong.
   */
  /*
   * THE COMMA TEXT FIELD, which is `dropDown` alone.
   *
   * `checkBoxGroup` and `radioGroup` store their choices in this same
   * `dropDownOptions` field but author them as rows, so they answer
   * `usesOptionRows` instead. Two editors for one field, because they disagree
   * about what an option may contain: a comma separated box cannot express an
   * option with a comma in it, and a row can. See the note on the field in
   * models/teaching.model.ts.
   */
  needsOptions(question: FormQuestion): boolean {
    return question.questionType === 'dropDown';
  }

  needsDynamicName(question: FormQuestion): boolean {
    return question.questionType === 'dropDownDynamic';
  }

  needsDependentName(question: FormQuestion): boolean {
    return question.questionType === 'dropDownDependent';
  }

  needsPrompt(question: FormQuestion): boolean {
    return question.questionType === 'text';
  }

  /**
   * The block's heading.
   *
   * A SUB-QUESTION IS LETTERED, NOT NUMBERED, which is production's own
   * behaviour: ticking "Is this a sub question?" changes the heading from
   * "Question 1: …" to "i: …". The numeral counts sub-questions among themselves,
   * so two sub-questions under different parents both start at i.
   */
  questionLabel(question: FormQuestion, index: number): string {
    const text = question.question.trim();
    const suffix = text ? `: ${text}` : ':';

    if (!question.isSubquestion) {
      return `Question ${this.displayNumber(index)}${suffix}`;
    }

    return `${this.romanNumeral(this.subquestionPosition(index))}${suffix}`;
  }

  /**
   * The review step's row label: 'Question 1', by RAW POSITION.
   *
   * Not the sub-question numeral the editor shows. Production's review prints
   * `Question {{i + 1}}` for every row, sub-questions included, and it is the
   * better choice for a summary anyway: the review is a flat list, so a row
   * labelled 'ii' with no parent visible above it says nothing.
   */
  reviewLabel(index: number): string {
    return `Question ${index + 1}`;
  }

  /** The label for the configured type, or the stored value if it is unknown. */
  typeLabel(questionType: string): string {
    return (
      this.questionTypes().find(entry => entry.key === questionType)?.display ||
      questionType ||
      '—'
    );
  }

  /** Counts only full questions, so sub-questions do not advance the numbering. */
  private displayNumber(index: number): number {
    return this.questions()
      .slice(0, index + 1)
      .filter(question => !question.isSubquestion).length;
  }

  /** How many sub-questions deep this one is under the question above it. */
  private subquestionPosition(index: number): number {
    let position = 0;

    for (let cursor = index; cursor >= 0; cursor--) {
      if (!this.questions()[cursor].isSubquestion) {
        break;
      }

      position++;
    }

    return position;
  }

  /** i, ii, iii … Small numbers only, which is all a form of sub-questions needs. */
  private romanNumeral(value: number): string {
    const numerals = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];

    return numerals[value - 1] ?? String(value);
  }

  // ---- Saving ------------------------------------------------------------

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  checkedOf(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  /**
   * NAVIGATES TO THE PROBLEM rather than returning silently — the same fix the
   * quiz wizard needed. A refused save on the last step, with the offending field
   * two steps back, reads as a button that does nothing.
   */
  save(): void {
    if (this.saving()) {
      return;
    }

    if (!this.stepOneValid()) {
      this.step.set(1);
      return;
    }

    if (!this.stepTwoValid()) {
      this.step.set(2);
      return;
    }

    this.submitted.emit({
      ...emptyFormPayload(),
      type: 'FORM',
      displayName: this.displayName().trim(),
      author: this.author().trim(),
      creator: this.creator(),
      status: this.status(),
      instructions: this.instructions().trim(),
      /*
       * Trimmed and renumbered on the way out. `questionNumber` is positional and
       * the list may have been reordered and removed from since it was set.
       */
      questions: this.questions().map((question, index) => ({
        ...question,
        question: question.question.trim(),
        questionNumber: index + 1,
        /*
         * OPTION ROWS TRIMMED AND BLANKS DROPPED on the way out. The editor keeps
         * an empty row so there is always somewhere to type, and `addOption`
         * appends one before it is filled in, so a saved document would otherwise
         * carry '' entries that no author put there. The players filter them on
         * read, so this is not what stops a blank checkbox appearing; it is what
         * stops the editor showing the author rows they never added.
         */
        dropDownOptions: this.usesOptionRows(question)
          ? splitOptions(question.dropDownOptions)
          : question.dropDownOptions
      }))
    });
  }

  close(): void {
    this.closed.emit();
  }
}

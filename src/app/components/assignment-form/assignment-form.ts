import { Component, computed, effect, inject, input, output, signal } from '@angular/core';

import { Icon } from '../icon/icon';
import { FormQuestion } from '../../models/teaching.model';
import {
  AnsweredFormQuestion,
  FormSubmissionService
} from '../../services/form-submission.service';

/** What Submit reports: the answered questions, in production's stored shape. */
export interface FormOutcome {
  questions: AnsweredFormQuestion[];
  answered: number;
  total: number;
}

/**
 * A FORM assignment, as production's classroom stepper renders it.
 *
 * WHAT THIS IS. A workflow step can carry a FORM — a Feedback step is the common
 * one — and production shows it as a real, fillable form: a centred "Instructions"
 * heading, the assignment's own instruction line under it, then each question as
 * `Question N: …` with a field whose type follows `questionType`, and a centred
 * Submit. This is `form-workflow.component.html`, matched.
 *
 * IT REPLACED A READ-ONLY LIST. This page used to render a form's questions as a
 * numbered summary with the type printed beside each one, which told a teacher what
 * the form WOULD ask and gave them no way to answer it. Production's is the working
 * form, and a Feedback step whose feedback cannot be given is a step that does
 * nothing.
 *
 * IT NEVER PREFILLS AND EMPTIES AFTER EACH SUBMISSION, on instruction — so the
 * fields are blank every time a step is opened, whatever was sent before.
 * Submissions are unlimited; `submissionCount` on the record is the only trace of
 * how many there have been.
 *
 * ANSWERS UNLOCK IN ORDER, which is production's rule and the surprising part of
 * this component: every field after the first is DISABLED until the one before it
 * has an answer. Its `addQuestion` creates each control with
 * `disabled: this.questions.length > 0` and enables it from the previous control's
 * `valueChanges`. Deliberate, not incidental — it stops a form being submitted
 * with the middle skipped.
 *
 * A QUESTION NOBODY CAN ANSWER DOES NOT BLOCK. `none` is a heading rather than a
 * question, and a dynamic or dependent dropdown may have no resolvable options; in
 * production either one dead-ends the whole form, because the next field waits on
 * an answer that cannot be given. Here they pass the unlock through. See
 * `FormSubmissionService.canAnswer`.
 */
@Component({
  selector: 'app-assignment-form',
  imports: [Icon],
  templateUrl: './assignment-form.html',
  styleUrl: './assignment-form.css'
})
export class AssignmentForm {

  private forms = inject(FormSubmissionService);

  readonly questions = input.required<readonly FormQuestion[]>();
  readonly instructions = input('');

  readonly submitting = input(false);
  /** What the parent's write did. Blank until something has been submitted. */
  readonly submissionNote = input('');
  readonly submissionFailed = input(false);

  /**
   * A counter the parent bumps on every SUCCESSFUL write, which empties the form.
   *
   * A COUNTER RATHER THAN A BOOLEAN, because two submissions in a row have to be
   * distinguishable: a flag flipped to true stays true, so the second success
   * would clear nothing.
   *
   * AND THE PARENT DECIDES, not this component. Clearing on the click would lose
   * a teacher's typing whenever the write was refused — which is precisely when
   * they need it back. Only a write that landed empties the fields.
   */
  readonly clearedAt = input(0);

  readonly submitted = output<FormOutcome>();

  /** One answer per question, by index. A star rating holds a number. */
  readonly answers = signal<Record<number, string | number>>({});

  constructor() {
    /*
     * EMPTIES THE FORM AFTER A SUCCESSFUL SUBMISSION, on instruction.
     *
     * NOT PRODUCTION'S BEHAVIOUR, and the departure is deliberate on both halves:
     * its form PREFILLS from the stored submission and stays filled after
     * submitting. This one never prefills and empties itself after each send, so
     * every reader starts from a blank form rather than editing somebody's
     * previous answers.
     *
     * A PREFILL WAS BUILT FIRST, matching production, and removed on instruction.
     * What it cost: a form keeps no version history, so a reader who submitted
     * over a prefill was overwriting answers the fields had put there for them.
     */
    effect(() => {
      const cleared = this.clearedAt();

      if (cleared > 0) {
        this.answers.set({});
      }
    });
  }

  /** 'Question 3: …', or just '3: …' for a subquestion, as production labels them. */
  label(question: FormQuestion): string {
    const number = question.questionNumber;

    return question.isSubquestion ? `${number}:` : `Question ${number}:`;
  }

  /**
   * The field's placeholder.
   *
   * THE QUESTION'S OWN `prompt`, falling back to production's literal default.
   * Worth pinning because it looks like dead data: all 209 questions in this app's
   * collection store `prompt: ''`, and production's live Feedback Form uses it on
   * three of five questions — 'Enjoyed the Story the most', '60 minutes'. It is
   * the example answer, shown greyed inside the field.
   */
  placeholder(question: FormQuestion): string {
    return (question.prompt ?? '').trim() || 'Enter the answer here';
  }

  options(question: FormQuestion): string[] {
    return this.forms.optionsFor(question);
  }

  canAnswer(question: FormQuestion): boolean {
    return this.forms.canAnswer(question);
  }

  /**
   * A dropdown that names its options somewhere this player cannot reach.
   *
   * SAID OUT LOUD rather than shown as an empty select. Production renders exactly
   * an empty select here — its own option-resolving pass is commented out — and an
   * empty dropdown reads as a loading failure rather than as a form that names its
   * choices in a Configuration document nobody has filled in.
   */
  isUnresolvedDropdown(question: FormQuestion): boolean {
    const isDropdown =
      question.questionType === 'dropDown' ||
      question.questionType === 'dropDownDynamic' ||
      question.questionType === 'dropDownDependent';

    return isDropdown && this.options(question).length === 0;
  }

  /**
   * Whether this field is open for input.
   *
   * THE FIRST ANSWERABLE QUESTION IS ALWAYS OPEN; after that, a field waits for
   * the nearest ANSWERABLE question before it to have an answer. Skipping the
   * unanswerable ones is what keeps a heading or an empty dropdown from sealing
   * the rest of the form.
   */
  isOpen(index: number): boolean {
    const questions = this.questions();

    for (let at = index - 1; at >= 0; at--) {
      if (!this.canAnswer(questions[at])) {
        continue;
      }

      return this.hasAnswer(at);
    }

    return true;
  }

  hasAnswer(index: number): boolean {
    const answer = this.answers()[index];

    return typeof answer === 'number' ? answer > 0 : (answer ?? '').trim() !== '';
  }

  value(index: number): string {
    const answer = this.answers()[index];

    return answer === undefined ? '' : String(answer);
  }

  rating(index: number): number {
    const answer = this.answers()[index];

    return typeof answer === 'number' ? answer : Number(answer) || 0;
  }

  set(index: number, value: string | number): void {
    this.answers.update(all => ({ ...all, [index]: value }));
  }

  /** The five stars, so the template has something to iterate. */
  readonly stars = [1, 2, 3, 4, 5] as const;

  /** How many answerable questions have an answer. */
  readonly answeredCount = computed(
    () =>
      this.questions().filter(
        (question, at) => this.canAnswer(question) && this.hasAnswer(at)
      ).length
  );

  /** How many there are to answer at all — headings excluded. */
  readonly answerableCount = computed(
    () => this.questions().filter(question => this.canAnswer(question)).length
  );

  readonly allAnswered = computed(
    () => this.answerableCount() > 0 && this.answeredCount() === this.answerableCount()
  );

  /**
   * Builds the record and hands it up. THE PARENT DOES THE WRITING.
   *
   * EVERY QUESTION IS INCLUDED, answered or not, which is production's: its live
   * submission carries a fifth question with `answer: ''`. A record holding only
   * the answered ones could not be told apart from a shorter form.
   */
  submit(): void {
    const questions: AnsweredFormQuestion[] = this.questions().map(
      (question, at) => ({
        questionType: question.questionType,
        questionNumber: question.questionNumber,
        question: question.question,
        /*
         * THE PROMPT AS A PLAIN STRING. Production stores it as a one-element
         * ARRAY where the question had none — `prompt: ['Enter the answer here']`
         * — which is an artefact of how its FormBuilder wraps a default, not a
         * shape anything depends on: a template renders the two identically. The
         * string is what was actually shown to the reader.
         */
        prompt: this.placeholder(question),
        /* `null` WHERE THERE IS NONE, which is what production's own records
           carry. Firestore refuses undefined, so it cannot simply be left out. */
        fieldIcon: question.fieldIcon || null,
        isSubquestion: question.isSubquestion,
        /* AN ARRAY IN THE RECORD, A STRING ON THE ASSIGNMENT — production splits
           it on the way in, and its stored submissions hold `[]` for every
           non-dropdown question. */
        dropDownOptions: this.options(question),
        answer:
          question.questionType === 'starRating'
            ? this.rating(at)
            : this.value(at)
      })
    );

    this.submitted.emit({
      questions,
      answered: this.answeredCount(),
      total: this.answerableCount()
    });
  }

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }
}

import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal
} from '@angular/core';

import { Icon } from '../icon/icon';
import { AssignmentOption, QuizAssignment, QuizQuestion } from '../../models/teaching.model';
import {
  QuizAnswer,
  attemptMarks,
  stampAnswers
} from '../../services/quiz-submission.service';

/**
 * What the reader has entered for one question.
 *
 * SHARED WITH THE SUBMISSION SERVICE, which is what marks it and stamps it onto
 * the stored questions — one shape, so the thing scored is the thing recorded.
 */
type Answer = QuizAnswer;

/** What Submit reports. Nothing is written anywhere — see the class note. */
export interface QuizOutcome {
  answered: number;
  total: number;
  /** Marks earned on the questions that can be marked automatically. */
  scored: number;
  /**
   * Marks available on those same questions.
   *
   * ZERO MEANS NOTHING COULD BE MARKED, which is different from scoring zero and
   * is why the two are reported separately. A quiz whose author never ticked a
   * correct answer has no markable questions at all — the panel says so rather
   * than reporting a score of nought.
   */
  scorable: number;
  /**
   * How many questions carry a correct answer to mark against.
   *
   * SEPARATE FROM `scorable` BECAUSE IT ANSWERS A DIFFERENT QUESTION: scorable is
   * marks, this is questions, and "no question in this quiz has an answer marked"
   * is the sentence a teacher can act on.
   */
  markable: number;

  /*
   * ==========================================================================
   * PRODUCTION'S OWN TWO FIGURES, ALONGSIDE THIS APP'S HONEST PAIR.
   *
   * `studentScore` and `maxScore` are what `getTACQuesMarks` computes and what
   * goes into the attempt document, so a submission written here agrees with
   * production's report screens. `maxScore` counts EVERY question's marks,
   * markable or not.
   *
   * `scored` and `scorable` above are the panel's figures and count only what
   * could be marked. They differ on purpose: a quiz whose author ticked no
   * correct answers has maxScore 5 and scorable 0, and telling the reader "0 of
   * 5" without saying which is which was a real complaint.
   * ==========================================================================
   */
  studentScore: number;
  maxScore: number;

  /** The questions as they will be stored, each option carrying `attemptedOption`. */
  questions: QuizQuestion[];
}

/**
 * The quiz player — production's Manual run, as a walkthrough.
 *
 * WHAT THIS IS FOR. A teacher on the workflow stepper opens a quiz step and wants
 * to take the class through it: the numbered rail across the top, one question at a
 * time, a countdown, and a Done state at the end. This is production's own player
 * for its Manual start mode.
 *
 * SUBMIT RECORDS AN ATTEMPT, and this is the second version of that decision. It
 * used to record nothing and say so, on the reasoning that production writes to
 * `Students/{id}/remoteSubmissions/…` and this app has no students. That was wrong
 * about which flow production uses here: its TEACHER player writes to
 * `Teachers/{teacherId}/submissions/{classroomId}-{programmeId}` with the attempts
 * under it, which is a path this app has an equivalent of. See
 * `QuizSubmissionService` for the shape and for the one segment that differs.
 *
 * SO SUBMIT ASKS FIRST. Production opens a Confirm Submission dialog and writes
 * only on Yes, because a submission consumes one of a capped number of attempts —
 * three by default — and there is no undo.
 *
 * NO REMOTE MODE, for the same reason: production's Remote start loads the class's
 * student mapping so each student answers on their own device, and there are no
 * students here to map. Start goes straight into this player rather than offering a
 * choice with one working option.
 *
 * THE TIMER IS THE QUIZ'S OWN TOTAL, not per question. Production's card shows a
 * single duration and its player counts it down across the whole run, so a reader
 * who lingers on question one has less time for the rest — which is what makes it a
 * quiz rather than a worksheet.
 */
@Component({
  selector: 'app-quiz-player',
  imports: [Icon],
  templateUrl: './quiz-player.html',
  styleUrl: './quiz-player.css'
})
export class QuizPlayer implements OnInit {

  private destroyRef = inject(DestroyRef);

  readonly quiz = input.required<QuizAssignment>();

  /**
   * WHAT THE PARENT'S WRITE DID, passed back in.
   *
   * THE PLAYER DOES NOT WRITE, and that division is deliberate: the attempt path
   * is keyed on the signed-in teacher, the classroom and the programme, none of
   * which a player given only a quiz has any business knowing. The page owns the
   * write; this reports it. Blank means nothing has been submitted yet.
   */
  readonly submissionNote = input('');

  /** Set while the parent's write is in flight, so Submit cannot fire twice. */
  readonly submitting = input(false);

  /** Set when the write failed, so the panel says so instead of claiming success. */
  readonly submissionFailed = input(false);

  readonly closed = output<void>();
  readonly submitted = output<QuizOutcome>();

  /** Armed by Submit, cleared by either answer — production's Confirm Submission. */
  readonly confirming = signal(false);

  readonly questions = computed<QuizQuestion[]>(() => this.quiz().questionsData ?? []);

  /** Which question is showing, or `questions().length` for the Done panel. */
  readonly index = signal(0);

  readonly onDone = computed(() => this.index() >= this.questions().length);

  readonly current = computed<QuizQuestion | null>(
    () => this.questions()[this.index()] ?? null
  );

  /** One entry per question, by index. */
  readonly answers = signal<Record<number, Answer>>({});

  /** Seconds left on the whole run. */
  readonly remaining = signal(0);

  readonly outcome = signal<QuizOutcome | null>(null);

  /**
   * The countdown as mm:ss.
   *
   * PADDED BOTH SIDES, so the width does not jump as it ticks — a timer that
   * reflows the row it sits in draws the eye away from the question.
   */
  readonly clock = computed(() => {
    const total = Math.max(0, this.remaining());
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  });

  /** Under a minute, so the timer can warn. */
  readonly runningOut = computed(() => this.remaining() > 0 && this.remaining() <= 60);

  readonly answeredCount = computed(
    () => this.questions().filter((_, at) => this.isAnswered(at)).length
  );

  ngOnInit(): void {
    this.remaining.set(totalSeconds(this.quiz()));

    /*
     * ONE INTERVAL FOR THE WHOLE RUN, cleared on destroy.
     *
     * `takeUntilDestroyed` needs an observable, so this is a plain interval with an
     * explicit teardown — a timer left running after the player closes keeps
     * ticking a signal nothing reads, and in a zoneless app that is a wasted render
     * every second for the life of the tab.
     */
    const tick = setInterval(() => {
      const left = this.remaining() - 1;

      this.remaining.set(Math.max(0, left));

      /*
       * TIME UP GOES TO DONE, it does not submit. Submitting for the reader would
       * take the decision out of their hands at the exact moment they are least
       * able to react — and production's own Done panel is a stop, not a send.
       */
      if (left <= 0) {
        this.index.set(this.questions().length);
        clearInterval(tick);
      }
    }, 1000);

    this.destroyRef.onDestroy(() => clearInterval(tick));
  }

  // ---- Navigation ---------------------------------------------------------

  /**
   * Jumps to a question, or to the Done panel.
   *
   * EVERY CIRCLE IS REACHABLE, which is production's behaviour: its rail lets a
   * reader go back over an answer rather than trapping them going forward. Its
   * `allowExitAndReEntry` governs leaving the quiz entirely, not moving within it.
   */
  goTo(index: number): void {
    if (index < 0 || index > this.questions().length) {
      return;
    }

    this.index.set(index);
  }

  next(): void {
    this.goTo(this.index() + 1);
  }

  previous(): void {
    this.goTo(this.index() - 1);
  }

  // ---- Answering ----------------------------------------------------------

  /**
   * Chooses an MCQ option.
   *
   * SINGLE OR MULTIPLE, on the question's own `oneCorrectOption`. Production
   * renders a radio when only one option is correct and a checkbox when more than
   * one is — so the control has to follow the question rather than the other way
   * round, and a multi-answer question offered as radios is unanswerable.
   */
  choose(optionIndex: number): void {
    const question = this.current();

    if (!question) {
      return;
    }

    const single = question.oneCorrectOption !== false;
    const answer = this.answerAt(this.index());
    const chosen = single
      ? [optionIndex]
      : answer.chosen.includes(optionIndex)
        ? answer.chosen.filter(at => at !== optionIndex)
        : [...answer.chosen, optionIndex];

    this.patch(this.index(), { chosen });
  }

  isChosen(optionIndex: number): boolean {
    return this.answerAt(this.index()).chosen.includes(optionIndex);
  }

  setText(value: string): void {
    this.patch(this.index(), { text: value });
  }

  setBlank(key: string, value: string): void {
    const answer = this.answerAt(this.index());

    this.patch(this.index(), { blanks: { ...answer.blanks, [key]: value } });
  }

  blankValue(key: string): string {
    return this.answerAt(this.index()).blanks[key] ?? '';
  }

  textValue(): string {
    return this.answerAt(this.index()).text;
  }

  /** The blanks a question has, in the order it stores them. */
  blankKeys(question: QuizQuestion): string[] {
    return Object.keys(question.blanks ?? {});
  }

  /** Whether a question has anything entered — what the rail marks. */
  isAnswered(index: number): boolean {
    const answer = this.answers()[index];

    if (!answer) {
      return false;
    }

    return (
      answer.chosen.length > 0 ||
      answer.text.trim() !== '' ||
      Object.values(answer.blanks).some(value => value.trim() !== '')
    );
  }

  // ---- Submitting ---------------------------------------------------------

  /**
   * Submit — ASKS FIRST, which is production's own flow.
   *
   * A submission consumes one of a capped number of attempts (three by default)
   * and there is no undo, so the click that spends one is confirmed. Production's
   * dialog also mentions pressing Y or N on a clicker remote; that line is left out
   * here because this app has no remote support, and an instruction for a device
   * that does nothing is worse than no instruction.
   */
  askSubmit(): void {
    if (!this.submitting() && !this.outcome()) {
      this.confirming.set(true);
    }
  }

  cancelSubmit(): void {
    this.confirming.set(false);
  }

  /**
   * Reports what was answered and what it scored. THE PARENT DOES THE WRITING.
   *
   * TWO SETS OF FIGURES, and both are wanted. `studentScore` and `maxScore` follow
   * production's `getTACQuesMarks` exactly, because they are what lands in the
   * attempt document and what its report screens read. `scored` and `scorable`
   * below count only the questions that could be marked at all, which is what the
   * panel shows a reader — a quiz whose author ticked no correct answer scores 0
   * out of a maxScore of 5, and saying that without saying why reads as "you got
   * everything wrong".
   */
  submit(): void {
    let scored = 0;
    let scorable = 0;

    this.questions().forEach((question, at) => {
      const answer = this.answers()[at];
      const marks = question.marks ?? 0;

      /*
       * AN MCQ WITH NO CORRECT OPTION MARKED IS NOT MARKABLE, so its marks are not
       * in play — and this was the bug behind a real complaint. A quiz whose author
       * had not ticked any answers reported "0 of 5 marks", which reads as "you got
       * everything wrong" when the truth is that nothing could be marked at all.
       * Excluding it from `scorable` lets the panel say which of those two it is.
       */
      if (
        question.questionType === 'MCQ' &&
        (question.options ?? []).some(option => option.isCorrect)
      ) {
        scorable += marks;

        if (answer && correctChosen(question.options ?? [], answer.chosen)) {
          scored += marks;
        }

        return;
      }

      if (question.questionType === 'TEXT' && (question.answer ?? '').trim() !== '') {
        scorable += marks;

        if (
          answer &&
          answer.text.trim().toLowerCase() === (question.answer ?? '').trim().toLowerCase()
        ) {
          scored += marks;
        }
      }
    });

    /* THE ANSWERS IN QUESTION ORDER, with a blank for anything untouched — the
       stored attempt has one entry per question whether it was answered or not. */
    const answers = this.questions().map((_, at) => this.answerAt(at));
    const marks = attemptMarks(this.questions(), answers);

    const outcome: QuizOutcome = {
      answered: this.answeredCount(),
      total: this.questions().length,
      scored,
      scorable,
      markable: this.questions().filter(isMarkable).length,
      studentScore: marks.studentScore,
      maxScore: marks.maxScore,
      questions: stampAnswers(this.questions(), answers)
    };

    this.confirming.set(false);
    this.outcome.set(outcome);
    this.submitted.emit(outcome);
  }

  close(): void {
    this.closed.emit();
  }

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  private answerAt(index: number): Answer {
    return this.answers()[index] ?? { chosen: [], text: '', blanks: {} };
  }

  private patch(index: number, patch: Partial<Answer>): void {
    this.answers.update(all => ({
      ...all,
      [index]: { ...this.answerAt(index), ...patch }
    }));
  }
}

/**
 * The quiz's total duration in seconds.
 *
 * THREE FIELDS, AND TWO OF THEM ARE `number | string`. Production's wizard leaves
 * them blank rather than at zero, so the stored value can be '' — and `'' * 60` is
 * 0 while `Number('')` is also 0, but `undefined` would give NaN and a timer that
 * shows 'NaN:NaN' and never ticks.
 *
 * A QUIZ WITH NO DURATION GETS TEN MINUTES rather than zero, because zero would
 * send the reader straight to Done before they saw question one.
 */
export function totalSeconds(quiz: QuizAssignment): number {
  const hours = Number(quiz.totalDurationInHours ?? 0) || 0;
  const minutes = Number(quiz.totalDurationInMinutes ?? 0) || 0;
  const seconds = Number(quiz.totalDurationInSeconds ?? 0) || 0;
  const total = hours * 3600 + minutes * 60 + seconds;

  return total > 0 ? total : 600;
}

/**
 * Whether a question can be marked automatically at all.
 *
 * AN MCQ NEEDS A CORRECT OPTION and a TEXT question needs a stored answer.
 * Everything else — descriptive, the blank types — is marked by a person, so it is
 * not counted as unmarked work the reader failed at.
 */
function isMarkable(question: QuizQuestion): boolean {
  if (question.questionType === 'MCQ') {
    return (question.options ?? []).some(option => option.isCorrect);
  }

  return question.questionType === 'TEXT' && (question.answer ?? '').trim() !== '';
}

/**
 * Whether the chosen options are exactly the correct ones.
 *
 * EXACT SET EQUALITY, not "contains a correct one": on a multi-answer question,
 * ticking every option would otherwise score full marks. The same rule the
 * assignment report applies when it marks a submission.
 */
function correctChosen(options: AssignmentOption[], chosen: number[]): boolean {
  const correct = options
    .map((option, at) => (option.isCorrect ? at : -1))
    .filter(at => at >= 0);

  if (correct.length === 0) {
    return false;
  }

  return (
    correct.length === chosen.length && correct.every(at => chosen.includes(at))
  );
}

import { Component, input, output } from '@angular/core';

import { Icon } from '../icon/icon';
import { WorkflowStep } from '../../models/teaching.model';

/**
 * The numbered ladder of workflow steps, as production draws it.
 *
 * SHARED BY TWO PAGES, which is why it is a component rather than markup in each.
 * The workflow-template form builds a blueprint's steps; the classroom stepper
 * walks a workflow's. Production draws the identical ladder in both — outlined
 * circle, connector line, name, clock and minutes — and the two had already
 * started to diverge in wording before this was extracted.
 *
 * PRESENTATIONAL. It holds no state, reads nothing and writes nothing: the steps
 * come in, an index goes out. Both pages own their own list, which is what lets
 * the form keep an unsaved draft and the stepper keep a loaded document without
 * this component knowing the difference.
 *
 * THE THREE FLAGS ARE THE DIFFERENCES BETWEEN THE TWO CALLERS, and each is a real
 * behavioural difference rather than styling:
 *
 *   `selectable` — the stepper navigates by clicking a step; the form does not.
 *   `editable`   — both, today, but a read-only view is the obvious next caller.
 *   `current`    — the stepper highlights where the reader is; the form has no
 *                  such notion, and passing -1 means nothing is highlighted.
 *
 * THE THREE CIRCLE STATES ARE PRODUCTION'S, and what they mean is worth being
 * precise about because one of them looks like something it is not:
 *
 *   BEFORE the current step — filled teal with a white tick, teal connector
 *   THE current step        — ringed blue, showing its number
 *   AFTER it                — ringed grey, showing its number
 *
 * THE TICK IS POSITIONAL, NOT PROGRESS. It means "you have moved past this step",
 * derived from `current` alone — production computes it the same way, from
 * `step.sequenceNumber < currentStep`. It is NOT the student's `isStepUnlocked`,
 * which this app never writes; reading it as completion would claim knowledge of
 * work nobody has recorded. On the template form, where `current` is -1, no step
 * is ever before the current one, so nothing is ticked.
 */
@Component({
  selector: 'app-workflow-timeline',
  imports: [Icon],
  templateUrl: './workflow-timeline.html',
  styleUrl: './workflow-timeline.css'
})
export class WorkflowTimeline {

  readonly steps = input<readonly WorkflowStep[]>([]);

  /**
   * The step being viewed, or -1 for none.
   *
   * -1 RATHER THAN null, so the template's comparison is a plain number test: an
   * index that can be null makes every `stepIndex === current()` a three-state
   * question in a place where two states are wanted.
   */
  readonly current = input(-1);

  readonly selectable = input(false);
  readonly editable = input(true);

  readonly selected = output<number>();
  readonly edited = output<number>();
  readonly removed = output<number>();

  /** Before the current step: ticked. See the class note on what that means. */
  isDone(index: number): boolean {
    return this.current() >= 0 && index < this.current();
  }

  /**
   * Whether to draw the clock line.
   *
   * PRODUCTION GUARDS ON TRUTHINESS (`*ngIf="step?.workflowStepDuration"`), and
   * the stored values are why this is not just `!== ''`: the field holds a number
   * in 221 of production's 238 template steps, the empty string in 6 and null in
   * 11. A step with no duration must not render an empty '· minutes' row.
   */
  hasDuration(step: WorkflowStep): boolean {
    const duration = step.workflowStepDuration;

    return duration !== '' && duration !== null && duration !== undefined;
  }
}

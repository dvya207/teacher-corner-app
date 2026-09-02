import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WorkflowTimeline } from './workflow-timeline';
import { WorkflowStep, emptyWorkflowStep } from '../../models/teaching.model';

/**
 * The shared step ladder.
 *
 * WHAT IS WORTH TESTING is the THREE CIRCLE STATES, and specifically what the tick
 * means. It is POSITIONAL — "you have moved past this step" — derived from
 * `current` alone, exactly as production derives it from
 * `step.sequenceNumber < currentStep`. It is NOT the student's `isStepUnlocked`,
 * which this app never writes, and reading it as completion would claim knowledge
 * of work nobody recorded.
 *
 * The template form passes no `current` at all, so nothing must ever be ticked
 * there — a blueprint has no step you are standing on.
 */

async function mount(
  steps: WorkflowStep[],
  current?: number
): Promise<{
  fixture: ComponentFixture<WorkflowTimeline>;
  component: WorkflowTimeline;
}> {
  TestBed.configureTestingModule({ imports: [WorkflowTimeline] });

  const fixture = TestBed.createComponent(WorkflowTimeline);

  fixture.componentRef.setInput('steps', steps);

  if (current !== undefined) {
    fixture.componentRef.setInput('current', current);
  }

  fixture.detectChanges();
  await fixture.whenStable();

  return { fixture, component: fixture.componentInstance };
}

function threeSteps(): WorkflowStep[] {
  return [
    { ...emptyWorkflowStep(1), workflowStepName: 'One' },
    { ...emptyWorkflowStep(2), workflowStepName: 'Two' },
    { ...emptyWorkflowStep(3), workflowStepName: 'Three' }
  ];
}

describe('WorkflowTimeline', () => {

  describe('the tick', () => {

    it('ticks every step before the current one', async () => {
      const { component } = await mount(threeSteps(), 2);

      expect(component.isDone(0)).toBe(true);
      expect(component.isDone(1)).toBe(true);
      // NOT the current step itself.
      expect(component.isDone(2)).toBe(false);
    });

    it('ticks nothing on the first step', async () => {
      const { component } = await mount(threeSteps(), 0);

      expect([0, 1, 2].map(index => component.isDone(index))).toEqual([
        false,
        false,
        false
      ]);
    });

    /**
     * THE TEMPLATE FORM TICKS NOTHING, EVER. It passes no `current`, which
     * defaults to -1 — a blueprint has no step you are standing on, so a tick
     * there would claim a state the page has no notion of.
     */
    it('ticks nothing when there is no current step', async () => {
      const { component } = await mount(threeSteps());

      expect(component.current()).toBe(-1);
      expect([0, 1, 2].map(index => component.isDone(index))).toEqual([
        false,
        false,
        false
      ]);
    });
  });

  describe('the rendered states', () => {

    it('marks the current step and the passed ones in the DOM', async () => {
      const { fixture } = await mount(threeSteps(), 2);
      const element = fixture.nativeElement as HTMLElement;

      expect(element.querySelectorAll('.wt-tl-step.is-done')).toHaveLength(2);
      expect(element.querySelectorAll('.wt-tl-step.is-current')).toHaveLength(1);
      // A TICK REPLACES THE NUMBER, so two circles show a glyph and one a digit.
      expect(element.querySelectorAll('.wt-tl-mark app-icon')).toHaveLength(2);
    });

    /** The connector is suppressed on the last step; see the component's note. */
    it('marks only the last step as last', async () => {
      const { fixture } = await mount(threeSteps(), 0);
      const element = fixture.nativeElement as HTMLElement;

      expect(element.querySelectorAll('.wt-tl-step.is-last')).toHaveLength(1);
    });

    /**
     * SELECTABLE MAKES EACH ROW A BUTTON, which is what the stepper needs and the
     * form does not: a clickable row that is not a control is unreachable by
     * keyboard and unannounced.
     */
    it('renders rows as buttons only when selectable', async () => {
      const plain = await mount(threeSteps(), 0);

      expect(
        (plain.fixture.nativeElement as HTMLElement).querySelectorAll('.wt-tl-select')
      ).toHaveLength(0);

      plain.fixture.componentRef.setInput('selectable', true);
      plain.fixture.detectChanges();

      expect(
        (plain.fixture.nativeElement as HTMLElement).querySelectorAll('button.wt-tl-select')
      ).toHaveLength(3);
    });

    it('hides the actions when not editable', async () => {
      const { fixture } = await mount(threeSteps(), 0);

      fixture.componentRef.setInput('editable', false);
      fixture.detectChanges();

      expect(
        (fixture.nativeElement as HTMLElement).querySelectorAll('.wt-tl-act')
      ).toHaveLength(0);
    });
  });

  describe('the duration line', () => {

    /**
     * PRODUCTION GUARDS ON TRUTHINESS, and the stored values are why: the field
     * holds a number in 221 of its 238 template steps, the empty string in 6 and
     * null in 11. A step with no duration must not render an empty row.
     */
    it('shows the clock only where there is a duration', async () => {
      const { component } = await mount(threeSteps(), 0);

      expect(
        component.hasDuration({ ...emptyWorkflowStep(1), workflowStepDuration: 10 })
      ).toBe(true);
      expect(
        component.hasDuration({ ...emptyWorkflowStep(1), workflowStepDuration: '' })
      ).toBe(false);
      expect(
        component.hasDuration({
          ...emptyWorkflowStep(1),
          workflowStepDuration: null as unknown as number
        })
      ).toBe(false);
    });

    it('draws a clock row per step that has one', async () => {
      const steps = threeSteps();

      steps[0].workflowStepDuration = 10;
      steps[1].workflowStepDuration = '';

      const { fixture } = await mount(steps, 0);

      expect(
        (fixture.nativeElement as HTMLElement).querySelectorAll('.wt-tl-meta')
      ).toHaveLength(1);
    });
  });

  describe('the last step cannot be removed', () => {

    /**
     * PRODUCTION'S RULE, with its own wording on the tooltip. A workflow with no
     * steps is a state neither caller can render, so it is not reachable by
     * deleting down to nothing.
     */
    it('disables delete when only one step is left', async () => {
      const { fixture } = await mount([emptyWorkflowStep(1)], 0);
      const button = (fixture.nativeElement as HTMLElement).querySelector(
        '.wt-tl-act.is-danger'
      ) as HTMLButtonElement;

      expect(button.disabled).toBe(true);
      expect(button.title).toBe('You cannot delete this step');
    });

    it('enables it once there are two', async () => {
      const { fixture } = await mount(threeSteps(), 0);
      const button = (fixture.nativeElement as HTMLElement).querySelector(
        '.wt-tl-act.is-danger'
      ) as HTMLButtonElement;

      expect(button.disabled).toBe(false);
      expect(button.title).toBe('Remove step');
    });
  });

  it('emits the index it was asked about', async () => {
    const { fixture, component } = await mount(threeSteps(), 0);
    const selected: number[] = [];
    const edited: number[] = [];
    const removed: number[] = [];

    component.selected.subscribe(index => selected.push(index));
    component.edited.subscribe(index => edited.push(index));
    component.removed.subscribe(index => removed.push(index));

    fixture.componentRef.setInput('selectable', true);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    (element.querySelectorAll('.wt-tl-select')[1] as HTMLButtonElement).click();
    (element.querySelectorAll('.wt-tl-act')[0] as HTMLButtonElement).click();
    (element.querySelectorAll('.wt-tl-act.is-danger')[2] as HTMLButtonElement).click();

    expect(selected).toEqual([1]);
    expect(edited).toEqual([0]);
    expect(removed).toEqual([2]);
  });
});

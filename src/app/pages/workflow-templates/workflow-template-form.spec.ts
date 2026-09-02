import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WorkflowTemplate, WorkflowTemplateDraft } from '../../models/teaching.model';
import { WorkflowTemplateForm } from './workflow-template-form';

/**
 * Create / Edit Workflow Template.
 *
 * WHAT IS WORTH TESTING, and it is not the markup. Four things here are quiet
 * when wrong and each writes a document production cannot use:
 *
 *   1. THE RAIL SWAPS ON THE MODE, and so does what is required. DEFAULT collects
 *      Learning Unit Type, Maturity and Subject; CUSTOM types a name and collects
 *      neither. Asking custom mode for the three was the original mistake here.
 *   2. WHAT THE MODE DOES NOT ASK FOR IS STILL WRITTEN, as the empty string —
 *      which is what production's own custom documents carry — and `subject`
 *      stores the NAME while the select's value is the CODE. The two disagree on
 *      purpose and it is exactly the sort of thing that gets crossed.
 *   3. `contentType` IS NOT THE CATEGORY. This file used to assert that it was,
 *      and production's own 352 content blocks disprove it: every assignment
 *      block carries '', and elsewhere it is a semantic word or empty. Only
 *      'video' ever equals its category, which is what made the wrong rule look
 *      right.
 *   4. `contentSubCategory` IS PER CATEGORY, and changing the category clears it:
 *      leaving 'tacQuickVideoUrl' on a graphics block stores a slot name that
 *      category has never had.
 */

async function mount(existing: WorkflowTemplate | null = null): Promise<{
  fixture: ComponentFixture<WorkflowTemplateForm>;
  component: WorkflowTemplateForm;
  saved: WorkflowTemplateDraft[];
}> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [WorkflowTemplateForm]
  }).compileComponents();

  const fixture = TestBed.createComponent(WorkflowTemplateForm);
  const component = fixture.componentInstance;
  const saved: WorkflowTemplateDraft[] = [];

  fixture.componentRef.setInput('template', existing);
  component.submitted.subscribe(draft => saved.push(draft));
  fixture.detectChanges();

  return { fixture, component, saved };
}

/** Fills custom mode's rail — a name and a workflow type. */
function fillRail(component: WorkflowTemplateForm): void {
  component.templateName.set('DGA STEM Club');
  component.workflowType.set('CLASSROOM');
}

/**
 * Walks the form to the point where it can save, THROUGH THE REAL FLOW.
 *
 * `save()` refuses before `showSteps`, so a test that only fills the rail is
 * testing a state production never reaches. The blue button opens the step dialog
 * and creates step one; naming it is what makes the step survive `save()`.
 */
function reachSaveable(component: WorkflowTemplateForm, stepName = 'Introduction'): void {
  fillRail(component);
  component.beginSteps();
  nameStep(component, 0, stepName);
  component.closeStepDialog();
}

function storedTemplate(overrides: Partial<WorkflowTemplate> = {}): WorkflowTemplate {
  return {
    docId: 't1',
    templateId: 't1',
    // A REAL CUSTOM TEMPLATE: the name is typed and the other three are empty,
    // exactly as production's own three custom documents carry them.
    templateName: 'Baseline Assessement',
    templateType: 'custom',
    learningUnitType: '',
    maturity: '',
    subject: '',
    type: 'STEM-CLUB',
    status: 'LIVE',
    ownerId: 'uid',
    createdAt: null,
    updatedAt: null,
    workflowSteps: [
      {
        workflowStepName: 'Make or Create',
        sequenceNumber: 1,
        workflowStepDescription: 'Review the content provided.',
        workflowStepDuration: 10,
        viewUnlab: true,
        workflowLocation: '',
        allowAccess: '',
        canSkipWorkflowStep: true,
        allowArtefactUpload: false,
        scannedArtefacts: [],
        contents: [
          {
            contentName: 'TACtivity Video',
            contentCategory: 'video',
            contentSubCategory: 'tacQuickVideoUrl',
            contentType: 'video',
            resourcePath: '',
            isDownloadable: true,
            isDueDate: false,
            contentIsLocked: true,
            gameName: '',
            additionalResourceType: ''
          }
        ]
      }
    ],
    ...overrides
  } as WorkflowTemplate;
}

/* --------------------------------------------------------------------------
   PATCH HELPERS.

   The field setters this file used to call moved to the shared step dialog when
   the classroom stepper needed the same editor — see
   components/workflow-step-dialog, whose spec covers the RULES (access levels as
   numbers, clearing on a category change, local-time due dates).

   What is left here is FORM behaviour: renumbering, dropping unnamed steps on
   save, the rail. These helpers go through `patchStep`/`patchContent`, which is
   exactly the path the dialog's output takes, so the tests still exercise the
   real wiring rather than a shortcut around it.
   -------------------------------------------------------------------------- */

function nameStep(component: WorkflowTemplateForm, index: number, value: string): void {
  component.patchStep(index, { workflowStepName: value });
}

function sequenceStep(component: WorkflowTemplateForm, index: number, value: string): void {
  component.patchStep(index, {
    sequenceNumber: Math.max(1, Math.floor(Number(value)) || 1)
  });
}

function durationStep(component: WorkflowTemplateForm, index: number, value: string): void {
  component.patchStep(index, {
    workflowStepDuration: value.trim() === '' ? '' : Math.max(0, Number(value) || 0)
  });
}

function skipStep(component: WorkflowTemplateForm, index: number, value: string): void {
  component.patchStep(index, {
    canSkipWorkflowStep: value === '' ? null : value === 'true'
  });
}

function nameContent(
  component: WorkflowTemplateForm,
  stepIndex: number,
  contentIndex: number,
  value: string
): void {
  component.patchContent(stepIndex, contentIndex, { contentName: value });
}

function categoriseContent(
  component: WorkflowTemplateForm,
  stepIndex: number,
  contentIndex: number,
  value: string
): void {
  component.patchContent(stepIndex, contentIndex, {
    contentCategory: value,
    contentType: ''
  });
}

describe('WorkflowTemplateForm', () => {

  it('opens empty, in custom mode, with no steps', async () => {
    const { component } = await mount();

    expect(component.templateMode()).toBe('custom');
    expect(component.templateName()).toBe('');
    expect(component.steps()).toEqual([]);
    expect(component.railValid()).toBe(false);
  });

  /** BOTH, custom first — it is the mode with fewer required fields. */
  it('offers both template modes', async () => {
    const { component } = await mount();

    expect(component.modes.map(mode => mode.code)).toEqual(['custom', 'default']);
  });

  /**
   * FROM CONFIGURATION NOW, and the seeded default is what this asserts: a missing
   * or refused Configuration/WorkflowTypes must still render these two.
   *
   * THE HYPHEN IN THE VALUE IS THE POINT. Production stores 'STEM-CLUB' hyphenated
   * on every template, so a tidied code would write documents its own list page
   * could not label.
   */
  it('offers both workflow types, hyphen kept in the value', async () => {
    const { component } = await mount();

    expect(component.workflowTypes().map(entry => entry.code)).toEqual([
      'CLASSROOM',
      'STEM-CLUB'
    ]);
    expect(component.workflowTypes()[1].label).toBe('Stem Club');
  });

  describe('the rail', () => {

    /**
     * CUSTOM: TWO FIELDS, NOT FOUR. Learning Unit Type, Maturity and Subject
     * belong to the DEFAULT rail, and requiring them here would make a custom
     * template unsaveable through fields it does not show.
     */
    it('is valid in custom mode once a name and a workflow type are given', async () => {
      const { component } = await mount();

      component.templateName.set('DGA STEM Club');
      expect(component.railValid()).toBe(false);

      component.workflowType.set('STEM-CLUB');
      expect(component.railValid()).toBe(true);
    });

    /** DEFAULT: the three, and NOT the name — that rail has no name field. */
    it('is valid in default mode once the three choices are made', async () => {
      const { component } = await mount();

      component.templateMode.set('default');
      component.workflowType.set('CLASSROOM');
      expect(component.railValid()).toBe(false);

      component.learningUnitType.set('TA');
      component.maturity.set('Gold');
      expect(component.railValid()).toBe(false);

      component.subject.set('S');
      expect(component.railValid()).toBe(true);
      // The name is derived, so an empty name field does not block it.
      expect(component.templateName()).toBe('');
    });

    /**
     * SWITCHING MODE RE-JUDGES THE RAIL. A name typed in custom mode does not
     * satisfy default's three, and this is the crossing worth a test: the fields
     * are hidden, not cleared, so a stale value must not count.
     */
    it('re-judges validity when the mode changes', async () => {
      const { component } = await mount();

      component.templateName.set('DGA STEM Club');
      component.workflowType.set('CLASSROOM');
      expect(component.railValid()).toBe(true);

      component.templateMode.set('default');
      expect(component.railValid()).toBe(false);
    });

    /** Whitespace is not a name. */
    it('does not accept a name of spaces', async () => {
      const { component } = await mount();

      component.templateName.set('   ');
      component.workflowType.set('CLASSROOM');

      expect(component.railValid()).toBe(false);
    });

    /** A disabled button that cannot explain itself reads as a broken one. */
    it('names what is still missing in custom mode', async () => {
      const { component } = await mount();

      expect(component.blockedReason())
        .toBe('Choose a template name and a workflow type to continue.');

      component.templateName.set('DGA STEM Club');
      expect(component.blockedReason()).toBe('Choose a workflow type to continue.');

      component.workflowType.set('CLASSROOM');
      expect(component.blockedReason()).toBe('');
    });

    it('names all three in default mode, comma-separated', async () => {
      const { component } = await mount();

      component.templateMode.set('default');
      component.workflowType.set('CLASSROOM');

      expect(component.blockedReason())
        .toBe('Choose a learning unit type, a maturity and a subject to continue.');
    });
  });

  describe('the steps', () => {

    it('adds a step, numbers it, and opens it', async () => {
      const { component } = await mount();

      component.addStep();

      expect(component.steps().length).toBe(1);
      expect(component.steps()[0].sequenceNumber).toBe(1);
      expect(component.openStep()).toBe(0);
    });

    /** `sequenceNumber` is positional, so a removal must renumber. */
    it('renumbers after a removal', async () => {
      const { component } = await mount();

      component.addStep();
      nameStep(component, 0, 'first');
      component.addStep();
      nameStep(component, 1, 'second');
      component.addStep();
      nameStep(component, 2, 'third');

      component.removeStep(1);

      expect(component.steps().map(step => step.workflowStepName))
        .toEqual(['first', 'third']);
      expect(component.steps().map(step => step.sequenceNumber)).toEqual([1, 2]);
    });

    it('closes the dialog when the open step is removed', async () => {
      const { component } = await mount();

      component.addStep();
      nameStep(component, 0, 'One');
      component.addStep();
      expect(component.openStep()).toBe(1);

      component.removeStep(1);
      expect(component.openStep()).toBeNull();
      expect(component.steps().length).toBe(1);
    });

    /**
     * THE LAST STEP STAYS, which is production's rule — its delete icon carries
     * 'You cannot delete this step' when one is left. A template in its step phase
     * with no steps is the state the blue button exists to prevent, so it must not
     * be reachable by deleting back down to nothing.
     */
    it('refuses to remove the only step', async () => {
      const { component } = await mount();

      component.addStep();
      nameStep(component, 0, 'One');

      component.removeStep(0);

      expect(component.steps().length).toBe(1);
    });

    /** A step needs a name before its dialog will let go. */
    it('refuses to consider an unnamed step valid', async () => {
      const { component } = await mount();

      component.addStep();
      expect(component.openStepValid()).toBe(false);

      nameStep(component, 0, 'Make or Create');
      expect(component.openStepValid()).toBe(true);
    });

    /**
     * '' IS THE UNANSWERED STATE, stored as null — three states, not two.
     *
     * The SELECT'S half of this (null rendering as '') moved to the shared step
     * dialog with the field setters; what is asserted here is what the form ends
     * up STORING, which is what `save()` writes.
     */
    it('stores the skip answer as a boolean or null', async () => {
      const { component } = await mount();

      component.addStep();
      expect(component.steps()[0].canSkipWorkflowStep).toBeNull();

      skipStep(component, 0, 'true');
      expect(component.steps()[0].canSkipWorkflowStep).toBe(true);

      skipStep(component, 0, '');
      expect(component.steps()[0].canSkipWorkflowStep).toBeNull();
    });

    /**
     * REPLACED, NOT MUTATED. The template reads `steps()`, and an assignment into
     * the stored object is a change the signal never announces.
     */
    it('replaces the step object on every edit', async () => {
      const { component } = await mount();

      component.addStep();
      const before = component.steps()[0];

      nameStep(component, 0, 'changed');

      expect(component.steps()[0]).not.toBe(before);
      expect(before.workflowStepName).toBe('');
    });

    it('clamps the sequence number to at least one', async () => {
      const { component } = await mount();

      component.addStep();
      sequenceStep(component, 0, '0');
      expect(component.steps()[0].sequenceNumber).toBe(1);

      sequenceStep(component, 0, 'abc');
      expect(component.steps()[0].sequenceNumber).toBe(1);
    });

    it('lets the duration be cleared', async () => {
      const { component } = await mount();

      component.addStep();
      durationStep(component, 0, '10');
      expect(component.steps()[0].workflowStepDuration).toBe(10);

      durationStep(component, 0, '');
      expect(component.steps()[0].workflowStepDuration).toBe('');
    });
  });

  describe('the edit prefill', () => {

    /**
     * ngOnInit, not the constructor: a signal input is not bound until after
     * construction, so a constructor read sees null and opens an empty form over a
     * real document.
     */
    it('loads the stored template', async () => {
      const { component } = await mount(storedTemplate());

      expect(component.isEdit()).toBe(true);
      expect(component.heading()).toBe('Edit Workflow Template');
      expect(component.saveLabel()).toBe('Update Workflow Template');
      expect(component.templateName()).toBe('Baseline Assessement');
      expect(component.workflowType()).toBe('STEM-CLUB');
      expect(component.steps().length).toBe(1);
    });

    /**
     * COPIED, NOT REFERENCED, and DEEPLY. The steps and their contents are nested
     * objects on an input; editing in place would show unsaved changes in the list
     * and survive a cancel.
     */
    it('does not mutate the row it was given', async () => {
      const stored = storedTemplate();
      const originalStep = stored.workflowSteps[0].workflowStepName;
      const originalContent = stored.workflowSteps[0].contents[0].contentName;

      const { component } = await mount(stored);
      nameStep(component, 0, 'edited');
      nameContent(component, 0, 0, 'edited too');

      expect(stored.workflowSteps[0].workflowStepName).toBe(originalStep);
      expect(stored.workflowSteps[0].contents[0].contentName).toBe(originalContent);
    });

    /** The document stores the subject's NAME; the select needs its code. */
    it('maps a stored subject name back to its code', async () => {
      const { component } = await mount(
        storedTemplate({ templateType: 'default', subject: 'Mathematics' })
      );

      expect(component.subject()).toBe('M');
    });

    it('gives an unknown stored subject an empty code rather than guessing', async () => {
      const { component } = await mount(storedTemplate({ subject: 'Astrophysics' }));

      expect(component.subject()).toBe('');
    });

    /** A template with no name still loads; the rail simply refuses to save. */
    it('loads a nameless template as invalid rather than blank-screening', async () => {
      const { component } = await mount(storedTemplate({ templateName: '' }));

      expect(component.templateName()).toBe('');
      expect(component.railValid()).toBe(false);
    });
  });

  describe('saving', () => {

    it('emits the fields production stores', async () => {
      const { component, saved } = await mount();

      reachSaveable(component);
      component.save();

      expect(saved.length).toBe(1);

      const draft = saved[0];
      expect(draft.templateType).toBe('custom');
      expect(draft.templateName).toBe('DGA STEM Club');
      expect(draft.workflowSteps.length).toBe(1);
      expect(draft.type).toBe('CLASSROOM');
      expect(draft.status).toBe('LIVE');

      /*
       * EMPTY, NOT ABSENT. Production's own custom templates store all three as
       * the empty string — they belong to its DEFAULT rail — and an absent key
       * reads differently from a blank one.
       */
      expect(draft.learningUnitType).toBe('');
      expect(draft.maturity).toBe('');
      expect(draft.subject).toBe('');
      expect('learningUnitType' in draft).toBe(true);
      expect('maturity' in draft).toBe(true);
      expect('subject' in draft).toBe(true);
    });

    it('refuses to save an incomplete rail', async () => {
      const { component, saved } = await mount();

      component.templateName.set('DGA STEM Club');
      component.save();

      expect(saved.length).toBe(0);
    });

    /**
     * THE FIRST CLICK OPENS THE STEPS, IT DOES NOT SAVE — production's own flow,
     * and the reason the blue button reads 'Create Workflow Template' before there
     * are steps and 'Save Workflow Template' after.
     */
    it('opens the step dialog on the first click instead of saving', async () => {
      const { component, saved } = await mount();

      fillRail(component);
      expect(component.saveLabel()).toBe('Create Workflow Template');

      component.beginSteps();

      expect(saved.length).toBe(0);
      expect(component.showSteps()).toBe(true);
      expect(component.openStep()).toBe(0);
      expect(component.saveLabel()).toBe('Save Workflow Template');
    });

    it('will not begin the steps on an incomplete rail', async () => {
      const { component } = await mount();

      component.beginSteps();

      expect(component.showSteps()).toBe(false);
      expect(component.steps()).toEqual([]);
    });

    /**
     * DISMISSING THE FIRST STEP PUTS THE FORM BACK, which is what production does
     * — an unnamed step left behind would show as a row called 'Untitled step'
     * that `save()` silently discards.
     */
    it('reverts to the rail when the first step is dismissed unnamed', async () => {
      const { component } = await mount();

      fillRail(component);
      component.beginSteps();
      component.closeStepDialog();

      expect(component.steps()).toEqual([]);
      expect(component.showSteps()).toBe(false);
      expect(component.saveLabel()).toBe('Create Workflow Template');
    });

    /** A named one stays, and the button becomes the save. */
    it('keeps a named first step', async () => {
      const { component } = await mount();

      fillRail(component);
      component.beginSteps();
      nameStep(component, 0, 'Introduction');
      component.closeStepDialog();

      expect(component.steps().length).toBe(1);
      expect(component.showSteps()).toBe(true);
    });

    /** An existing template opens straight into its steps. */
    it('opens an edited template past the rail', async () => {
      const { component } = await mount(storedTemplate());

      expect(component.showSteps()).toBe(true);
      expect(component.saveLabel()).toBe('Update Workflow Template');
    });

    /** DEFAULT MODE DERIVES ITS NAME, in production's own format. */
    it('derives the name in default mode from the three choices', async () => {
      const { component, saved } = await mount();

      component.templateMode.set('default');
      component.learningUnitType.set('TA');
      component.maturity.set('Gold');
      // The SELECT's value is the code; the document stores the name.
      component.subject.set('S');
      component.workflowType.set('CLASSROOM');

      expect(component.storedName()).toBe('Default (TA) (Science) (Gold)');

      component.beginSteps();
      nameStep(component, 0, 'Introduction');
      component.save();

      const draft = saved[0];
      expect(draft.templateName).toBe('Default (TA) (Science) (Gold)');
      // THE CODE, not 'TACtivity'.
      expect(draft.learningUnitType).toBe('TA');
      expect(draft.maturity).toBe('Gold');
      // THE NAME, not 'S'.
      expect(draft.subject).toBe('Science');
    });

    /**
     * A DEFAULT-MODE VALUE MUST NOT LEAK INTO A CUSTOM SAVE. The fields are
     * hidden when the mode flips, not cleared, so the write has to drop them.
     */
    it('writes the three empty when the mode is switched back to custom', async () => {
      const { component, saved } = await mount();

      component.templateMode.set('default');
      component.learningUnitType.set('TA');
      component.maturity.set('Gold');
      component.subject.set('S');

      component.templateMode.set('custom');
      component.templateName.set('DGA STEM Club');
      component.workflowType.set('CLASSROOM');
      component.beginSteps();
      nameStep(component, 0, 'Introduction');
      component.save();

      const draft = saved[0];
      expect(draft.templateName).toBe('DGA STEM Club');
      expect(draft.learningUnitType).toBe('');
      expect(draft.maturity).toBe('');
      expect(draft.subject).toBe('');
    });

    it('trims the template name', async () => {
      const { component, saved } = await mount();

      component.templateName.set('  DGA STEM Club  ');
      component.workflowType.set('CLASSROOM');
      component.beginSteps();
      nameStep(component, 0, 'Introduction');
      component.save();

      expect(saved[0].templateName).toBe('DGA STEM Club');
    });

    it('does not emit twice while a save is in flight', async () => {
      const { fixture, component, saved } = await mount();

      reachSaveable(component);
      fixture.componentRef.setInput('saving', true);
      component.save();

      expect(saved.length).toBe(0);
    });

    /**
     * AN UNNAMED STEP IS DROPPED. The dialog can be opened and dismissed, which
     * leaves an empty step behind, and production's player renders one as a blank
     * stage.
     */
    it('drops a step with no name and renumbers the rest', async () => {
      const { component, saved } = await mount();

      fillRail(component);
      component.beginSteps();
      nameStep(component, 0, 'First');
      component.addStep();
      // Second left unnamed. `addStep` is used directly rather than the dialog's
      // close, which now drops an unnamed step on the way out.
      component.addStep();
      nameStep(component, 2, 'Third');
      component.save();

      const steps = saved[0].workflowSteps;
      expect(steps.map(step => step.workflowStepName)).toEqual(['First', 'Third']);
      expect(steps.map(step => step.sequenceNumber)).toEqual([1, 2]);
    });

    /** And an unnamed content block goes with it. */
    it('drops a content block with no name', async () => {
      const { component, saved } = await mount();

      fillRail(component);
      component.beginSteps();
      nameStep(component, 0, 'Make or Create');
      component.addContent(0);
      nameContent(component, 0, 0, 'TACtivity Video');
      categoriseContent(component, 0, 0, 'video');
      component.addContent(0);
      component.save();

      expect(saved[0].workflowSteps[0].contents.length).toBe(1);
      expect(saved[0].workflowSteps[0].contents[0].contentName).toBe('TACtivity Video');
    });

    it('trims the step name', async () => {
      const { component, saved } = await mount();

      fillRail(component);
      component.beginSteps();
      nameStep(component, 0, '  Make or Create  ');
      component.save();

      expect(saved[0].workflowSteps[0].workflowStepName).toBe('Make or Create');
    });

    /** Escape shuts the STEP DIALOG first, and the form only when none is open. */
    it('closes the step dialog before the form', async () => {
      const { component } = await mount();
      let closed = 0;

      component.closed.subscribe(() => closed++);

      component.addStep();
      component.onEscape();

      expect(component.openStep()).toBeNull();
      expect(closed).toBe(0);

      component.onEscape();
      expect(closed).toBe(1);
    });
  });
});

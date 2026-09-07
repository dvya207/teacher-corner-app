import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';

import { Icon } from '../../components/icon/icon';
import { WorkflowTimeline } from '../../components/workflow-timeline/workflow-timeline';
import {
  ContentPatch,
  StepPatch,
  WorkflowStepDialog
} from '../../components/workflow-step-dialog/workflow-step-dialog';
import { LEARNING_UNIT_TYPES } from '../../data/learning-unit-taxonomy';
import {
  SKIP_STEP_OPTIONS,
  CUSTOM_MODE_CONTENT_CATEGORIES,
  RESOURCE_TYPES,
  WORKFLOW_CONTENT_CATEGORIES,
  WORKFLOW_MATURITIES,
  WORKFLOW_TEMPLATE_MODES,
} from '../../data/workflow-template-options';
import {
  ASSIGNMENT_TYPES,
  Assignment,
  WorkflowStep,
  WorkflowTemplate,
  WorkflowTemplateDraft,
  emptyWorkflowContent,
  emptyWorkflowStep,
  workflowTemplateName
} from '../../models/teaching.model';
import { ConfigurationService } from '../../services/configuration.service';
import { AssignmentService } from '../../services/assignment.service';

/**
 * Create / Edit Workflow Template.
 *
 * TWO PANES, as production has: a left rail carrying the template's four choices
 * and the Create button, and a modal step editor over it. The rail is where a
 * template IS defined — the four fields are also its name — and the steps are the
 * content.
 *
 * CUSTOM ONLY, on instruction. Production's Template Mode select offers Default
 * and Custom; this offers Custom alone. The field is still written, because every
 * stored template carries it and a reader filtering on 'custom' would miss a
 * document that omitted it.
 *
 * THE RAIL DEPENDS ON THE MODE, and that is the thing this component got wrong
 * first. Production's two modes collect DIFFERENT fields:
 *
 *   default  Learning Unit Type, Maturity, Subject, Workflow Type — and the name
 *            is DERIVED from them: 'Default (TA) (Science) (Silver)'
 *   custom   a TYPED template name, and Workflow Type. Nothing else.
 *
 * Its three custom templates confirm it: 'DGA STEM Club' and two 'Baseline
 * Assessement' rows, each with `learningUnitType`, `maturity` and `subject` stored
 * as the EMPTY STRING. Which is why those columns read '—' for them in the list.
 *
 * BOTH MODES ARE BUILT, and the rail SWAPS between them. Which fields are
 * required, what the name is, and what gets written all follow the mode, so the
 * three that belong to the other mode are still WRITTEN — as the empty string, or
 * as the derived name — rather than omitted. That is what production's own
 * documents carry, and an absent key reads differently from a blank one.
 *
 * ZONELESS. Every field the template reads is a signal, and the step list is
 * replaced rather than mutated so the template sees each change.
 */
@Component({
  selector: 'app-workflow-template-form',
  imports: [Icon, WorkflowTimeline, WorkflowStepDialog],
  templateUrl: './workflow-template-form.html',
  styleUrl: './workflow-template-form.css',
  host: { '(document:keydown.escape)': 'onEscape()' }
})
export class WorkflowTemplateForm implements OnInit {

  private config = inject(ConfigurationService);
  private assignmentService = inject(AssignmentService);

  /** The template being edited, or null to create one. */
  readonly template = input<WorkflowTemplate | null>(null);

  readonly saving = input(false);
  readonly error = input('');

  readonly submitted = output<WorkflowTemplateDraft>();
  readonly closed = output<void>();

  /** Every mode, for labelling; only the creatable ones are offered. */
  /** BOTH modes, Custom first — it is the one with fewer required fields. */
  readonly modes = WORKFLOW_TEMPLATE_MODES;

  /** Whether the rail is showing the DEFAULT mode's four fields. */
  readonly isDefaultMode = computed(() => this.templateMode() === 'default');

  /**
   * FROM CONFIGURATION, not from the constant.
   *
   * Production's own Configuration/WorkflowTypes holds these two, so this is a
   * document to read rather than a list to hardcode. WORKFLOW_TYPES survives as
   * the service's seed, which is what makes the read safe: a missing, empty or
   * refused document renders the same two options.
   */
  readonly workflowTypes = this.config.workflowTypes;
  readonly resourceTypes = RESOURCE_TYPES;

  /**
   * The category list, WHICH FOLLOWS THE MODE.
   *
   * Custom mode gets two; default mode gets the data-driven list. See
   * CUSTOM_MODE_CONTENT_CATEGORIES for why production's two-item list is not a
   * special case but the shape its lookup degrades to.
   */
  readonly contentCategories = computed(() =>
    this.isDefaultMode() ? WORKFLOW_CONTENT_CATEGORIES : CUSTOM_MODE_CONTENT_CATEGORIES
  );

  /** This app's three creatable assignment types, for the Assignment Type select. */
  readonly assignmentTypes = ASSIGNMENT_TYPES;

  /**
   * Every assignment this owner has, for the Assignment Name select.
   *
   * LOADED ONCE, LAZILY, and only when a content block first asks for it: most
   * templates never choose the assignment category, and the collection read is not
   * worth doing on open for a dropdown that may never be shown.
   */
  readonly assignments = signal<Assignment[]>([]);
  private assignmentsRequested = false;
  readonly skipOptions = SKIP_STEP_OPTIONS;
  readonly learningUnitTypes = LEARNING_UNIT_TYPES;
  readonly maturities = WORKFLOW_MATURITIES;

  /** This app's own five subjects, from Configuration/subjectTypes. */
  readonly subjects = this.config.subjectTypes;

  // ---- The rail ----------------------------------------------------------

  /** 'custom', and not offered otherwise. See the class note. */
  readonly templateMode = signal('custom');

  /** TYPED in custom mode, where production has no derivation to do. */
  readonly templateName = signal('');

  readonly workflowType = signal('');

  /* DEFAULT MODE'S THREE. Empty in custom mode, and written empty. */
  readonly learningUnitType = signal('');
  readonly maturity = signal('');
  readonly subject = signal('');

  readonly steps = signal<WorkflowStep[]>([]);

  readonly isEdit = computed(() => this.template() !== null);

  readonly heading = computed(() =>
    this.isEdit() ? 'Edit Workflow Template' : 'Create Workflow Template'
  );

  /**
   * The rail button's label, which is THE FLOW made visible.
   *
   * 'Create Workflow Template' opens the steps; once they are open the same
   * button saves. Production keeps two buttons in the same slot behind
   * `createWfTemplateButton` and `saveWfTemplateButton` and swaps which renders;
   * one button with two labels is the same thing said once.
   */
  readonly saveLabel = computed(() => {
    if (!this.showSteps()) {
      return 'Create Workflow Template';
    }

    return this.isEdit() ? 'Update Workflow Template' : 'Save Workflow Template';
  });

  /**
   * The name that will be stored: TYPED in custom mode, DERIVED in default.
   *
   * Production's default templates are called 'Default (TA) (Science) (Silver)',
   * built from the three choices plus the mode, and its default rail has no name
   * field at all. Shown on the rail either way, because a derived name that only
   * appears after saving is a surprise.
   */
  readonly storedName = computed(() =>
    this.isDefaultMode()
      ? workflowTemplateName(
          this.templateMode(),
          this.learningUnitType(),
          this.subjectName(),
          this.maturity()
        )
      : this.templateName().trim()
  );

  /** The subject's NAME, which is what the document stores. */
  private subjectName(): string {
    const code = this.subject();

    return this.subjects().find(entry => entry.code === code)?.name ?? code;
  }

  /**
   * Loads the stored template.
   *
   * ngOnInit, NOT the constructor: a signal input is not bound until after
   * construction, so reading `template()` there would see null on an edit and open
   * an empty form over a real document — which the first save would overwrite with
   * nothing.
   *
   * The steps are COPIED, deeply. They are nested objects on an input and the row
   * is what the table is rendering, so editing them in place would show unsaved
   * changes in the list and cancelling would not undo them.
   */
  ngOnInit(): void {
    const existing = this.template();

    if (!existing) {
      return;
    }

    this.templateMode.set(existing.templateType || 'custom');
    this.templateName.set(existing.templateName);
    this.workflowType.set(existing.type);
    this.learningUnitType.set(existing.learningUnitType);
    this.maturity.set(existing.maturity);

    // Stored as the NAME; the select's value is the code.
    this.subject.set(
      this.subjects().find(entry => entry.name === existing.subject)?.code ?? ''
    );

    this.steps.set((existing.workflowSteps ?? []).map(step => this.cloneStep(step)));

    // AN EXISTING TEMPLATE IS ALREADY PAST THE RAIL — editing one must not make
    // the reader click Create before its steps appear.
    this.showSteps.set(this.steps().length > 0);
  }

  /** A deep copy of one stored step, WITHOUT inventing keys it does not have. */
  private cloneStep(step: WorkflowStep): WorkflowStep {
    return {
      ...step,
      contents: (step.contents ?? []).map(content => ({ ...content })),
      scannedArtefacts: [...(step.scannedArtefacts ?? [])]
    };
  }

  // ---- Validation --------------------------------------------------------

  /** Which fields are required follows the mode. */
  readonly railValid = computed(() => {
    if (this.workflowType() === '') {
      return false;
    }

    return this.isDefaultMode()
      ? this.learningUnitType() !== '' && this.maturity() !== '' && this.subject() !== ''
      : this.templateName().trim() !== '';
  });

  /**
   * WHY THE BUTTON IS REFUSING, named.
   *
   * Required fields on a rail with no inline errors is exactly the case where a
   * disabled button reads as a broken one.
   */
  readonly blockedReason = computed(() => {
    const missing: string[] = [];

    if (this.isDefaultMode()) {
      if (this.learningUnitType() === '') {
        missing.push('a learning unit type');
      }

      if (this.maturity() === '') {
        missing.push('a maturity');
      }

      if (this.subject() === '') {
        missing.push('a subject');
      }
    } else if (this.templateName().trim() === '') {
      missing.push('a template name');
    }

    if (this.workflowType() === '') {
      missing.push('a workflow type');
    }

    if (missing.length === 0) {
      return '';
    }

    const list =
      missing.length === 1
        ? missing[0]
        : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;

    return `Choose ${list} to continue.`;
  });

  // ---- Steps -------------------------------------------------------------

  /**
   * Whether the template has got past its rail and into its steps.
   *
   * PRODUCTION'S OWN TWO-PHASE FLOW, and the blue button is the hinge. While this
   * is false the rail's button says CREATE WORKFLOW TEMPLATE and does not save —
   * it opens the step dialog. Once a step exists the button becomes SAVE WORKFLOW
   * TEMPLATE and the step list offers ADD MORE WORKFLOW STEP.
   *
   * `showSteps` is its name for the same flag, held with `createWfTemplateButton`
   * and `saveWfTemplateButton`; one signal covers all three because they are never
   * independent — each is the negation of another.
   *
   * WHY NOT SAVE ON THE FIRST CLICK. A template with no steps is a document a
   * learning unit can be built from that renders nothing, and this is the point
   * where that is cheapest to prevent: the button that would have created the
   * empty one instead opens the thing it is missing.
   */
  readonly showSteps = signal(false);

  /** The step being edited in the dialog, by index, or null when closed. */
  readonly openStep = signal<number | null>(null);

  readonly openStepValue = computed(() => {
    const index = this.openStep();

    return index === null ? null : (this.steps()[index] ?? null);
  });

  /** A step needs a name and a sequence number before it can be saved. */
  readonly openStepValid = computed(() => {
    const step = this.openStepValue();

    return step !== null && step.workflowStepName.trim() !== '' && step.sequenceNumber >= 1;
  });

  /**
   * The rail's blue button: OPENS THE STEP DIALOG, and does not save.
   *
   * Production's `createWorkflowTemplate()` verbatim in behaviour — it flips
   * `showSteps` and adds the first step if there is none, which opens the dialog
   * on it. From then on the same button saves.
   */
  beginSteps(): void {
    if (!this.railValid()) {
      return;
    }

    this.showSteps.set(true);

    if (this.steps().length === 0) {
      this.addStep();
    }
  }

  /** Adds a step and opens it, numbered after the last. */
  addStep(): void {
    this.steps.update(list => [...list, emptyWorkflowStep(list.length + 1)]);
    this.openStep.set(this.steps().length - 1);
  }

  editStep(index: number): void {
    this.openStep.set(index);
  }

  /**
   * Closes the dialog, and DROPS AN UNNAMED STEP on the way out.
   *
   * Dismissing the dialog on the step the blue button just created has to leave
   * the form as it found it: production reverts to CREATE WORKFLOW TEMPLATE when
   * the dialog closes with no steps, and an unnamed step left in the list would
   * otherwise sit there as a row called 'Untitled step' that `save()` silently
   * discards later — visible, unsaveable, and not obviously either.
   */
  closeStepDialog(): void {
    const index = this.openStep();

    if (index !== null && (this.steps()[index]?.workflowStepName ?? '').trim() === '') {
      this.steps.update(list => list.filter((_, position) => position !== index));
    }

    this.openStep.set(null);

    // Back to phase one, as production does, when nothing survived.
    if (this.steps().length === 0) {
      this.showSteps.set(false);
    }
  }

  /**
   * Removes a step and RENUMBERS the rest.
   *
   * `sequenceNumber` is positional and production orders by it, so leaving a gap
   * would save a template whose steps claim numbers that no longer match.
   */
  removeStep(index: number): void {
    /*
     * THE LAST STEP CANNOT BE REMOVED, which is production's rule — its delete
     * icon carries the tooltip 'You cannot delete this step' when one is left. A
     * template that has entered its step phase with zero steps is the state the
     * blue button exists to prevent, so it is not reachable by another route.
     */
    if (this.steps().length <= 1) {
      return;
    }

    this.steps.update(list =>
      list
        .filter((_, position) => position !== index)
        .map((step, position) => ({ ...step, sequenceNumber: position + 1 }))
    );

    this.openStep.set(null);
  }

  /**
   * Writes one field of one step.
   *
   * REPLACES THE ARRAY AND THE STEP rather than assigning into them. The template
   * reads `steps()`, and a mutation in place is a change the signal never
   * announces — under zoneless change detection the edit would not appear.
   */
  /** PUBLIC because the shared step dialog's patches land here. */
  patchStep(index: number, patch: StepPatch): void {
    this.steps.update(list =>
      list.map((step, position) => (position === index ? { ...step, ...patch } : step))
    );
  }










  // ---- Contents ----------------------------------------------------------

  addContent(stepIndex: number): void {
    this.steps.update(list =>
      list.map((step, position) =>
        position === stepIndex
          ? { ...step, contents: [...step.contents, emptyWorkflowContent()] }
          : step
      )
    );
  }

  removeContent(stepIndex: number, contentIndex: number): void {
    this.steps.update(list =>
      list.map((step, position) =>
        position === stepIndex
          ? {
              ...step,
              contents: step.contents.filter((_, at) => at !== contentIndex)
            }
          : step
      )
    );
  }

  /** PUBLIC for the same reason as patchStep. */
  patchContent(
    stepIndex: number,
    contentIndex: number,
    patch: ContentPatch['patch']
  ): void {
    this.steps.update(list =>
      list.map((step, position) =>
        position === stepIndex
          ? {
              ...step,
              contents: step.contents.map((content, at) =>
                at === contentIndex ? { ...content, ...patch } : content
              )
            }
          : step
      )
    );
  }














  /**
   * The content's Access Level, which writes `contentIsLocked`.
   *
   * A FREE-TEXT FIELD ONTO A FIELD STORED AS A BOOLEAN, A STRING OR A NUMBER —
   * production has written all of true, false, '' and 1 there. The field is
   * labelled Access Level in its own dialog, so the value it takes is whatever the
   * builder types; coercing it to a boolean here would discard the levels.
   */



  // ---- Saving ------------------------------------------------------------

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  checkedOf(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  /**
   * Emits the template.
   *
   * THE STEPS ARE RENUMBERED AND TRIMMED on the way out, and any step left without
   * a name is dropped: the dialog can be opened and dismissed, which leaves an
   * empty step behind, and an unnamed step is one production's player renders as a
   * blank stage.
   */
  save(): void {
    if (this.saving() || !this.railValid() || !this.showSteps()) {
      return;
    }

    const steps = this.steps()
      .filter(step => step.workflowStepName.trim() !== '')
      .map((step, index) => ({
        ...step,
        workflowStepName: step.workflowStepName.trim(),
        sequenceNumber: index + 1,
        contents: step.contents.filter(content => content.contentName.trim() !== '')
      }));

    const isDefault = this.isDefaultMode();

    this.submitted.emit({
      templateName: this.storedName(),
      templateType: this.templateMode(),
      /*
       * WRITTEN EITHER WAY, EMPTY IN CUSTOM MODE. Production's own custom
       * templates store all three as the empty string — they belong to its
       * default rail — and an absent key reads differently from a blank one.
       */
      learningUnitType: isDefault ? this.learningUnitType() : '',
      maturity: isDefault ? this.maturity() : '',
      subject: isDefault ? this.subjectName() : '',
      type: this.workflowType(),
      status: 'LIVE',
      workflowSteps: steps
    });
  }

  close(): void {
    this.closed.emit();
  }

  /** Escape shuts the STEP DIALOG first, and the form only when none is open. */
  onEscape(): void {
    if (this.openStep() !== null) {
      this.closeStepDialog();
      return;
    }

    this.close();
  }
}

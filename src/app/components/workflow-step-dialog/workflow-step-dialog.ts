import { Component, computed, inject, input, output, signal } from '@angular/core';

import { Icon } from '../icon/icon';
import {
  localInputFromTimestamp,
  timestampFromLocalInput
} from '../../core/local-datetime';
import {
  CUSTOM_MODE_CONTENT_CATEGORIES,
  RESOURCE_TYPES,
  SKIP_STEP_OPTIONS,
  WORKFLOW_CONTENT_CATEGORIES,
  contentSubCategoriesFor
} from '../../data/workflow-template-options';
import { CodedOption } from '../../core/configuration';
import {
  ASSIGNMENT_TYPES,
  Assignment,
  WorkflowContent,
  WorkflowStep
} from '../../models/teaching.model';
import { AssignmentService } from '../../services/assignment.service';

/** One field change on the step being edited. */
export type StepPatch = Partial<WorkflowStep>;

/** One field change on a content block, and which block it is. */
export interface ContentPatch {
  index: number;
  patch: Partial<WorkflowContent>;
}

/**
 * The workflow STEP EDITOR — production's own dialog, shared by both callers.
 *
 * TWO PAGES OPEN THIS SAME DIALOG, which is why it is a component:
 *
 *   the workflow-template form, building a blueprint's steps
 *   the classroom stepper, editing one learning unit's workflow
 *
 * Production shares one `WorkflowStepDialogComponent` between the equivalent two,
 * and the reason is not tidiness: a step is a step, and a second copy of a form
 * this size is a second place for the field rules to drift — which they had
 * already started to do before this was pulled out.
 *
 * IT EMITS PATCHES, IT DOES NOT HOLD A DRAFT. The step comes in as an input and
 * every edit goes out as a `Partial<WorkflowStep>` for the caller to apply to its
 * own list. That is deliberate: a local draft would need syncing back to an input
 * that changes underneath it, and the loop between "parent writes, input changes,
 * draft resets" is exactly the bug that shape invites. The caller owns the list;
 * this owns the RULES for changing one step in it.
 *
 * WHAT THE RULES ARE, since they are the substance here rather than the markup:
 * an access level is a number but blank stays blank; changing a content category
 * clears every field belonging to the old one; choosing an assignment stores its
 * name AND its id because names are not unique; a due date is parsed in local time.
 * Each is commented at its setter.
 */
@Component({
  selector: 'app-workflow-step-dialog',
  imports: [Icon],
  templateUrl: './workflow-step-dialog.html',
  styleUrl: './workflow-step-dialog.css'
})
export class WorkflowStepDialog {

  private assignmentService = inject(AssignmentService);

  readonly step = input.required<WorkflowStep>();

  /**
   * 'custom' or 'default' — WHICH CONTENT CATEGORIES ARE OFFERED.
   *
   * Custom mode gets two; default gets the data-driven list. See
   * CUSTOM_MODE_CONTENT_CATEGORIES for why production's two-item list is not a
   * special case but the shape its lookup degrades to when a template carries no
   * learning-unit type or maturity.
   */
  readonly templateMode = input('custom');

  /**
   * THE SLOTS THIS LEARNING UNIT ACTUALLY HAS, as `category -> sub-categories`.
   *
   * WHY THIS INPUT EXISTS, and it fixed a real gap. The sub-category list used to
   * come from CONTENT_SUB_CATEGORIES, which was read off production's 384 stored
   * template content blocks — that is what templates have HISTORICALLY pointed at,
   * not what a unit can HOLD. The two disagree badly: a TACtivity at gold has 15
   * `video` slots and the fixed list offered 3, `socialMedia` was missing
   * altogether, and several `graphics` names in the list appear in no document. So
   * a teacher could attach a file to a slot and then be unable to select it in a
   * workflow step, and the step would report no file attached.
   *
   * PASSED BY THE STEPPER, which knows the unit and can read the schema for its
   * type and maturity — the same table the learning-unit editor renders its upload
   * tabs from, so anything attachable is selectable. EMPTY FROM THE TEMPLATE FORM,
   * which has no unit: a blueprint is written before it is applied to anything, so
   * it falls back to the stored-block list, exactly as production's own template
   * dialog falls back when a template carries no type or maturity.
   */
  readonly categorySlots = input<Readonly<Record<string, readonly string[]>>>({});

  readonly stepChanged = output<StepPatch>();
  readonly contentChanged = output<ContentPatch>();
  readonly contentAdded = output<void>();
  readonly contentRemoved = output<number>();
  readonly closed = output<void>();

  readonly skipOptions = SKIP_STEP_OPTIONS;
  readonly resourceTypes = RESOURCE_TYPES;
  readonly assignmentTypes = ASSIGNMENT_TYPES;

  /**
   * The categories offered.
   *
   * FROM THE UNIT'S SCHEMA WHERE THERE IS ONE, plus the two that are not resource
   * categories at all. Production builds its list the same way —
   * `Object.keys(resourceNames[type][maturity])` then pushes 'additional
   * resources' and 'assignment' — and falls back to the two-item custom list when
   * it has no type or maturity to look up.
   */
  readonly contentCategories = computed<readonly CodedOption[]>(() => {
    const slots = this.categorySlots();
    const names = Object.keys(slots);

    if (names.length === 0) {
      return this.templateMode() === 'default'
        ? WORKFLOW_CONTENT_CATEGORIES
        : CUSTOM_MODE_CONTENT_CATEGORIES;
    }

    return [
      ...names.map(code => ({ code, label: titleise(code) })),
      { code: 'additional resources', label: 'Additional Resources' },
      { code: 'assignment', label: 'Assignment' }
    ];
  });

  /**
   * Every assignment this owner has, for the Assignment Name select.
   *
   * LOADED ONCE, LAZILY, and only when a content block first asks for it: most
   * steps never choose the assignment category, and the collection read is not
   * worth doing on open for a dropdown that may never be shown.
   */
  readonly assignments = signal<Assignment[]>([]);
  private assignmentsRequested = false;

  /** A step needs a name and a sequence number before the dialog will let go. */
  readonly valid = computed(() => {
    const step = this.step();

    return step.workflowStepName.trim() !== '' && step.sequenceNumber >= 1;
  });

  // ---- The step's own fields ---------------------------------------------

  setStepName(value: string): void {
    this.stepChanged.emit({ workflowStepName: value });
  }

  setStepSequence(value: string): void {
    this.stepChanged.emit({
      sequenceNumber: Math.max(1, Math.floor(Number(value)) || 1)
    });
  }

  setStepDescription(value: string): void {
    this.stepChanged.emit({ workflowStepDescription: value });
  }

  setStepDuration(value: string): void {
    this.stepChanged.emit({
      workflowStepDuration: value.trim() === '' ? '' : Math.max(0, Number(value) || 0)
    });
  }

  setViewUnlab(value: boolean): void {
    this.stepChanged.emit({ viewUnlab: value });
  }

  setStepLocation(value: string): void {
    this.stepChanged.emit({ workflowLocation: value });
  }

  /** The step's "Access Level". A NUMBER, for the reason accessLevel gives. */
  setStepAccess(value: string): void {
    this.stepChanged.emit({ allowAccess: accessLevel(value) });
  }

  /** Three states, not two: null is production's unanswered. */
  setCanSkip(value: string): void {
    this.stepChanged.emit({
      canSkipWorkflowStep: value === '' ? null : value === 'true'
    });
  }

  // ---- Contents -----------------------------------------------------------

  addContent(): void {
    this.contentAdded.emit();
  }

  removeContent(index: number): void {
    this.contentRemoved.emit(index);
  }

  setContentName(index: number, value: string): void {
    this.contentChanged.emit({ index, patch: { contentName: value } });
  }

  /**
   * Changing the category CLEARS EVERY FIELD BELONGING TO THE OLD ONE.
   *
   * Each category shows a different set — 'custom resource' has a resource type,
   * 'assignment' has a type, a name, an id and a due date, the rest have a
   * sub-category. Those fields stay in the object when the select changes and the
   * inputs holding them leave the DOM, so without this, choosing Assignment,
   * picking one, then switching to Custom Resource would store a block that is a
   * custom resource AND carries an assignment id nothing shows.
   *
   * `contentType` IS CLEARED, NOT SET TO THE CATEGORY. Production's own 352
   * content blocks settle it: all 114 assignment blocks carry '', never
   * 'assignment', and elsewhere it holds a semantic word or nothing. Its step
   * dialog has no control for the field at all.
   */
  setContentCategory(index: number, value: string): void {
    this.contentChanged.emit({
      index,
      patch: {
        contentCategory: value,
        contentType: '',
        contentSubCategory: '',
        additionalResourceType: '',
        customResourceType: '',
        assignmentType: '',
        assignmentName: '',
        assignmentId: '',
        isDueDate: false,
        assignmentDueDate: null
      }
    });

    if (value === 'assignment') {
      void this.loadAssignments();
    }
  }

  setContentSubCategory(index: number, value: string): void {
    this.contentChanged.emit({ index, patch: { contentSubCategory: value } });
  }

  /** DEFAULT mode's field; see the model's note on why there are two. */
  setAdditionalResourceType(index: number, value: string): void {
    this.contentChanged.emit({ index, patch: { additionalResourceType: value } });
  }

  /** CUSTOM mode's field, same three options. */
  setCustomResourceType(index: number, value: string): void {
    this.contentChanged.emit({ index, patch: { customResourceType: value } });
  }

  /**
   * Changing the type CLEARS THE CHOSEN ASSIGNMENT.
   *
   * The name select is filtered by the type, so a name chosen under QUIZ is not in
   * the list once the type is UPLOAD — leaving it would store a name and an id
   * that disagree with the type beside them, while the select rendered blank.
   */
  setAssignmentType(index: number, value: string): void {
    this.contentChanged.emit({
      index,
      patch: { assignmentType: value, assignmentName: '', assignmentId: '' }
    });
  }

  /**
   * Stores the NAME AND THE ID TOGETHER.
   *
   * Production's select stores `displayName` and keeps `assignmentId` beside it,
   * and both are needed: the name is what its player shows, the id is what it
   * loads. The select's value here is the id, because two assignments may share a
   * display name and the id is the only thing that says which was chosen.
   */
  setAssignmentByDocId(index: number, docId: string): void {
    const chosen = this.assignments().find(assignment => assignment.docId === docId);

    this.contentChanged.emit({
      index,
      patch: {
        assignmentId: chosen?.docId ?? '',
        assignmentName: chosen?.displayName ?? ''
      }
    });
  }

  /** The "Is there a due date?" select. Clears the date when set to No. */
  setContentDueDate(index: number, value: string): void {
    const wanted = value === 'true';

    this.contentChanged.emit({
      index,
      patch: {
        isDueDate: wanted,
        assignmentDueDate: wanted
          ? this.step().contents[index]?.assignmentDueDate ?? null
          : null
      }
    });
  }

  /** The due-date picker, which is a `datetime-local` value. */
  setContentDueDateValue(index: number, value: string): void {
    this.contentChanged.emit({
      index,
      patch: { assignmentDueDate: timestampFromLocalInput(value) }
    });
  }

  /**
   * Access Level, which writes `contentIsLocked`.
   *
   * THE FIELD NAME AND ITS MEANING DISAGREE, and that is production's, not a
   * mistake here: its input is `type="number"` with `min="1"` and `max="10"` bound
   * to `contentIsLocked`. It is a LEVEL, not a lock, which is why the stored data
   * holds `1` next to `true`, `false` and `''` — the field was a boolean once and
   * the old values were never migrated.
   */
  setContentAccess(index: number, value: string): void {
    this.contentChanged.emit({
      index,
      patch: { contentIsLocked: accessLevel(value) }
    });
  }

  // ---- Reading ------------------------------------------------------------

  /** The stored due date as a `datetime-local` value, or '' when there is none. */
  dueDateInputValue(content: WorkflowContent): string {
    return localInputFromTimestamp(content.assignmentDueDate);
  }

  /** The assignments the Assignment Name select should offer for this block. */
  assignmentsForContent(content: WorkflowContent): Assignment[] {
    if (content.assignmentType === '') {
      return [];
    }

    return this.assignments().filter(
      assignment => assignment.type === content.assignmentType
    );
  }

  /**
   * The sub-categories for a content block, or none.
   *
   * NONE IS A REAL ANSWER: the two resource categories and the assignment
   * category all have no sub-category select in production, and the dialog hides
   * the field on an empty list rather than showing an empty dropdown.
   */
  subCategoriesFor(content: WorkflowContent): readonly string[] {
    const fromUnit = this.categorySlots()[content.contentCategory];

    return fromUnit ?? contentSubCategoriesFor(content.contentCategory);
  }

/** The select's value for a stored boolean-or-null. */
  canSkipValue(step: WorkflowStep): string {
    return step.canSkipWorkflowStep === null || step.canSkipWorkflowStep === undefined
      ? ''
      : String(step.canSkipWorkflowStep);
  }

  /** A content block needs a name and a category. */
  contentValid(content: WorkflowContent): boolean {
    return content.contentName.trim() !== '' && content.contentCategory !== '';
  }

  close(): void {
    this.closed.emit();
  }

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  checkedOf(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  /**
   * Reads the owner's assignments once.
   *
   * A FAILED READ IS SWALLOWED, deliberately: the list is one dropdown's options,
   * the rest of the dialog works without it, and the empty select plus the note
   * beneath it already say there is nothing to choose. Throwing here would take
   * down the step editor over a field the author may not be using.
   */
  private async loadAssignments(): Promise<void> {
    if (this.assignmentsRequested) {
      return;
    }

    this.assignmentsRequested = true;

    try {
      this.assignments.set(await this.assignmentService.list());
    } catch {
      this.assignments.set([]);
    }
  }
}

/**
 * A schema key as a label: 'socialMedia' -> 'Social Media', '3S' -> '3S'.
 *
 * THE KEYS ARE THE VOCABULARY and they are camelCase with exceptions, so this
 * splits on case boundaries and capitalises. It deliberately leaves a key that is
 * already short and upper — '3S', 'tnt' — recognisable rather than mangling it
 * into '3 S'.
 */
function titleise(key: string): string {
  if (key.length <= 3) {
    return key;
  }

  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * An "Access Level" field's value, as a NUMBER where there is one.
 *
 * PRODUCTION WRITES A NUMBER AND THIS ONCE WROTE A STRING, which a live save
 * caught: the document came back holding `contentIsLocked: "2"` where its own
 * documents hold int64 `1`. The mechanism is Angular's and easy to miss —
 * `<input type="number" formControlName>` binds through NumberValueAccessor rather
 * than DefaultValueAccessor, so a reactive form yields a number from the same
 * markup a plain `(input)` handler yields a string from. This app reads
 * `event.target.value`, which is always a string, so the coercion has to be here.
 *
 * A BLANK FIELD STAYS THE EMPTY STRING rather than becoming 0. Empty means
 * unanswered and production's own documents carry '' for it; 0 is a level, and one
 * outside the 1-10 the input allows.
 *
 * A NON-NUMERIC VALUE IS PASSED THROUGH UNCHANGED. `type="number"` makes one hard
 * to produce, but a browser that allowed it should not have it silently turned
 * into NaN — which Firestore rejects, failing the whole write.
 */
export function accessLevel(value: string): number | string {
  const trimmed = value.trim();

  if (trimmed === '') {
    return '';
  }

  const parsed = Number(trimmed);

  return Number.isFinite(parsed) ? parsed : value;
}

import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  ContentPatch,
  StepPatch,
  WorkflowStepDialog,
  accessLevel
} from './workflow-step-dialog';
import {
  WorkflowContent,
  WorkflowStep,
  emptyWorkflowContent,
  emptyWorkflowStep
} from '../../models/teaching.model';
import { AssignmentService } from '../../services/assignment.service';

/**
 * The shared workflow step editor.
 *
 * WHY THIS FILE EXISTS. The rules tested here used to live on the workflow
 * template form and were tested there. When the classroom stepper needed the same
 * editor the dialog became a component, and these tests came with the code rather
 * than being left behind pointing at a form that no longer owns them.
 *
 * WHAT IS WORTH TESTING, and it is not the markup. Every case below is a rule that
 * writes a document production has to be able to read, and each one is quiet when
 * wrong:
 *
 *   1. AN ACCESS LEVEL IS A NUMBER. A live save caught this storing "2" where
 *      production's own documents hold int64 1.
 *   2. CHANGING A CATEGORY CLEARS THE OLD ONE'S FIELDS. The inputs leave the DOM;
 *      the values do not, so a resource block could keep an assignment id that
 *      nothing on screen shows.
 *   3. AN ASSIGNMENT STORES ITS NAME AND ITS ID. Display names are not unique.
 *   4. A DUE DATE IS LOCAL. `new Date('2026-09-05')` is UTC by spec, which lands a
 *      deadline on the previous day for anywhere west of UTC and 05:30 out here.
 *
 * IT EMITS PATCHES RATHER THAN HOLDING A DRAFT, so every test asserts on what was
 * emitted. That is the real contract: the caller owns the list.
 */

class StubAssignmentService {
  assignments: unknown[] = [];
  listCalls = 0;
  shouldThrow = false;

  async list(): Promise<unknown[]> {
    this.listCalls += 1;

    if (this.shouldThrow) {
      throw new Error('refused');
    }

    return this.assignments;
  }
}

interface Mounted {
  fixture: ComponentFixture<WorkflowStepDialog>;
  component: WorkflowStepDialog;
  assignments: StubAssignmentService;
  /** Every step patch emitted, in order. */
  steps: StepPatch[];
  /** Every content patch emitted, in order. */
  contents: ContentPatch[];
  added: number;
  removed: number[];
  closed: number;
  /** Applies the emitted patches so a test can assert on the resulting step. */
  result(): WorkflowStep;
}

async function mount(step?: Partial<WorkflowStep>): Promise<Mounted> {
  const assignments = new StubAssignmentService();

  TestBed.configureTestingModule({
    imports: [WorkflowStepDialog],
    providers: [{ provide: AssignmentService, useValue: assignments }]
  });

  const fixture = TestBed.createComponent(WorkflowStepDialog);
  const start: WorkflowStep = { ...emptyWorkflowStep(1), ...step };

  fixture.componentRef.setInput('step', start);
  fixture.detectChanges();
  await fixture.whenStable();

  const state: Mounted = {
    fixture,
    component: fixture.componentInstance,
    assignments,
    steps: [],
    contents: [],
    added: 0,
    removed: [],
    closed: 0,
    result(): WorkflowStep {
      const merged: WorkflowStep = { ...start, contents: [...start.contents] };

      for (const patch of state.steps) {
        Object.assign(merged, patch);
      }

      for (const { index, patch } of state.contents) {
        merged.contents[index] = { ...merged.contents[index], ...patch };
      }

      return merged;
    }
  };

  state.component.stepChanged.subscribe(patch => state.steps.push(patch));
  state.component.contentChanged.subscribe(patch => state.contents.push(patch));
  state.component.contentAdded.subscribe(() => (state.added += 1));
  state.component.contentRemoved.subscribe(index => state.removed.push(index));
  state.component.closed.subscribe(() => (state.closed += 1));

  return state;
}

/** A step carrying one content block, which most of these tests need. */
function withContent(content?: Partial<WorkflowContent>): Partial<WorkflowStep> {
  return { contents: [{ ...emptyWorkflowContent(), ...content }] };
}

describe('WorkflowStepDialog', () => {

  describe('the step fields', () => {

    it('needs a name before it is valid', async () => {
      const { component, fixture } = await mount();

      expect(component.valid()).toBe(false);

      fixture.componentRef.setInput('step', {
        ...emptyWorkflowStep(1),
        workflowStepName: 'Make or Create'
      });
      fixture.detectChanges();

      expect(component.valid()).toBe(true);
    });

    it('emits the name as typed', async () => {
      const { component, steps } = await mount();

      component.setStepName('Make or Create');

      expect(steps).toEqual([{ workflowStepName: 'Make or Create' }]);
    });

    /** A sequence number is positional and 1-based; 0 would break the ordering. */
    it('floors the sequence number at one', async () => {
      const { component, steps } = await mount();

      component.setStepSequence('0');
      component.setStepSequence('3.7');
      component.setStepSequence('not a number');

      expect(steps).toEqual([
        { sequenceNumber: 1 },
        { sequenceNumber: 3 },
        { sequenceNumber: 1 }
      ]);
    });

    /**
     * A DURATION IS A NUMBER, and blank stays blank.
     *
     * Production's own template steps hold a number in 221 of 238, the empty
     * string in 6 and null in 11 — so '' is a real stored value meaning
     * unanswered, and turning it into 0 would claim a step takes no time.
     */
    it('stores a duration as a number, keeping blank blank', async () => {
      const { component, steps } = await mount();

      component.setStepDuration('15');
      component.setStepDuration('');
      component.setStepDuration('-4');

      expect(steps).toEqual([
        { workflowStepDuration: 15 },
        { workflowStepDuration: '' },
        { workflowStepDuration: 0 }
      ]);
    });

    /**
     * ACCESS LEVEL IS A NUMBER, and a live save is what caught this: the document
     * came back holding "2" where production's own documents hold int64 1.
     */
    it('stores the access level as a number', async () => {
      const { component, steps } = await mount();

      component.setStepAccess('3');

      expect(steps).toEqual([{ allowAccess: 3 }]);
    });

    /** THREE STATES, NOT TWO: '' is production's unanswered, stored as null. */
    it('maps the skip select through null', async () => {
      const { component, steps } = await mount();

      component.setCanSkip('true');
      component.setCanSkip('false');
      component.setCanSkip('');

      expect(steps).toEqual([
        { canSkipWorkflowStep: true },
        { canSkipWorkflowStep: false },
        { canSkipWorkflowStep: null }
      ]);
    });

    /**
     * YES AND NO ARE LABELS; THE STORED VALUE IS STILL A BOOLEAN.
     *
     * The pair is worth asserting together: relabelling a select is the kind of
     * change that quietly takes the value with it, and this field is read by
     * production's player as a boolean.
     */
    it('labels the skip answers Yes and No while storing booleans', async () => {
      const { component, steps } = await mount();

      expect(component.skipOptions.map(option => option.label)).toEqual(['Yes', 'No']);
      expect(component.skipOptions.map(option => option.code)).toEqual([
        'true',
        'false'
      ]);

      component.setCanSkip('true');

      expect(steps[0]).toEqual({ canSkipWorkflowStep: true });
    });

    /** And the select's own value for each of those three. */
    it('renders the stored skip value back into the select', async () => {
      const { component } = await mount();

      expect(component.canSkipValue({ ...emptyWorkflowStep(1) })).toBe('');
      expect(
        component.canSkipValue({ ...emptyWorkflowStep(1), canSkipWorkflowStep: true })
      ).toBe('true');
      expect(
        component.canSkipValue({ ...emptyWorkflowStep(1), canSkipWorkflowStep: false })
      ).toBe('false');
    });
  });

  describe('the content categories', () => {

    /**
     * THE LIST FOLLOWS THE TEMPLATE MODE, and the two-item custom list is not a
     * special case: production builds it from
     * `Configuration/resourceNames[<luType>][<maturity>]`, a custom template
     * stores both of those empty, and every early-return branch of its
     * `getCategories` falls back to exactly these two.
     */
    it('offers custom mode two categories, and only two', async () => {
      const { component } = await mount();

      expect(component.contentCategories().map(entry => entry.code)).toEqual([
        'custom resource',
        'assignment'
      ]);
    });

    it('offers default mode the data-driven list', async () => {
      const { component, fixture } = await mount();

      fixture.componentRef.setInput('templateMode', 'default');
      fixture.detectChanges();

      expect(component.contentCategories().map(entry => entry.code)).toEqual([
        'video',
        'tacDev',
        '3S',
        'graphics',
        'tnt',
        'additional resources',
        'assignment'
      ]);
    });

    /** The same three resource kinds serve both, with production's own wording. */
    it("offers production's three resource kinds", async () => {
      const { component } = await mount();

      expect(component.resourceTypes.map(entry => entry.code)).toEqual([
        'PDF',
        'LINK',
        'PPT'
      ]);
      expect(component.resourceTypes[1].label).toBe('Paste YouTube Link');
    });

    /** GAME and TEXTBLOCK are not creatable in this app, so they are not offered. */
    it("offers only this app's three assignment types", async () => {
      const { component } = await mount();

      expect(component.assignmentTypes.map(entry => entry.type)).toEqual([
        'QUIZ',
        'UPLOAD',
        'FORM'
      ]);
    });

    /**
     * THE UNIT'S OWN SLOTS WIN OVER THE FIXED LIST, and this is the fix for a real
     * gap. CONTENT_SUB_CATEGORIES was read off production's stored template
     * blocks — what templates have HISTORICALLY pointed at, not what a unit can
     * HOLD. A TACtivity at gold has six `video` slots and the fixed list offered
     * three; `socialMedia` was absent entirely. So a teacher could attach a file
     * and then be unable to name that slot in a step, and the step would report no
     * file attached.
     */
    it('offers the unit’s own slots when the caller supplies them', async () => {
      const { component, fixture } = await mount();

      fixture.componentRef.setInput('categorySlots', {
        video: ['tacVideoUrl', 'tacVideoMp4', 'tacVideoDriveUrl'],
        socialMedia: ['tacVideoReelMp4']
      });
      fixture.detectChanges();

      expect(
        component.subCategoriesFor({
          ...emptyWorkflowContent(),
          contentCategory: 'video'
        })
      ).toEqual(['tacVideoUrl', 'tacVideoMp4', 'tacVideoDriveUrl']);

      // AND THE CATEGORY LIST TOO, plus the two that are not resource categories.
      expect(component.contentCategories().map(entry => entry.code)).toEqual([
        'video',
        'socialMedia',
        'additional resources',
        'assignment'
      ]);
    });

    /** A camelCase schema key reads as words; a short one is left alone. */
    it('labels a schema key readably', async () => {
      const { component, fixture } = await mount();

      fixture.componentRef.setInput('categorySlots', { socialMedia: [], '3S': [] });
      fixture.detectChanges();

      const labels = component.contentCategories().map(entry => entry.label);

      expect(labels).toContain('Social Media');
      expect(labels).toContain('3S');
    });

    /**
     * THE TEMPLATE FORM PASSES NONE, because a blueprint is written before it is
     * applied to any unit — so it falls back to the stored-block list, exactly as
     * production's template dialog falls back when a template carries no type or
     * maturity.
     */
    it('falls back to the fixed list when no slots are supplied', async () => {
      const { component } = await mount();

      expect(
        component.subCategoriesFor({
          ...emptyWorkflowContent(),
          contentCategory: 'video'
        }).length
      ).toBeGreaterThan(0);
      expect(component.contentCategories().map(entry => entry.code)).toEqual([
        'custom resource',
        'assignment'
      ]);
    });

    /**
     * NO SUB-CATEGORY on the categories production does not ask for one on.
     *
     * 'assignment' does exist as a stored contentSubCategory — 15 times against
     * 124 empties — which is why the field looked legitimate. Offering it is a
     * dropdown with one option under a question production never asks.
     */
    it('hides the sub-category on the categories that have none', async () => {
      const { component } = await mount();

      const of = (category: string) =>
        component.subCategoriesFor({ ...emptyWorkflowContent(), contentCategory: category });

      expect(of('assignment')).toEqual([]);
      expect(of('custom resource')).toEqual([]);
      expect(of('additional resources')).toEqual([]);
      expect(of('video').length).toBeGreaterThan(0);
    });
  });

  describe('changing the category', () => {

    /**
     * `contentType` IS NOT THE CATEGORY, and this once wrote that it was.
     *
     * Production's own 352 content blocks say otherwise. All 114 assignment blocks
     * carry contentType '' — never 'assignment'. Elsewhere it holds a semantic
     * word, usually the sub-category, and is '' in most. The only category whose
     * name ever appears is 'video', 12 times against 3 empties, which is where the
     * wrong idea came from: one category out of seven happens to match.
     */
    it('does not write the category into the content type', async () => {
      const { component, contents } = await mount(withContent());

      component.setContentCategory(0, 'video');

      expect(contents[0].patch.contentCategory).toBe('video');
      expect(contents[0].patch.contentType).toBe('');
    });

    /**
     * EVERY PER-CATEGORY FIELD IS CLEARED. The inputs holding them leave the DOM
     * when the select changes; the values do not — so without this, a block that
     * had an assignment chosen and was then switched to a resource would save as a
     * resource still carrying an assignment id nothing on the form shows.
     */
    it('clears every field belonging to the previous category', async () => {
      const { component, contents } = await mount(withContent());

      component.setContentCategory(0, 'custom resource');

      expect(contents[0].patch).toEqual({
        contentCategory: 'custom resource',
        contentType: '',
        contentSubCategory: '',
        additionalResourceType: '',
        customResourceType: '',
        assignmentType: '',
        assignmentName: '',
        assignmentId: '',
        isDueDate: false,
        assignmentDueDate: null
      });
    });

    /**
     * 'custom resource' AND 'additional resources' ARE THE SAME IDEA, one per
     * mode, and each writes ITS OWN FIELD. Crossing them stores a resource kind
     * under a key the other app does not read.
     */
    it('keeps the two resource-kind fields apart', async () => {
      const { component, contents } = await mount(withContent());

      component.setCustomResourceType(0, 'LINK');
      component.setAdditionalResourceType(0, 'PDF');

      expect(contents[0].patch).toEqual({ customResourceType: 'LINK' });
      expect(contents[1].patch).toEqual({ additionalResourceType: 'PDF' });
    });

    /** Choosing the assignment category loads the list the name select needs. */
    it('loads the assignments when the category becomes assignment', async () => {
      const { component, assignments } = await mount(withContent());

      component.setContentCategory(0, 'video');
      expect(assignments.listCalls).toBe(0);

      component.setContentCategory(0, 'assignment');
      await Promise.resolve();

      expect(assignments.listCalls).toBe(1);
    });

    /** ONCE, not per block: several assignment blocks share the one list. */
    it('reads the assignment list only once', async () => {
      const { component, assignments } = await mount(withContent());

      component.setContentCategory(0, 'assignment');
      await Promise.resolve();
      component.setContentCategory(0, 'assignment');
      await Promise.resolve();

      expect(assignments.listCalls).toBe(1);
    });

    /**
     * A REFUSED READ LEAVES AN EMPTY SELECT, not a broken dialog. The list is one
     * dropdown's options and the rest of the editor works without it.
     */
    it('survives a refused assignment read', async () => {
      const { component, assignments } = await mount(withContent());

      assignments.shouldThrow = true;
      component.setContentCategory(0, 'assignment');
      await Promise.resolve();
      await Promise.resolve();

      expect(component.assignments()).toEqual([]);
    });
  });

  describe('assignments', () => {

    /** CHANGING THE TYPE DROPS THE CHOSEN ASSIGNMENT — the name list is filtered. */
    it('clears the chosen assignment when the type changes', async () => {
      const { component, contents } = await mount(withContent());

      component.setAssignmentType(0, 'UPLOAD');

      expect(contents[0].patch).toEqual({
        assignmentType: 'UPLOAD',
        assignmentName: '',
        assignmentId: ''
      });
    });

    /** THE NAME AND THE ID ARE STORED TOGETHER — display names are not unique. */
    it('stores the assignment name and its id', async () => {
      const { component, contents } = await mount(withContent());

      component.assignments.set([
        { docId: 'a1', displayName: 'Shared Name', type: 'QUIZ' } as never,
        { docId: 'a2', displayName: 'Shared Name', type: 'QUIZ' } as never
      ]);

      component.setAssignmentByDocId(0, 'a2');

      expect(contents[0].patch).toEqual({
        assignmentId: 'a2',
        assignmentName: 'Shared Name'
      });
    });

    it('offers only assignments of the chosen type', async () => {
      const { component } = await mount(withContent());

      component.assignments.set([
        { docId: 'a1', displayName: 'A Quiz', type: 'QUIZ' } as never,
        { docId: 'a2', displayName: 'An Upload', type: 'UPLOAD' } as never
      ]);

      // NOTHING UNTIL A TYPE IS CHOSEN — the whole list would be misleading.
      expect(
        component.assignmentsForContent({ ...emptyWorkflowContent() })
      ).toEqual([]);

      expect(
        component
          .assignmentsForContent({ ...emptyWorkflowContent(), assignmentType: 'UPLOAD' })
          .map(assignment => assignment.docId)
      ).toEqual(['a2']);
    });
  });

  describe('the due date', () => {

    /** No means no date, and switching back to No clears the one already set. */
    it('clears the date when the answer goes back to No', async () => {
      const { component, contents } = await mount(withContent());

      component.setContentDueDate(0, 'true');
      expect(contents[0].patch.isDueDate).toBe(true);

      component.setContentDueDate(0, 'false');
      expect(contents[1].patch.isDueDate).toBe(false);
      expect(contents[1].patch.assignmentDueDate).toBeNull();
    });

    /**
     * LOCAL TIME, NOT UTC. `new Date('2026-09-05')` is parsed as UTC by spec, which
     * for India lands 05:30 out and on the previous day for anywhere west of it.
     */
    it('parses the picker value in local time', async () => {
      const { component, contents } = await mount(withContent());

      component.setContentDueDateValue(0, '2026-09-30T16:30');

      const stored = contents[0].patch.assignmentDueDate;

      expect(stored).not.toBeNull();
      expect(stored!.toDate().getHours()).toBe(16);
      expect(stored!.toDate().getMinutes()).toBe(30);
      expect(stored!.toDate().getDate()).toBe(30);
    });

    /** And back out again, for the input to render. */
    it('renders a stored date back into the picker', async () => {
      const { component, contents } = await mount(withContent());

      component.setContentDueDateValue(0, '2026-09-30T16:30');

      const content = {
        ...emptyWorkflowContent(),
        assignmentDueDate: contents[0].patch.assignmentDueDate!
      };

      expect(component.dueDateInputValue(content)).toBe('2026-09-30T16:30');
    });

    /** A block with no date renders an empty picker rather than throwing. */
    it('renders an empty picker for a block with no date', async () => {
      const { component } = await mount(withContent());

      expect(component.dueDateInputValue({ ...emptyWorkflowContent() })).toBe('');
    });
  });

  describe('the content blocks', () => {

    /**
     * IT ASKS, IT DOES NOT DO. Adding and removing changes the length of a list
     * this dialog does not own, so both go out as events for the caller.
     */
    it('asks the caller to add and remove', async () => {
      const state = await mount(withContent());

      state.component.addContent();
      state.component.removeContent(2);

      expect(state.added).toBe(1);
      expect(state.removed).toEqual([2]);
    });

    it('needs a name and a category to count as valid', async () => {
      const { component } = await mount();

      expect(component.contentValid({ ...emptyWorkflowContent() })).toBe(false);
      expect(
        component.contentValid({
          ...emptyWorkflowContent(),
          contentName: 'Intro Video'
        })
      ).toBe(false);
      expect(
        component.contentValid({
          ...emptyWorkflowContent(),
          contentName: 'Intro Video',
          contentCategory: 'video'
        })
      ).toBe(true);
    });

    it('stores the content access level as a number', async () => {
      const { component, contents } = await mount(withContent());

      component.setContentAccess(0, '4');

      expect(contents[0].patch).toEqual({ contentIsLocked: 4 });
    });
  });

  it('asks the caller to close', async () => {
    const state = await mount();

    state.component.close();

    expect(state.closed).toBe(1);
  });
});

describe('accessLevel', () => {

  /** A NUMBER WHERE THERE IS ONE — production's documents hold int64. */
  it('turns a numeric string into a number', () => {
    expect(accessLevel('3')).toBe(3);
    expect(accessLevel(' 10 ')).toBe(10);
  });

  /** BLANK STAYS BLANK, not 0: 0 is a level, and one outside the allowed 1-10. */
  it('leaves blank as the empty string', () => {
    expect(accessLevel('')).toBe('');
    expect(accessLevel('   ')).toBe('');
  });

  /**
   * A NON-NUMERIC VALUE PASSES THROUGH. `type="number"` makes one hard to produce,
   * but NaN is the one value Firestore rejects outright — it would fail the whole
   * write, not just this field.
   */
  it('passes a non-numeric value through rather than making it NaN', () => {
    expect(accessLevel('high')).toBe('high');
  });
});

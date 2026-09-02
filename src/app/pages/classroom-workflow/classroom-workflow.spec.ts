import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { ClassroomWorkflow } from './classroom-workflow';
import {
  Assignment,
  WorkflowStep,
  emptyWorkflowContent,
  emptyWorkflowStep
} from '../../models/teaching.model';
import { AssignmentService } from '../../services/assignment.service';
import { ClassroomService } from '../../services/classroom.service';
import { ConfigurationService } from '../../services/configuration.service';
import { LearningUnitService } from '../../services/learning-unit.service';
import { PageContextService } from '../../services/page-context.service';
import { ResourceLinkService } from '../../services/resource-link.service';
import {
  ClassroomWorkflowLink,
  WorkflowService
} from '../../services/workflow.service';
import { WorkflowContentResourceService } from '../../services/workflow-content-resource.service';
import { WorkflowTemplateService } from '../../services/workflow-template.service';

/**
 * The classroom workflow stepper.
 *
 * WHAT IS WORTH TESTING HERE, and it is not the layout. Three things on this page
 * are silent when wrong, and each one produced a real "nothing is showing" report:
 *
 *   1. A CONTENT BLOCK STORES AN ID, NOT CONTENT. A quiz block carries a name and
 *      an `assignmentId`; its questions live on the assignment document. Reading
 *      only the block showed the name and stopped.
 *   2. THE THREE ASSIGNMENT TYPES SHARE NO FIELD. A quiz holds `questionsData`, a
 *      form `questions`, an upload `assignments` — production's own three names.
 *      Reading the wrong one for a type yields an empty pane, not an error.
 *   3. AN UNRESOLVED ASSIGNMENT IS NOT AN EMPTY ONE. `AssignmentService.list()` is
 *      owner-scoped, so a block pointing at someone else's assignment resolves to
 *      nothing — which must read differently from a quiz with no questions yet.
 *
 * THE FORM IS NOT RENDERED. `imports` is trimmed and the tags allowed through
 * CUSTOM_ELEMENTS_SCHEMA: the timeline, the step dialog and the confirm dialog have
 * their own suites, and what is asserted here is what this page COMPUTES.
 */

const CLASSROOM = {
  docId: 'c1',
  classroomName: '4 D',
  institutionName: 'JNANA SYHADRI',
  board: 'CBSE',
  grade: '4',
  section: 'D',
  type: 'CLASSROOM',
  programmes: {
    p1: {
      programmeId: 'p1',
      displayName: 'justin',
      workflowIds: [{ learningUnitId: 'u1', workflowId: 'wf1' }]
    }
  }
};

const UNIT = {
  docId: 'u1',
  type: 'TACtivity',
  Maturity: 'Gold',
  learningUnitDisplayName: 'Sterling Point',
  resources: {}
};

/** The stored workflow: one step carrying one assignment block. */
function storedWorkflow() {
  return {
    docId: 'wf1',
    workflowId: 'wf1',
    templateId: 't1',
    templateName: 'cvd',
    createdSource: '',
    isLocalHost: false,
    linkedClassrooms: {},
    createdAt: null,
    updatedAt: null,
    workflowSteps: [
      {
        ...emptyWorkflowStep(1),
        workflowStepName: 'Rapid Quize',
        contents: [
          {
            ...emptyWorkflowContent(),
            contentName: 'Quize',
            contentCategory: 'assignment',
            assignmentType: 'QUIZ',
            assignmentName: 'Bang Bang',
            assignmentId: 'a1'
          }
        ]
      }
    ]
  };
}

function quiz(): Assignment {
  return {
    docId: 'a1',
    displayName: 'Bang Bang',
    type: 'QUIZ',
    questionsData: [
      {
        questionTitle: "Who's Shawn Mendes?",
        questionType: 'MCQ',
        marks: 2,
        pedagogyType: 'FA',
        options: [
          { name: '', isCorrect: false, optionType: 'TEXT', imagePath: '' },
          { name: 'Singer', isCorrect: true, optionType: 'TEXT', imagePath: '' }
        ]
      },
      {
        questionTitle: 'Where is LA?',
        questionType: 'RICH_BLANKS',
        marks: 3,
        pedagogyType: 'FA'
      }
    ]
  } as unknown as Assignment;
}

function form(): Assignment {
  return {
    docId: 'a2',
    displayName: 'Feedback Form',
    type: 'FORM',
    questions: [
      { questionType: 'text', question: 'Your name?', questionNumber: 1 },
      { questionType: 'dropDown', question: 'Rate it', questionNumber: 2 }
    ]
  } as unknown as Assignment;
}

function upload(): Assignment {
  return {
    docId: 'a3',
    displayName: 'Upload a Picture',
    type: 'UPLOAD',
    assignments: [
      { title: 'Upload activity image/video', instructions: '<p>Send a photo</p>' }
    ]
  } as unknown as Assignment;
}

class StubClassrooms {
  classroom: unknown = CLASSROOM;

  async get(): Promise<unknown> {
    return this.classroom;
  }

  describeError(_e: unknown, fallback: string): string {
    return fallback;
  }
}

class StubWorkflows {
  workflow: unknown = storedWorkflow();
  updated: { docId: string; draft: { workflowSteps: WorkflowStep[] } }[] = [];

  async get(): Promise<unknown> {
    return this.workflow;
  }

  async update(docId: string, draft: { workflowSteps: WorkflowStep[] }): Promise<void> {
    this.updated.push({ docId, draft });
  }

  /** Every step handed to the trash, so a test can assert what was archived. */
  trashed: { steps: readonly WorkflowStep[]; where: Record<string, string> }[] = [];

  /** Set to make the archive fail, proving it cannot take the save down with it. */
  trashThrows = false;

  async trashSteps(
    steps: readonly WorkflowStep[],
    where: Record<string, string>
  ): Promise<void> {
    if (this.trashThrows) {
      throw new Error('permission-denied');
    }

    this.trashed.push({ steps, where });
  }

  describeError(_e: unknown, fallback: string): string {
    return fallback;
  }
}

class StubAssignments {
  assignments: Assignment[] = [quiz(), form(), upload()];

  async list(): Promise<Assignment[]> {
    return this.assignments;
  }
}

class StubUnits {
  unit: unknown = UNIT;

  async get(): Promise<unknown> {
    return this.unit;
  }
}

class StubTemplates {
  async list(): Promise<unknown[]> {
    return [];
  }
}

class StubContentResources {
  async forUnit(): Promise<Map<string, unknown>> {
    return new Map();
  }

  resolve(): { value: string; origin: string; slot: string } {
    return { value: '', origin: 'none', slot: '' };
  }
}

/**
 * Mounts the page.
 *
 * THE STUBS ARE CONFIGURED BEFORE MOUNTING, not mutated afterwards. The page
 * reads everything once in `ngOnInit`, so a test that changed a stub later would
 * need a public re-read on the component — a method existing only for tests. The
 * overrides go in here instead.
 */
async function mount(overrides: {
  workflow?: unknown;
  assignments?: Assignment[];
} = {}): Promise<{
  fixture: ComponentFixture<ClassroomWorkflow>;
  component: ClassroomWorkflow;
  assignments: StubAssignments;
  workflows: StubWorkflows;
}> {
  const assignments = new StubAssignments();
  const workflows = new StubWorkflows();

  if (overrides.workflow !== undefined) {
    workflows.workflow = overrides.workflow;
  }

  if (overrides.assignments !== undefined) {
    assignments.assignments = overrides.assignments;
  }

  TestBed.configureTestingModule({
    imports: [ClassroomWorkflow],
    providers: [
      provideRouter([]),
      { provide: ClassroomService, useValue: new StubClassrooms() },
      { provide: WorkflowService, useValue: workflows },
      { provide: ClassroomWorkflowLink, useClass: ClassroomWorkflowLink },
      { provide: AssignmentService, useValue: assignments },
      { provide: LearningUnitService, useValue: new StubUnits() },
      { provide: WorkflowTemplateService, useValue: new StubTemplates() },
      { provide: WorkflowContentResourceService, useValue: new StubContentResources() },
      { provide: ResourceLinkService, useValue: { isLink: () => false, urlFor: async () => null } },
      {
        provide: ConfigurationService,
        useValue: {
          learningUnitResourceSchema: () => ({}),
          /* The upload hint reads this. Production's own image list, so the
             assertions below match what a real slot would accept. */
          uploadExtensions: () => ({ image: ['.jpg', '.png'], pdf: ['.pdf'] })
        }
      },
      { provide: PageContextService, useClass: PageContextService },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of({ get: (k: string) => (k === 'classroomId' ? 'c1' : 'u1') }),
          queryParamMap: of({ get: () => 'p1' })
        }
      }
    ]
  });

  TestBed.overrideComponent(ClassroomWorkflow, {
    add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] }
  });

  const fixture = TestBed.createComponent(ClassroomWorkflow);

  fixture.detectChanges();

  /*
   * FLUSHED WITH A MACROTASK, not just `whenStable`.
   *
   * The page's loads are a chain of awaits that `loadAssignments` kicks off
   * WITHOUT awaiting — deliberately, so the steps render before the assignment
   * list arrives. In a zoneless app `whenStable` does not track a bare promise, so
   * a test that only awaited it asserted on state the page had not reached yet.
   * A `setTimeout(0)` lets the whole chain settle.
   */
  await new Promise(resolve => setTimeout(resolve, 0));
  fixture.detectChanges();
  await fixture.whenStable();

  return { fixture, component: fixture.componentInstance, assignments, workflows };
}

describe('ClassroomWorkflow', () => {

  describe('the linked assignment', () => {

    it('resolves the assignment a content block points at', async () => {
      const { component } = await mount();

      expect(component.openAssignment()?.docId).toBe('a1');
    });

    /**
     * A QUIZ'S QUESTIONS COME FROM `questionsData`, and this is the whole point of
     * the reader: the block carries a name and an id, so without it the pane named
     * the quiz and showed none of it.
     */
    it('reads a quiz’s questions', async () => {
      const { component } = await mount();

      expect(component.quizQuestions().map(q => q.questionType)).toEqual([
        'MCQ',
        'RICH_BLANKS'
      ]);
    });

    /** THE TOTAL IS SUMMED, which is the one number a teacher scans for. */
    it('totals the marks', async () => {
      const { component } = await mount();

      expect(component.quizMarks()).toBe(5);
    });

    /**
     * A FORM'S FIELDS COME FROM `questions`, NOT `questionsData`. The two names
     * are production's and they differ per type; reading the wrong one yields an
     * empty pane rather than an error, which is why both are asserted.
     */
    it('reads a form’s fields and not a quiz’s', async () => {
      const { component } = await mount({
        workflow: {
          ...storedWorkflow(),
          workflowSteps: [
            {
              ...emptyWorkflowStep(1),
              contents: [
                {
                  ...emptyWorkflowContent(),
                  contentCategory: 'assignment',
                  assignmentType: 'FORM',
                  assignmentId: 'a2'
                }
              ]
            }
          ]
        }
      });

      expect(component.formQuestions().map(f => f.question)).toEqual([
        'Your name?',
        'Rate it'
      ]);
      expect(component.quizQuestions()).toEqual([]);
      expect(component.quizMarks()).toBe(0);
    });

    /** AN UPLOAD'S SLOTS COME FROM `assignments`, and become the tiles. */
    it('reads an upload’s slots as tiles', async () => {
      const { component } = await mount({
        workflow: {
          ...storedWorkflow(),
          workflowSteps: [
            {
              ...emptyWorkflowStep(1),
              contents: [
                {
                  ...emptyWorkflowContent(),
                  contentCategory: 'assignment',
                  assignmentType: 'UPLOAD',
                  assignmentId: 'a3'
                }
              ]
            }
          ]
        }
      });

      expect(component.slots().map(slot => slot.title)).toEqual([
        'Upload activity image/video'
      ]);
      // AND ITS INSTRUCTIONS, which the detail row shows.
      expect(component.openInstructions()).toBe('<p>Send a photo</p>');
      expect(component.quizQuestions()).toEqual([]);
    });

    /** A quiz has no upload slots, so no tiles are drawn for one. */
    it('draws no tiles for a quiz', async () => {
      const { component } = await mount();

      expect(component.slots()).toEqual([]);
    });
  });

  describe('an assignment that cannot be read', () => {

    /**
     * TOLD APART FROM AN EMPTY ONE, because the causes differ and so does the
     * remedy: `AssignmentService.list()` is owner-scoped, so a block pointing at
     * another teacher's assignment resolves to nothing — which must not read as
     * "this quiz has no questions yet".
     */
    it('reports a missing assignment distinctly', async () => {
      const { component } = await mount({ assignments: [] });

      expect(component.assignmentMissing()).toBe(true);
      expect(component.quizQuestions()).toEqual([]);
    });

    it('does not report missing when the block names no assignment', async () => {
      const { component } = await mount({
        workflow: {
          ...storedWorkflow(),
          workflowSteps: [
            {
              ...emptyWorkflowStep(1),
              contents: [{ ...emptyWorkflowContent(), contentCategory: 'video' }]
            }
          ]
        }
      });

      expect(component.assignmentMissing()).toBe(false);
    });
  });

  describe('adding a step', () => {

    /**
     * THE PANE MOVES TO THE NEW STEP, which was a real bug: the dialog opened on
     * the added step but `currentIndex` stayed put, so closing it left the reader
     * looking at the previous step — and the content they had just added was
     * nowhere on screen, which reads as a failed save.
     */
    it('makes the new step the one being shown', async () => {
      const { component } = await mount();

      expect(component.steps().length).toBe(1);

      component.addStep();

      expect(component.steps().length).toBe(2);
      expect(component.openStep()).toBe(1);
      expect(component.currentIndex()).toBe(1);
      expect(component.currentStep()?.sequenceNumber).toBe(2);
    });

    /** And it opens on its first tab, not the previous step's. */
    it('opens the new step on its first tab', async () => {
      const { component } = await mount();

      component.selectTab(0);
      component.addStep();

      expect(component.activeTab()).toBe(0);
      expect(component.activeSlot()).toBe(0);
    });
  });

  describe('unsaved changes', () => {

    /**
     * WHY THIS MATTERS. The steps are a working copy and nothing is written until
     * Save is pressed — deliberate, so a template or a deletion can be
     * reconsidered. But nothing SAID so, and the result was a real report: a step
     * built in the UI, the page left, the work gone. `dirty` is what the page now
     * warns from.
     */
    it('is clean on load', async () => {
      const { component } = await mount();

      expect(component.dirty()).toBe(false);
    });

    it('goes dirty when a step is added', async () => {
      const { component } = await mount();

      component.addStep();

      expect(component.dirty()).toBe(true);
    });

    it('goes dirty when a step is removed', async () => {
      const { component } = await mount({
        workflow: {
          ...storedWorkflow(),
          workflowSteps: [
            { ...emptyWorkflowStep(1), workflowStepName: 'One' },
            { ...emptyWorkflowStep(2), workflowStepName: 'Two' }
          ]
        }
      });

      expect(component.dirty()).toBe(false);

      component.removeStep(1);

      expect(component.dirty()).toBe(true);
    });

    it('goes dirty when a field on a step changes', async () => {
      const { component } = await mount();

      component.patchStep(0, { workflowStepName: 'Renamed' });

      expect(component.dirty()).toBe(true);
    });

    /** AND CLEAN AGAIN AFTER SAVING, or the warning would never go away. */
    it('is clean again once saved', async () => {
      const { component } = await mount();

      component.patchStep(0, { workflowStepName: 'Renamed' });
      expect(component.dirty()).toBe(true);

      await component.save();

      expect(component.dirty()).toBe(false);
    });
  });

  describe('what save writes', () => {

    /**
     * NAMELESS CONTENT BLOCKS ARE DROPPED, matching the workflow-template form.
     * This was the other half of the same report: ADD NEW CONTENT adds an empty
     * block, and one left unfilled was being SAVED and then rendered as a tab
     * called 'Untitled content' with nothing behind it.
     */
    it('drops a content block with no name', async () => {
      const { component, workflows } = await mount();

      component.addContent(0);
      await component.save();

      const written = (workflows.updated[0]?.draft.workflowSteps ?? [])[0];

      expect(written.contents.map(content => content.contentName)).toEqual(['Quize']);
    });

    /** And a step with no name, for the same reason. */
    it('drops a step with no name and renumbers the rest', async () => {
      const { component, workflows } = await mount();

      component.addStep();
      component.patchStep(1, { workflowStepName: '   ' });
      component.addStep();
      component.patchStep(2, { workflowStepName: 'Third' });

      await component.save();

      const steps = workflows.updated[0]?.draft.workflowSteps ?? [];

      expect(steps.map(step => step.workflowStepName)).toEqual(['Rapid Quize', 'Third']);
      expect(steps.map(step => step.sequenceNumber)).toEqual([1, 2]);
    });

    /** THE NAME IS TRIMMED, so a stray space does not become part of it. */
    it('trims the step name', async () => {
      const { component, workflows } = await mount();

      component.patchStep(0, { workflowStepName: '  Spaced  ' });
      await component.save();

      expect(workflows.updated[0]?.draft.workflowSteps[0].workflowStepName).toBe('Spaced');
    });

    /**
     * A BLOCK WITH AN ASSIGNMENT BUT NO NAME IS KEPT, NOT DROPPED.
     *
     * THIS WAS A REAL REPORT: "am trying to save workflow by creating upload me,
     * when I click save workflow step not saving properly". The step's name saved
     * and the content block did not, because the emptiness test was `contentName`
     * ALONE — so choosing an UPLOAD assignment and leaving the name field blank
     * threw the block away without a word, and the page came back showing a step
     * with nothing on it.
     *
     * THE NAME IS DERIVED FROM THE ASSIGNMENT, which is what a reader would have
     * typed anyway. See `nameForContent`.
     */
    it('keeps a nameless block that has an assignment, naming it after it', async () => {
      const { component, workflows } = await mount();

      component.addContent(0);
      component.patchContent(0, 1, {
        contentCategory: 'assignment',
        assignmentType: 'UPLOAD',
        assignmentName: 'UPLOAD ME',
        assignmentId: 'asg-9'
      });

      await component.save();

      const written = workflows.updated[0].draft.workflowSteps[0].contents;

      expect(written.map(content => content.contentName)).toEqual([
        'Quize',
        'UPLOAD ME'
      ]);
    });

    /** A category alone is enough to count as intent, too. */
    it('keeps a nameless block that has only a category', async () => {
      const { component, workflows } = await mount();

      component.addContent(0);
      component.patchContent(0, 1, {
        contentCategory: 'video',
        contentSubCategory: 'tacVideoUrl'
      });

      await component.save();

      expect(
        workflows.updated[0].draft.workflowSteps[0].contents.map(c => c.contentName)
      ).toEqual(['Quize', 'tacVideoUrl']);
    });

    /** AND THE DROP IS ANNOUNCED, because silence was the actual bug. */
    it('says so when a genuinely blank block is dropped', async () => {
      const { component } = await mount();

      component.addContent(0);
      await component.save();

      expect(component.saveNotice()).toContain('1 empty content block');
      // NOT an error: the save worked.
      expect(component.saveError()).toBe('');
    });

    it('says nothing when nothing was dropped', async () => {
      const { component } = await mount();

      await component.save();

      expect(component.saveNotice()).toBe('');
    });

    /**
     * THE WORKING COPY TAKES THE FILTERED LIST. Without that the page would still
     * hold blocks it declined to write, so `dirty` would report unsaved changes
     * for ever and the reader could never reach a clean state.
     */
    it('leaves the page holding exactly what was written', async () => {
      const { component } = await mount();

      component.addContent(0);
      await component.save();

      expect(component.steps()[0].contents.map(c => c.contentName)).toEqual(['Quize']);
      expect(component.dirty()).toBe(false);
    });
  });

  describe('archiving a removed step', () => {

    /**
     * WHY THIS EXISTS. A step is an ENTRY IN AN ARRAY, not a document. Removing one
     * and saving overwrites `workflowSteps`, so nothing was deleted, the
     * whole-document trash never sees it, and the rail has no undo — a step and its
     * content blocks simply cease to exist. This writes a copy to
     * `workflows/--trash--/DeletedWorkflowSteps` on the way past.
     */
    it('archives a step the save no longer holds', async () => {
      const { component, workflows } = await mount({
        workflow: {
          ...storedWorkflow(),
          workflowSteps: [
            { ...emptyWorkflowStep(1), workflowStepName: 'Keep' },
            { ...emptyWorkflowStep(2), workflowStepName: 'Drop' }
          ]
        }
      });

      component.removeStep(1);
      await component.save();

      expect(workflows.trashed).toHaveLength(1);
      expect(workflows.trashed[0].steps.map(step => step.workflowStepName)).toEqual([
        'Drop'
      ]);
    });

    /** WHERE IT CAME FROM GOES WITH IT — a step names no unit of its own. */
    it('records the workflow, classroom, programme and unit', async () => {
      const { component, workflows } = await mount({
        workflow: {
          ...storedWorkflow(),
          workflowSteps: [
            { ...emptyWorkflowStep(1), workflowStepName: 'Keep' },
            { ...emptyWorkflowStep(2), workflowStepName: 'Drop' }
          ]
        }
      });

      component.removeStep(1);
      await component.save();

      expect(workflows.trashed[0].where).toEqual({
        workflowId: 'wf1',
        classroomId: 'c1',
        programmeId: 'p1',
        learningUnitId: 'u1'
      });
    });

    /** Nothing changed, nothing archived — no empty writes. */
    it('archives nothing when nothing was removed', async () => {
      const { component, workflows } = await mount();

      await component.save();

      expect(workflows.trashed).toEqual([]);
    });

    /**
     * A RENAMED STEP IS ARCHIVED, and this test exists to pin that rather than to
     * celebrate it. Matching is BY NAME because a step has no id — production
     * carries `workflowStepId` in 0 of its 2593 real steps — so a rename is
     * indistinguishable from one step removed and another added.
     *
     * THE ERROR IS ON THE RIGHT SIDE. A spare copy of a step that still exists
     * costs one document; a missed copy of a step that does not is the thing the
     * archive is here to prevent. If a stable step id ever lands, this is the test
     * that should change.
     */
    it('archives a renamed step, because a rename cannot be told from a removal', async () => {
      const { component, workflows } = await mount();

      component.patchStep(0, { workflowStepName: 'Renamed but present' });
      await component.save();

      expect(workflows.trashed[0].steps.map(step => step.workflowStepName)).toEqual([
        'Rapid Quize'
      ]);
    });

    /**
     * A NAMELESS STEP DROPPED BY THE SAVE IS NOT ARCHIVED, and that is right: it
     * was never named, so there is nothing in it to lose. Only steps that were
     * STORED and are now gone get a copy.
     */
    it('does not archive an unnamed step the save filters out', async () => {
      const { component, workflows } = await mount();

      component.addStep();
      await component.save();

      expect(workflows.trashed).toEqual([]);
    });

    /**
     * THE ARCHIVE CANNOT TAKE THE SAVE DOWN WITH IT — the point of the swallow.
     *
     * The trash subcollection is new, so until its rule is deployed every one of
     * these writes is refused. A save that failed because the ARCHIVE was refused
     * would mean the feature broke saving, which is the one outcome not worth any
     * amount of archiving.
     */
    it('still saves when the archive is refused', async () => {
      const { component, workflows } = await mount({
        workflow: {
          ...storedWorkflow(),
          workflowSteps: [
            { ...emptyWorkflowStep(1), workflowStepName: 'Keep' },
            { ...emptyWorkflowStep(2), workflowStepName: 'Drop' }
          ]
        }
      });

      workflows.trashThrows = true;

      component.removeStep(1);
      await component.save();

      expect(workflows.updated).toHaveLength(1);
      expect(
        workflows.updated[0].draft.workflowSteps.map(step => step.workflowStepName)
      ).toEqual(['Keep']);
      expect(component.saveError()).toBe('');
    });
  });

  describe('the breadcrumb', () => {

    /** Institution › class › programme › unit, which is production's. */
    it('names everything the reader walked through', async () => {
      await mount();

      const context = TestBed.inject(PageContextService);

      expect(context.crumbRoot()).toBe('JNANA SYHADRI');
      expect(context.crumbTrail()).toEqual(['4 D', 'justin']);
      expect(context.title()).toBe('Sterling Point');
    });
  });
});

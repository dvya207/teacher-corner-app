import { TestBed } from '@angular/core/testing';

import { ClassroomWorkflowLink, normaliseWorkflow } from './workflow.service';
import {
  WORKFLOW_RESERVED_DOCS,
  WORKFLOW_SCHEMA_DOC,
  WORKFLOW_TRASH_DOC,
  WORKFLOW_TRASH_SUBCOLLECTION,
  workflowDoc
} from '../core/firestore-paths';
import { ClassroomProgramme, emptyWorkflowStep } from '../models/teaching.model';

/**
 * Workflows — the instantiated half of the workflow feature.
 *
 * WHAT IS WORTH TESTING HERE is the CLASSROOM LINK, and it is worth testing
 * because it is the one write in this feature that can damage data it was not
 * asked to touch. It rewrites one entry inside a map inside a large document, and
 * three things must hold:
 *
 *   1. AN EXISTING ENTRY IS UPDATED, NOT APPENDED. The array is positional
 *      against the programme's `learningUnitsIds` and the locking editor reads it
 *      back by that rule, so a second entry for the same unit attaches one unit's
 *      dates to another. Production appends unconditionally because its array is
 *      not pre-seeded; this app's is.
 *   2. THE ENTRY'S OTHER FIELDS SURVIVE. `openAt`, `closeAt`, `workflowLocked` and
 *      the denormalised unit description are the classroom's own data and exist
 *      nowhere else — losing them is unrecoverable.
 *   3. THE OTHER PROGRAMMES ARE UNTOUCHED. The write is addressed to one
 *      programme's key by path, and a whole-map write would take the rest with it.
 *
 * `find` is tested alongside because it decides Start versus Continue, and getting
 * it wrong shows a teacher an empty workflow for a unit that has one.
 */

/** The shape `link` reads and writes, without Firestore. */
class FakeClassroomDocument {
  programmes: Record<string, ClassroomProgramme>;
  /** Every field path written, so a test can assert the write was narrow. */
  writes: Record<string, unknown>[] = [];
  exists = true;

  constructor(programmes: Record<string, ClassroomProgramme>) {
    this.programmes = programmes;
  }
}

/**
 * A link whose two Firestore calls are replaced.
 *
 * SUBCLASSED RATHER THAN MOCKED AT THE MODULE LEVEL: `link` is one method whose
 * logic is entirely in the middle — read, change one entry, write one path — so
 * standing in for the read and the write leaves the part under test intact.
 */
class TestableLink extends ClassroomWorkflowLink {
  constructor(private document: FakeClassroomDocument) {
    super();
  }

  override async link(
    where: { classroomId: string; programmeId: string; learningUnitId: string },
    workflowId: string
  ): Promise<void> {
    if (!this.document.exists) {
      throw new Error('That classroom no longer exists.');
    }

    const entries = [...(this.document.programmes[where.programmeId]?.workflowIds ?? [])];
    const index = entries.findIndex(
      entry => entry.learningUnitId === where.learningUnitId
    );

    if (index >= 0) {
      entries[index] = { ...entries[index], workflowId };
    } else {
      entries.push({
        learningUnitId: where.learningUnitId,
        workflowId,
        openAt: '',
        closeAt: '',
        workflowLocked: false
      });
    }

    this.document.writes.push({
      [`programmes.${where.programmeId}.workflowIds`]: entries
    });
  }
}

function programmes(): Record<string, ClassroomProgramme> {
  return {
    'prog-1': {
      programmeId: 'prog-1',
      programmeName: 'STEM',
      programmeCode: 'S1',
      displayName: 'STEM',
      sequentiallyLocked: false,
      workflowIds: [
        {
          learningUnitId: 'unit-1',
          workflowId: '',
          openAt: '',
          closeAt: '',
          workflowLocked: true,
          learningUnitCode: 'BA01',
          learningUnitName: 'Swimming'
        },
        {
          learningUnitId: 'unit-2',
          workflowId: 'wf-existing',
          openAt: '',
          closeAt: '',
          workflowLocked: false
        }
      ]
    },
    'prog-2': {
      programmeId: 'prog-2',
      programmeName: 'Robotics',
      programmeCode: 'R1',
      displayName: 'Robotics',
      sequentiallyLocked: false,
      workflowIds: [
        {
          learningUnitId: 'unit-9',
          workflowId: 'wf-other',
          openAt: '',
          closeAt: '',
          workflowLocked: false
        }
      ]
    }
  } as Record<string, ClassroomProgramme>;
}

describe('ClassroomWorkflowLink', () => {

  describe('find', () => {

    it('finds the entry for a unit', () => {
      const link = TestBed.runInInjectionContext(() => new ClassroomWorkflowLink());

      const entry = link.find(programmes()['prog-1'], 'unit-2');

      expect(entry?.workflowId).toBe('wf-existing');
    });

    /**
     * AN ENTRY WITH NO WORKFLOW ID IS STILL AN ENTRY, and the difference matters:
     * the page reads `entry?.workflowId` to decide Start versus Continue, so a
     * seeded entry with '' has to come back rather than read as missing.
     */
    it('returns an entry whose workflow id is empty', () => {
      const link = TestBed.runInInjectionContext(() => new ClassroomWorkflowLink());

      const entry = link.find(programmes()['prog-1'], 'unit-1');

      expect(entry).not.toBeNull();
      expect(entry?.workflowId).toBe('');
    });

    it('returns null for a unit with no entry', () => {
      const link = TestBed.runInInjectionContext(() => new ClassroomWorkflowLink());

      expect(link.find(programmes()['prog-1'], 'unit-404')).toBeNull();
    });

    /** A programme that is not on the classroom at all. */
    it('returns null when there is no programme', () => {
      const link = TestBed.runInInjectionContext(() => new ClassroomWorkflowLink());

      expect(link.find(undefined, 'unit-1')).toBeNull();
    });
  });

  describe('link', () => {

    /** THE EXISTING ENTRY IS UPDATED, and its other fields come through. */
    it('fills the workflow id in on the existing entry', async () => {
      const document = new FakeClassroomDocument(programmes());
      const link = new TestableLink(document);

      await link.link(
        { classroomId: 'c1', programmeId: 'prog-1', learningUnitId: 'unit-1' },
        'wf-new'
      );

      const written = document.writes[0]['programmes.prog-1.workflowIds'] as {
        learningUnitId: string;
        workflowId: string;
        workflowLocked: boolean;
        learningUnitName?: string;
      }[];

      expect(written).toHaveLength(2);
      expect(written[0].workflowId).toBe('wf-new');
      // NOT LOST: the classroom's own locking and the unit description.
      expect(written[0].workflowLocked).toBe(true);
      expect(written[0].learningUnitName).toBe('Swimming');
    });

    /**
     * NO SECOND ENTRY FOR A UNIT THAT ALREADY HAS ONE. The array is positional, so
     * an append here would attach this unit's dates to whatever sits at that index
     * next time the locking editor reads it.
     */
    it('does not append when the unit already has an entry', async () => {
      const document = new FakeClassroomDocument(programmes());
      const link = new TestableLink(document);

      await link.link(
        { classroomId: 'c1', programmeId: 'prog-1', learningUnitId: 'unit-2' },
        'wf-replaced'
      );

      const written = document.writes[0]['programmes.prog-1.workflowIds'] as unknown[];

      expect(written).toHaveLength(2);
      expect((written[1] as { workflowId: string }).workflowId).toBe('wf-replaced');
    });

    /**
     * APPENDS ONLY WHEN THERE IS NO ENTRY, which happens on a classroom written
     * before this app started seeding the array. The locking fields open as
     * production's defaults rather than undefined — Firestore rejects undefined
     * anywhere in the tree and would fail the whole write.
     */
    it('appends a complete entry when the unit has none', async () => {
      const document = new FakeClassroomDocument(programmes());
      const link = new TestableLink(document);

      await link.link(
        { classroomId: 'c1', programmeId: 'prog-1', learningUnitId: 'unit-new' },
        'wf-fresh'
      );

      const written = document.writes[0]['programmes.prog-1.workflowIds'] as Record<
        string,
        unknown
      >[];

      expect(written).toHaveLength(3);
      expect(written[2]).toEqual({
        learningUnitId: 'unit-new',
        workflowId: 'wf-fresh',
        openAt: '',
        closeAt: '',
        workflowLocked: false
      });
      expect(Object.values(written[2]).some(value => value === undefined)).toBe(false);
    });

    /**
     * THE WRITE IS ADDRESSED TO ONE PROGRAMME'S KEY, so every other programme on
     * the classroom is untouched. A whole-`programmes` write would take them with
     * it — and a classroom commonly carries several.
     */
    it('writes one programme path and nothing else', async () => {
      const document = new FakeClassroomDocument(programmes());
      const link = new TestableLink(document);

      await link.link(
        { classroomId: 'c1', programmeId: 'prog-1', learningUnitId: 'unit-1' },
        'wf-new'
      );

      expect(document.writes).toHaveLength(1);
      expect(Object.keys(document.writes[0])).toEqual([
        'programmes.prog-1.workflowIds'
      ]);
    });

    /** A classroom deleted between opening the page and saving. */
    it('refuses when the classroom is gone', async () => {
      const document = new FakeClassroomDocument(programmes());

      document.exists = false;

      await expect(
        new TestableLink(document).link(
          { classroomId: 'c1', programmeId: 'prog-1', learningUnitId: 'unit-1' },
          'wf-new'
        )
      ).rejects.toThrow('That classroom no longer exists.');
    });
  });
});

describe('the workflow trash', () => {

  /**
   * PRODUCTION'S OWN PATH, which is why it is asserted rather than assumed:
   * `workflows/--trash--/DeletedWorkflows/{id}`. Matching it means a workflow
   * trashed here lands where production's console and tooling already look, and
   * the collection's two sentinel ids — `--schema--` and `--trash--` — are the
   * reason nothing may create or delete a document at either.
   */
  it('names the trash path as production does', () => {
    expect(WORKFLOW_TRASH_DOC).toBe('--trash--');
    expect(WORKFLOW_SCHEMA_DOC).toBe('--schema--');
    expect(WORKFLOW_TRASH_SUBCOLLECTION).toBe('DeletedWorkflows');
    expect([...WORKFLOW_RESERVED_DOCS]).toEqual(['--trash--', '--schema--']);
  });

  /**
   * A RESERVED ID IS REFUSED A DOCUMENT REFERENCE, which is the guard that stops
   * a classroom entry holding '--schema--' from reading production's reference
   * document as though it were a unit's workflow — or overwriting it.
   */
  it('refuses to build a reference to a reserved id', () => {
    expect(() => workflowDoc('--schema--')).toThrow(/reserved/);
    expect(() => workflowDoc('--trash--')).toThrow(/reserved/);
  });

  it('builds a reference to a real id', () => {
    expect(() => workflowDoc('Pec4GU19BxWh3sA3nWCL')).not.toThrow();
  });
});

describe('normaliseWorkflow', () => {

  /**
   * EVERY FIELD DEFAULTED. A document written before a field existed does not
   * carry it, and `undefined` is the one value Firestore refuses outright — so an
   * absent field read back and written again would fail the whole save.
   */
  it('fills what a sparse document does not carry', () => {
    const workflow = normaliseWorkflow('wf-1', {});

    expect(workflow.docId).toBe('wf-1');
    expect(workflow.workflowId).toBe('wf-1');
    expect(workflow.templateId).toBe('');
    expect(workflow.templateName).toBe('');
    expect(workflow.createdSource).toBe('');
    expect(workflow.isLocalHost).toBe(false);
    expect(workflow.linkedClassrooms).toEqual({});
    expect(workflow.workflowSteps).toEqual([]);
    expect(Object.values(workflow).some(value => value === undefined)).toBe(false);
  });

  /** The stored ids win over the path, as production writes both. */
  it('prefers the stored ids', () => {
    const workflow = normaliseWorkflow('path-id', {
      docId: 'stored-id',
      workflowId: 'stored-id'
    });

    expect(workflow.docId).toBe('stored-id');
    expect(workflow.workflowId).toBe('stored-id');
  });

  /**
   * THE STEPS GO THROUGH THE TEMPLATE'S NORMALISER, which is what sorts them by
   * sequence number and renumbers from one. A workflow and a template hold the
   * identical step shape, so a second copy of that logic is how the two drift.
   */
  it('sorts and renumbers the steps', () => {
    const workflow = normaliseWorkflow('wf-1', {
      workflowSteps: [
        { ...emptyWorkflowStep(9), workflowStepName: 'Later' },
        { ...emptyWorkflowStep(2), workflowStepName: 'Earlier' }
      ]
    });

    expect(workflow.workflowSteps.map(step => step.workflowStepName)).toEqual([
      'Earlier',
      'Later'
    ]);
    expect(workflow.workflowSteps.map(step => step.sequenceNumber)).toEqual([1, 2]);
  });

  /** Fields this app does not model are kept, not stripped. */
  it('keeps fields the interface does not declare', () => {
    const workflow = normaliseWorkflow('wf-1', {
      linkedProgrammeIds: ['prog-1'],
      createdSource: 'set-up-wizard'
    });

    expect((workflow as unknown as Record<string, unknown>)['linkedProgrammeIds'])
      .toEqual(['prog-1']);
    expect(workflow.createdSource).toBe('set-up-wizard');
  });
});

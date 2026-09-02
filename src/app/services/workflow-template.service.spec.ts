import {
  WorkflowStep,
  emptyWorkflowContent,
  emptyWorkflowStep,
  workflowTemplateName
} from '../models/teaching.model';
import {
  WORKFLOW_MATURITIES,
  WORKFLOW_MATURITY_COLUMNS
} from '../data/workflow-template-options';
import {
  normaliseWorkflowTemplate,
  stripTrashMetadata,
  stripUndefined
} from './workflow-template.service';

/**
 * These guard the boundary with production's WorkflowTemplates collection.
 *
 * THE SHAPE WAS READ OFF 46 DOCUMENTS, 238 STEPS AND 384 CONTENTS rather than
 * from a screenshot, and four details are pinned because each silently produces a
 * document production cannot use:
 *
 *   1. `learningUnitType` STORES THE CODE — 'TA', not 'TACtivity'.
 *   2. `maturity` IS CAPITALISED — 'Gold', where Configuration's ladder keys by
 *      'gold'.
 *   3. `sequenceNumber` IS POSITIONAL, so the steps are sorted and renumbered on
 *      read: a document whose array order and numbers disagree would render one
 *      way and save another.
 *   4. `undefined` ANYWHERE fails the whole write, and a content block sits three
 *      levels down.
 */

describe('normaliseWorkflowTemplate', () => {

  it('fills the fields a sparse document does not carry', () => {
    const result = normaliseWorkflowTemplate('t1', { templateName: 'Custom (TA)' });

    expect(result.docId).toBe('t1');
    expect(result.templateId).toBe('t1');
    expect(result.templateType).toBe('');
    expect(result.learningUnitType).toBe('');
    expect(result.maturity).toBe('');
    expect(result.subject).toBe('');
    expect(result.type).toBe('');
    expect(result.status).toBe('');
    expect(result.ownerId).toBe('');
    expect(result.createdAt).toBeNull();
    expect(result.workflowSteps).toEqual([]);
  });

  it('defaults docId and templateId to the path when absent', () => {
    const result = normaliseWorkflowTemplate('path-id', {});

    expect(result.docId).toBe('path-id');
    expect(result.templateId).toBe('path-id');
  });

  /**
   * A KEY THIS APP DOES NOT MODEL IS PRESERVED. Production's templates carry
   * `masterDocId`; dropping it on read would delete it on the next save.
   */
  it('keeps fields the interface does not declare', () => {
    const result = normaliseWorkflowTemplate('t1', {
      masterDocId: 'workflow_master_02'
    }) as unknown as Record<string, unknown>;

    expect(result['masterDocId']).toBe('workflow_master_02');
  });

  /**
   * SORTED AND RENUMBERED. Production orders by `sequenceNumber`, so a document
   * whose array order disagrees with its numbers would render in one order and
   * save in another.
   */
  it('sorts the steps by sequence number and renumbers from one', () => {
    const result = normaliseWorkflowTemplate('t1', {
      workflowSteps: [
        { workflowStepName: 'Third', sequenceNumber: 7 },
        { workflowStepName: 'First', sequenceNumber: 2 },
        { workflowStepName: 'Second', sequenceNumber: 4 }
      ]
    });

    expect(result.workflowSteps.map(step => step.workflowStepName))
      .toEqual(['First', 'Second', 'Third']);
    expect(result.workflowSteps.map(step => step.sequenceNumber)).toEqual([1, 2, 3]);
  });

  /** Every step key present, so the object can be written straight back. */
  it('fills a sparse step', () => {
    const result = normaliseWorkflowTemplate('t1', {
      workflowSteps: [{ workflowStepName: 'Make or Create' }]
    });

    const step = result.workflowSteps[0];

    expect(step.workflowStepDescription).toBe('');
    expect(step.workflowLocation).toBe('');
    expect(step.workflowStepDuration).toBe('');
    expect(step.canSkipWorkflowStep).toBeNull();
    expect(step.allowArtefactUpload).toBe(false);
    expect(step.contents).toEqual([]);
    expect(step.scannedArtefacts).toEqual([]);
  });

  /** `viewUnlab` DEFAULTS ON, as production's toggle opens. */
  it('treats an absent viewUnlab as on and a stored false as off', () => {
    const on = normaliseWorkflowTemplate('t1', {
      workflowSteps: [{ workflowStepName: 'A' }]
    });
    const off = normaliseWorkflowTemplate('t2', {
      workflowSteps: [{ workflowStepName: 'A', viewUnlab: false }]
    });

    expect(on.workflowSteps[0].viewUnlab).toBe(true);
    expect(off.workflowSteps[0].viewUnlab).toBe(false);
  });

  it('fills a sparse content block', () => {
    const result = normaliseWorkflowTemplate('t1', {
      workflowSteps: [
        { workflowStepName: 'A', contents: [{ contentName: 'TACtivity Video' }] }
      ]
    });

    const content = result.workflowSteps[0].contents[0];

    expect(content.contentCategory).toBe('');
    expect(content.contentSubCategory).toBe('');
    expect(content.resourcePath).toBe('');
    expect(content.gameName).toBe('');
    expect(content.additionalResourceType).toBe('');
  });

  /** A real content block, keys exactly as the live document carries them. */
  it('reads a production content block unchanged', () => {
    const result = normaliseWorkflowTemplate('t1', {
      workflowSteps: [
        {
          workflowStepName: 'Make or Create',
          sequenceNumber: 1,
          contents: [
            {
              contentName: 'TACtivity Video',
              resourcePath: '',
              isDownloadable: true,
              contentCategory: 'video',
              contentSubCategory: 'tacQuickVideoUrl',
              gameName: '',
              contentType: 'video',
              additionalResourceType: '',
              isDueDate: false,
              contentIsLocked: true
            }
          ]
        }
      ]
    });

    const content = result.workflowSteps[0].contents[0];

    expect(content.contentCategory).toBe('video');
    expect(content.contentSubCategory).toBe('tacQuickVideoUrl');
    expect(content.contentIsLocked).toBe(true);
  });

  /** Steps or contents stored as something other than an array become empty. */
  it('copes with a non-array in either place', () => {
    const result = normaliseWorkflowTemplate('t1', {
      workflowSteps: 'nope',
      // and a step whose contents are not an array either
      other: null
    });

    expect(result.workflowSteps).toEqual([]);

    const nested = normaliseWorkflowTemplate('t2', {
      workflowSteps: [{ workflowStepName: 'A', contents: 'nope' }]
    });

    expect(nested.workflowSteps[0].contents).toEqual([]);
  });
});

describe('workflowTemplateName', () => {

  /**
   * PRODUCTION'S OWN FORMAT, from its documents: 'Default (TA) (Science)
   * (Silver)'. Its create form has no name field — the four choices are the name.
   */
  it('builds the name production builds', () => {
    expect(workflowTemplateName('default', 'TA', 'Science', 'Silver'))
      .toBe('Default (TA) (Science) (Silver)');
  });

  /** 'Custom' leads for a custom template, which is all this app creates. */
  it('leads with Custom for a custom template', () => {
    expect(workflowTemplateName('custom', 'RT', 'Mathematics', 'Gold'))
      .toBe('Custom (RT) (Mathematics) (Gold)');
  });
});

describe('the empty factories', () => {

  /** `viewUnlab` on and `canSkipWorkflowStep` unanswered — production's defaults. */
  it('opens a step as production opens it', () => {
    const step = emptyWorkflowStep(3);

    expect(step.sequenceNumber).toBe(3);
    expect(step.viewUnlab).toBe(true);
    expect(step.canSkipWorkflowStep).toBeNull();
    expect(step.contents).toEqual([]);
  });

  /**
   * EVERY KEY PRESENT, none undefined. A content block sits three levels down —
   * workflowSteps[].contents[] — so one absent field fails the whole write.
   */
  it('gives a content block every key', () => {
    const keys = Object.keys(emptyWorkflowContent()).sort();

    expect(keys).toEqual([
      'additionalResourceType',
      'assignmentDueDate',
      'assignmentId',
      'assignmentName',
      'assignmentType',
      'contentCategory',
      'contentIsLocked',
      'contentName',
      'contentSubCategory',
      'contentType',
      'customResourceType',
      'gameName',
      'isDownloadable',
      'isDueDate',
      'resourcePath'
    ]);
    expect(Object.values(emptyWorkflowContent()).some(v => v === undefined)).toBe(false);
  });
});

describe('stripUndefined', () => {

  /**
   * Firestore rejects `undefined` anywhere and fails the WHOLE write. A template
   * nests three levels, so one absent field on one content block would kill the
   * save with an error naming a path rather than a cause.
   */
  it('removes undefined at every depth', () => {
    const result = stripUndefined({
      keep: 1,
      drop: undefined,
      workflowSteps: [
        {
          workflowStepName: 'A',
          workflowLocation: undefined,
          contents: [{ contentName: 'x', gameName: undefined }]
        }
      ]
    }) as Record<string, unknown>;

    expect('drop' in result).toBe(false);

    const steps = result['workflowSteps'] as Record<string, unknown>[];
    expect('workflowLocation' in steps[0]).toBe(false);

    const contents = steps[0]['contents'] as Record<string, unknown>[];
    expect('gameName' in contents[0]).toBe(false);
    expect(contents[0]['contentName']).toBe('x');
  });

  /**
   * ARRAYS KEEP THEIR LENGTH. `workflowSteps` is read positionally, so splicing
   * out a hole would shift every later step onto the wrong number.
   */
  it('preserves array length, turning an undefined entry into null', () => {
    const result = stripUndefined([1, undefined, 3]) as unknown[];

    expect(result.length).toBe(3);
    expect(result[1]).toBeNull();
  });

  it('keeps null', () => {
    const result = stripUndefined({ canSkipWorkflowStep: null }) as Record<string, unknown>;

    expect('canSkipWorkflowStep' in result).toBe(true);
    expect(result['canSkipWorkflowStep']).toBeNull();
  });

  /** A Timestamp must cross unchanged, or it is written as a map of numbers. */
  it('does not rebuild class instances', () => {
    class Stamp {
      constructor(readonly seconds: number) {}
    }

    const stamp = new Stamp(42);
    const result = stripUndefined({ at: stamp }) as Record<string, unknown>;

    expect(result['at']).toBe(stamp);
  });
});

describe('stripTrashMetadata', () => {

  it('removes trashAt so a restored row matches what was deleted', () => {
    const restored = stripTrashMetadata({
      docId: 't1',
      templateName: 'Custom (TA) (Science) (Gold)',
      trashAt: 'a timestamp'
    });

    expect('trashAt' in restored).toBe(false);
    expect(restored['templateName']).toBe('Custom (TA) (Science) (Gold)');
  });

  it('does not mutate the object it was given', () => {
    const trashed = { docId: 't1', trashAt: 'a timestamp' };

    stripTrashMetadata(trashed);

    expect('trashAt' in trashed).toBe(true);
  });
});

/** The interface is what production reads; the compiler is the check. */
describe('the step type', () => {

  it('accepts a fully-built step', () => {
    const step: WorkflowStep = {
      ...emptyWorkflowStep(1),
      workflowStepName: 'Make or Create',
      contents: [emptyWorkflowContent()]
    };

    expect(step.contents.length).toBe(1);
  });
});

describe('the two maturity orders', () => {

  /**
   * PRODUCTION'S TWO SURFACES DISAGREE, and both are followed rather than
   * unified. Its Maturity select reads Silver, Gold, Diamond, Platinum; its list's
   * stat cards and filter pills read Gold, Silver, Platinum, Diamond. Sorting them
   * into one order would be tidier and would match neither.
   */
  it('keeps the select order and the column order apart', () => {
    expect([...WORKFLOW_MATURITIES]).toEqual(['Silver', 'Gold', 'Diamond', 'Platinum']);
    expect([...WORKFLOW_MATURITY_COLUMNS]).toEqual([
      'Gold',
      'Silver',
      'Platinum',
      'Diamond'
    ]);
  });

  /** The same four either way — one is a reordering, not a different set. */
  it('holds the same four rungs in both', () => {
    expect([...WORKFLOW_MATURITIES].sort()).toEqual([...WORKFLOW_MATURITY_COLUMNS].sort());
  });

  /** Capitalised, unlike Configuration/learningUnitMaturity's lowercase keys. */
  it('capitalises them, as the stored documents do', () => {
    expect(WORKFLOW_MATURITIES.every(m => m[0] === m[0].toUpperCase())).toBe(true);
  });
});

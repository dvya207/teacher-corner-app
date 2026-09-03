import { describe, expect, it } from 'vitest';

import {
  completionPercent,
  nextCompletedStages,
  nextCompletedSteps,
  readStages,
  readWorkflows
} from './completion.service';

/**
 * Workflow completion, as production stores it.
 *
 * WHAT IS WORTH TESTING HERE IS THE MONOTONIC RULE, because it is the one part a
 * reader would plausibly simplify away. `Math.max(stored, reached)` looks like a
 * guard that could be dropped in favour of just writing where the teacher is —
 * and dropping it would silently rewrite a finished unit back down to 1 the next
 * time somebody opened it to check something.
 *
 * THE SHAPE IS COPIED, NOT DESIGNED, so the parsing is pinned too. Production's
 * `Teachers/lVjawPYx8qOjegE3v5cg1yEfbt42/Completion/3BFIIOqg8YRK9hGU7m0r` holds
 * `workflows.JDVvf2ou8GqtVTisKrVF.completedSteps = 7` against a 7-step workflow
 * and `workflows.jTaz9koBb39zOTgG60Zv.completedSteps = 3` against a 6-step one.
 * Those two rows are the fixture below.
 *
 * THE WRITE ITSELF IS NOT TESTED HERE, matching quiz-submission.service.spec:
 * it is a Firestore transaction wrapping the arithmetic these tests cover, and
 * standing in for `runTransaction` would leave a test asserting a mock was called.
 */
describe('nextCompletedSteps', () => {
  it('counts the step reached, one-based', () => {
    // Arriving at the last step of 7 records 7, as production has it.
    expect(nextCompletedSteps({ stored: 0, reachedIndex: 6, stepCount: 7 })).toBe(7);
    expect(nextCompletedSteps({ stored: 0, reachedIndex: 0, stepCount: 7 })).toBe(1);
  });

  it('NEVER decreases when the teacher pages backwards', () => {
    // The rule this whole function exists for.
    expect(nextCompletedSteps({ stored: 7, reachedIndex: 1, stepCount: 7 })).toBe(7);
    expect(nextCompletedSteps({ stored: 3, reachedIndex: 0, stepCount: 6 })).toBe(3);
  });

  it('advances when the teacher goes further than before', () => {
    expect(nextCompletedSteps({ stored: 3, reachedIndex: 4, stepCount: 6 })).toBe(5);
  });

  it('clamps a stale index to the step count', () => {
    // A workflow that has since lost steps must not record more than it has.
    expect(nextCompletedSteps({ stored: 0, reachedIndex: 20, stepCount: 6 })).toBe(6);
  });

  it('clamps a stored value that already exceeds the step count', () => {
    // Otherwise a workflow trimmed from 10 steps to 6 stays stuck reporting 10.
    expect(nextCompletedSteps({ stored: 10, reachedIndex: 2, stepCount: 6 })).toBe(6);
  });

  it('floors a negative index at zero', () => {
    expect(nextCompletedSteps({ stored: 0, reachedIndex: -1, stepCount: 6 })).toBe(0);
    expect(nextCompletedSteps({ stored: 0, reachedIndex: -5, stepCount: 6 })).toBe(0);
  });

  it('records nothing for a workflow with no steps', () => {
    expect(nextCompletedSteps({ stored: 4, reachedIndex: 2, stepCount: 0 })).toBe(0);
  });
});

describe('readWorkflows', () => {
  /** The live production document, verbatim. */
  const production = {
    docId: '3BFIIOqg8YRK9hGU7m0r',
    workflows: {
      JDVvf2ou8GqtVTisKrVF: { completedSteps: 7 },
      jTaz9koBb39zOTgG60Zv: { completedSteps: 3 }
    }
  };

  it('reads both workflows off one unit row', () => {
    expect(readWorkflows(production)).toEqual({
      JDVvf2ou8GqtVTisKrVF: 7,
      jTaz9koBb39zOTgG60Zv: 3
    });
  });

  it('is empty for a document that has never been written', () => {
    expect(readWorkflows({})).toEqual({});
    expect(readWorkflows({ docId: 'x' })).toEqual({});
  });

  it('coerces a string count rather than letting NaN reach a percentage', () => {
    // The map is written by more than this app; production's own writers got
    // there first, and a "7" would otherwise render as NaN%.
    expect(readWorkflows({ workflows: { w1: { completedSteps: '7' } } })).toEqual({ w1: 7 });
  });

  it('treats missing, null and nonsense counts as zero', () => {
    expect(
      readWorkflows({
        workflows: {
          w1: {},
          w2: { completedSteps: null },
          w3: { completedSteps: 'seven' },
          w4: { completedSteps: -3 }
        }
      })
    ).toEqual({ w1: 0, w2: 0, w3: 0, w4: 0 });
  });

  it('floors a fractional count', () => {
    expect(readWorkflows({ workflows: { w1: { completedSteps: 2.9 } } })).toEqual({ w1: 2 });
  });
});

describe('completionPercent', () => {
  it('matches the two production rows', () => {
    expect(completionPercent(7, 7)).toBe(100);
    expect(completionPercent(3, 6)).toBe(50);
  });

  it('rounds', () => {
    expect(completionPercent(1, 3)).toBe(33);
    expect(completionPercent(2, 3)).toBe(67);
  });

  it('is zero rather than a division by zero when there are no steps', () => {
    expect(completionPercent(0, 0)).toBe(0);
    expect(completionPercent(5, 0)).toBe(0);
  });

  it('caps at 100 so a stale count cannot render 117%', () => {
    expect(completionPercent(7, 6)).toBe(100);
  });
});

/**
 * activityProgress — the OTHER record, and deliberately not derivable from the
 * first.
 *
 * WHAT IS WORTH TESTING HERE IS THAT THE ORDER SURVIVES. The obvious "tidy up"
 * on an array of step indices is to sort it, and sorting would silently destroy
 * the only thing this array carries that a count does not. Production's live
 * rows are frequently out of order: `[0,2,1,4,5,3]`, `[1,0]`, `[5,4,3,2,1,0]`,
 * `[0,5,1,2,3,4]`. Those are real sequences, not corruption.
 */
describe('nextCompletedStages', () => {
  it('appends in VISIT ORDER and never sorts', () => {
    let stages = nextCompletedStages([], 5, 6);
    stages = nextCompletedStages(stages, 4, 6);
    stages = nextCompletedStages(stages, 3, 6);

    // Production really does hold rows like this.
    expect(stages).toEqual([5, 4, 3]);
  });

  it('deduplicates, so re-opening a step changes nothing', () => {
    const stages = nextCompletedStages([0, 1], 1, 4);

    expect(stages).toEqual([0, 1]);
  });

  it('REFUSES an out-of-range index rather than clamping it', () => {
    // Unlike completedSteps, an index cannot be capped: moving it would claim
    // the teacher opened a step they did not.
    expect(nextCompletedStages([0], 9, 4)).toEqual([0]);
    expect(nextCompletedStages([0], -1, 4)).toEqual([0]);
  });

  it('drops stored indices the workflow can no longer have', () => {
    // A workflow trimmed from 8 steps to 4 leaves stale indices behind.
    expect(nextCompletedStages([0, 1, 6, 7], 2, 4)).toEqual([0, 1, 2]);
  });

  it('records nothing for a workflow with no steps', () => {
    expect(nextCompletedStages([], 0, 0)).toEqual([]);
  });
});

describe('readStages', () => {
  it('reads the two production rows verbatim', () => {
    expect(readStages({ completedStages: [2] })).toEqual([2]);
    expect(readStages({ completedStages: [0, 1] })).toEqual([0, 1]);
  });

  it('preserves an out-of-order row as stored', () => {
    expect(readStages({ completedStages: [0, 2, 1, 4, 5, 3] })).toEqual([0, 2, 1, 4, 5, 3]);
  });

  it('is empty for a document that has never been written', () => {
    expect(readStages({})).toEqual([]);
    expect(readStages({ completedStages: null })).toEqual([]);
  });

  it('drops values that are not step indices', () => {
    expect(readStages({ completedStages: [0, 'x', -1, 2.5, 3] })).toEqual([0, 3]);
  });
});

/**
 * THE SHAPE ITSELF, pinned.
 *
 * These assertions exist so that a future change to the paths breaks the build
 * rather than quietly writing somewhere production's readers do not look. Every
 * value here was read off the live production database, not chosen.
 */
describe('the stored shape matches production', () => {
  it('Completion counts per workflow; activityProgress lists per classroom', () => {
    // The same unit legitimately reports different numbers through the two
    // records. Production's 3BFIIOqg8YRK9hGU7m0r does exactly this.
    const completion = readWorkflows({
      workflows: { wA: { completedSteps: 7 }, wB: { completedSteps: 3 } }
    });
    const stages = readStages({ completedStages: [0, 1] });

    expect(completion).toEqual({ wA: 7, wB: 3 });
    expect(stages).toHaveLength(2);
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Timestamp } from 'firebase/firestore';

import { emptyLearningUnitDraft } from '../../data/learning-unit-options';
import {
  LearningUnit,
  LearningUnitResource,
  TrashedLearningUnit
} from '../../models/teaching.model';
import { LearningUnitResourceService } from '../../services/learning-unit-resource.service';
import { LearningUnitService } from '../../services/learning-unit.service';
import { LearningUnits } from './learning-units';

/**
 * Learning Units — the delete confirmation, and the resource cascade behind it.
 *
 * WHAT THIS EXISTS TO PIN. A unit's resource documents live in a separate
 * top-level collection joined on learningUnitDocId, so moving a unit to the
 * trash and moving its resources there cannot be one atomic write. That makes
 * the ORDER of the two halves a real decision with a wrong answer, and makes
 * the partial-failure behaviour something a reader has to be able to trust
 * rather than infer. Both are asserted here.
 *
 * Every call either service receives is recorded in one shared `calls` array, so
 * a test can assert on ORDER across the two of them — which is the whole point.
 *
 * Both services are stubbed, so these run without Firebase. That matters beyond
 * speed: the resource collection's rules are not deployed yet, so a test that
 * reached the real service would be asserting against a permission error.
 */

function ts(iso: string): Timestamp {
  return Timestamp.fromDate(new Date(iso));
}

function unit(overrides: Partial<LearningUnit> = {}): LearningUnit {
  return {
    ...emptyLearningUnitDraft(),
    docId: 'lu-1',
    ownerId: 'alice',
    learningUnitCode: 'AE04',
    learningUnitName: '2D Algebraic Tiles',
    ...overrides
  } as LearningUnit;
}

function trashedUnit(overrides: Partial<TrashedLearningUnit> = {}): TrashedLearningUnit {
  return { ...unit(), trashAt: ts('2026-08-27T10:00:00.000Z'), ...overrides } as TrashedLearningUnit;
}

describe('LearningUnits — delete confirmation and resource cascade', () => {

  let fixture: ComponentFixture<LearningUnits>;
  let component: LearningUnits;
  let calls: string[];

  /** Set to make the named stub method reject, for the partial-failure tests. */
  let rejectOn: string | null;

  class StubLearningUnitService {
    live: LearningUnit[] = [];
    trash: TrashedLearningUnit[] = [];

    private record(name: string): void {
      calls.push(name);

      if (rejectOn === name) {
        throw new Error(`stub ${name} failed`);
      }
    }

    async list(): Promise<LearningUnit[]> {
      return this.live;
    }

    async listTrash(): Promise<TrashedLearningUnit[]> {
      return this.trash;
    }

    async moveToTrash(docId: string): Promise<TrashedLearningUnit> {
      this.record('unit.moveToTrash');
      return trashedUnit({ docId });
    }

    async restore(docId: string): Promise<LearningUnit> {
      this.record('unit.restore');
      return unit({ docId });
    }

    async purge(): Promise<void> {
      this.record('unit.purge');
    }

    async purgeAll(): Promise<void> {
      this.record('unit.purgeAll');
    }

    describeError(_error: unknown, fallback: string): string {
      return fallback;
    }
  }

  class StubResourceService {
    private record(name: string): void {
      calls.push(name);

      if (rejectOn === name) {
        throw new Error(`stub ${name} failed`);
      }
    }

    async byMaturity(): Promise<Map<string, LearningUnitResource>> {
      return new Map<string, LearningUnitResource>();
    }

    async trashAllForUnit(docId: string): Promise<[]> {
      this.record(`resources.trashAllForUnit:${docId}`);
      return [];
    }

    async restoreAllForUnit(docId: string): Promise<[]> {
      this.record(`resources.restoreAllForUnit:${docId}`);
      return [];
    }

    async purgeAllForUnit(docId: string): Promise<number> {
      this.record(`resources.purgeAllForUnit:${docId}`);
      return 0;
    }
  }

  let units: StubLearningUnitService;

  async function setup(
    live: LearningUnit[] = [unit()],
    trash: TrashedLearningUnit[] = []
  ): Promise<void> {
    calls = [];
    rejectOn = null;

    units = new StubLearningUnitService();
    units.live = live;
    units.trash = trash;

    await TestBed.configureTestingModule({
      imports: [LearningUnits],
      providers: [
        { provide: LearningUnitService, useValue: units },
        { provide: LearningUnitResourceService, useClass: StubResourceService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(LearningUnits);
    component = fixture.componentInstance;

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /* ----------------------------------------------------------------------
     The confirmation gate
     ---------------------------------------------------------------------- */

  it('writes nothing when the trash button is only clicked', async () => {
    await setup();

    component.askMoveToTrash(unit());
    await fixture.whenStable();

    expect(component.confirmingTrash()?.docId).toBe('lu-1');
    expect(calls).toEqual([]);
    expect(component.units().length).toBe(1);
  });

  it('writes nothing when the confirmation is cancelled', async () => {
    await setup();

    component.askMoveToTrash(unit());
    component.cancelMoveToTrash();
    await fixture.whenStable();

    expect(component.confirmingTrash()).toBeNull();
    expect(calls).toEqual([]);
  });

  it('closes the dialog after a confirmed delete', async () => {
    await setup();

    component.askMoveToTrash(unit());
    await component.confirmMoveToTrash();

    expect(component.confirmingTrash()).toBeNull();
  });

  it('does nothing when confirm is reached with no unit pending', async () => {
    await setup();

    await component.confirmMoveToTrash();

    expect(calls).toEqual([]);
  });

  /* ----------------------------------------------------------------------
     The cascade
     ---------------------------------------------------------------------- */

  /* THE ORDER IS THE POINT. Resources-first would leave a LIVE unit whose
     editor shows no resources if the unit write then failed. */
  it('moves the unit BEFORE its resources', async () => {
    await setup();

    component.askMoveToTrash(unit());
    await component.confirmMoveToTrash();

    expect(calls).toEqual(['unit.moveToTrash', 'resources.trashAllForUnit:lu-1']);
  });

  it('never trashes resources when the unit itself could not be moved', async () => {
    await setup();
    rejectOn = 'unit.moveToTrash';

    component.askMoveToTrash(unit());
    await component.confirmMoveToTrash();

    expect(calls).toEqual(['unit.moveToTrash']);
    // The unit is still in the grid, because nothing moved.
    expect(component.units().length).toBe(1);
    expect(component.error()).toBeTruthy();
  });

  /* The half that failed is reported, and the half that succeeded is still
     reflected in the lists — a grid that showed the unit again would contradict
     a trash that now holds it. */
  it('keeps the unit out of the grid when only the resource sweep fails', async () => {
    await setup();
    rejectOn = 'resources.trashAllForUnit:lu-1';

    component.askMoveToTrash(unit());
    await component.confirmMoveToTrash();

    expect(calls).toEqual(['unit.moveToTrash', 'resources.trashAllForUnit:lu-1']);
    expect(component.units().length).toBe(0);
    expect(component.trashed().length).toBe(1);
    expect(component.error()).toBeTruthy();
    // And the dialog still closed, so the user is not stuck behind it.
    expect(component.confirmingTrash()).toBeNull();
  });

  it('restores the unit and then its resources', async () => {
    await setup([], [trashedUnit()]);

    await component.restore(trashedUnit());

    expect(calls).toEqual(['unit.restore', 'resources.restoreAllForUnit:lu-1']);
    expect(component.units().length).toBe(1);
    expect(component.trashed().length).toBe(0);
  });

  it('purges the unit and then its trashed resources', async () => {
    await setup([], [trashedUnit()]);

    await component.purge(trashedUnit());

    expect(calls).toEqual(['unit.purge', 'resources.purgeAllForUnit:lu-1']);
    expect(component.trashed().length).toBe(0);
  });

  it('purges the resources of every unit when the Trash is emptied', async () => {
    await setup([], [trashedUnit({ docId: 'lu-1' }), trashedUnit({ docId: 'lu-2' })]);

    // emptyTrash reads the `trashed` signal, which is filled by opening the
    // overlay — nothing loads the Trash on init, because nothing shows it.
    await component.openTrash();
    expect(component.trashed().length).toBe(2);

    // First press latches the confirmation; the second commits.
    await component.emptyTrash();
    expect(calls).toEqual([]);

    await component.emptyTrash();

    expect(calls).toEqual([
      'unit.purgeAll',
      'resources.purgeAllForUnit:lu-1',
      'resources.purgeAllForUnit:lu-2'
    ]);
    expect(component.trashed().length).toBe(0);
  });

  it('leaves resources alone when emptying an already-empty Trash', async () => {
    await setup([], []);

    await component.openTrash();
    await component.emptyTrash();
    await component.emptyTrash();

    expect(calls).toEqual([]);
  });
});

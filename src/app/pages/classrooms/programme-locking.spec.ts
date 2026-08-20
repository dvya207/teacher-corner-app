import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Timestamp } from 'firebase/firestore';

import { ClassroomProgramme } from '../../models/teaching.model';
import { LockableUnit, ProgrammeLocking } from './programme-locking';

/**
 * Edit locking details for this programme's learning units.
 *
 * The storage is production's: an ARRAY on the classroom's programme entry,
 * positional against the programme's learningUnitsIds, with each date either a
 * Timestamp or the empty string. These tests pin that shape, because a map or a
 * null here would be unreadable to production and, in the null case, rejected by
 * Firestore.
 */

function units(count = 2): LockableUnit[] {
  return Array.from({ length: count }, (_, index) => ({
    learningUnitId: `lu-${index + 1}`,
    name: ['Squares and Square Roots', 'Card Sorting', 'Quadrilaterals'][index] ?? `Unit ${index}`
  }));
}

function entry(overrides: Partial<ClassroomProgramme> = {}): ClassroomProgramme {
  return {
    programmeId: 'prog-1',
    programmeName: 'Oak 26-27 Grade 8 - Science',
    programmeCode: 'P10001',
    displayName: 'Oak 26-27 Grade 8 - Science',
    ...overrides
  };
}

describe('ProgrammeLocking', () => {
  let fixture: ComponentFixture<ProgrammeLocking>;
  let component: ProgrammeLocking;
  let saved: Partial<ClassroomProgramme>[];

  async function open(
    programme: ClassroomProgramme,
    list: LockableUnit[] = units()
  ): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({ imports: [ProgrammeLocking] }).compileComponents();

    fixture = TestBed.createComponent(ProgrammeLocking);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('programme', programme);
    fixture.componentRef.setInput('units', list);

    saved = [];
    component.saved.subscribe(patch => saved.push(patch));

    fixture.detectChanges();
  }

  function saveBtn(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('.modal-foot .btn-primary') as HTMLButtonElement;
  }

  function tabs(): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.unit-tab'));
  }

  function input(which: 'openAt' | 'closeAt'): HTMLInputElement {
    return fixture.nativeElement.querySelector(`#lock-${which}`) as HTMLInputElement;
  }

  /* ---- Save is shut until something is edited ---------------------------- */

  /** The point of the request: opening it must not offer to save nothing. */
  it('opens with Save disabled', async () => {
    await open(entry());

    expect(component.dirty()).toBe(false);
    expect(saveBtn().disabled).toBe(true);
    expect(saveBtn().getAttribute('title')).toBe('No changes to save yet');
  });

  it('enables Save when a date is set', async () => {
    await open(entry());

    component.setOpenAt('2026-09-01T09:30');
    fixture.detectChanges();

    expect(component.dirty()).toBe(true);
    expect(saveBtn().disabled).toBe(false);
  });

  it('enables Save when a toggle moves', async () => {
    await open(entry());

    component.toggleWorkflowLocked();
    fixture.detectChanges();

    expect(saveBtn().disabled).toBe(false);
  });

  /** Changed and changed back is not an edit. */
  it('disables Save again when the value is put back', async () => {
    await open(entry());

    component.setOpenAt('2026-09-01T09:30');
    expect(component.dirty()).toBe(true);

    component.setOpenAt('');
    fixture.detectChanges();

    expect(component.dirty()).toBe(false);
    expect(saveBtn().disabled).toBe(true);
  });

  it('emits nothing when save is called with no edit', async () => {
    await open(entry());

    component.save();

    expect(saved).toEqual([]);
  });

  /* ---- Reading what is stored ------------------------------------------- */

  it('shows the stored dates and toggles', async () => {
    await open(entry({
      sequentiallyLocked: false,
      workflowIds: [
        {
          learningUnitId: 'lu-1',
          workflowId: 'wf-1',
          openAt: Timestamp.fromDate(new Date(2026, 8, 1, 9, 30)),
          closeAt: '',
          workflowLocked: true
        },
        {
          learningUnitId: 'lu-2',
          workflowId: '',
          openAt: '',
          closeAt: Timestamp.fromDate(new Date(2026, 8, 30, 17, 0)),
          workflowLocked: false
        }
      ]
    }));

    expect(input('openAt').value).toBe('2026-09-01T09:30');
    expect(input('closeAt').value).toBe('');
    expect(component.activeRow()!.workflowLocked).toBe(true);

    component.select(1);
    fixture.detectChanges();

    expect(input('openAt').value).toBe('');
    expect(input('closeAt').value).toBe('2026-09-30T17:00');
    expect(component.activeRow()!.workflowLocked).toBe(false);
  });

  /** Old documents named these two fields differently. They still read. */
  it('falls back to the old lockAt and unlockAt field names', async () => {
    await open(entry({
      workflowIds: [{
        learningUnitId: 'lu-1',
        workflowId: '',
        openAt: '',
        closeAt: '',
        lockAt: Timestamp.fromDate(new Date(2026, 0, 5, 8, 15)),
        unlockAt: Timestamp.fromDate(new Date(2026, 0, 9, 20, 45))
      } as never]
    }));

    expect(input('openAt').value).toBe('2026-01-05T08:15');
    expect(input('closeAt').value).toBe('2026-01-09T20:45');
    // Reading them is not editing them.
    expect(component.dirty()).toBe(false);
  });

  /**
   * The array is positional, so a stored row whose learningUnitId does not match
   * the unit at that index belongs to a unit list that has since changed.
   * Adopting its dates would attach them to the wrong unit.
   */
  it('ignores a stored row that no longer lines up with the unit at that index', async () => {
    await open(entry({
      workflowIds: [{
        learningUnitId: 'lu-REMOVED',
        workflowId: 'wf-9',
        openAt: Timestamp.fromDate(new Date(2026, 8, 1, 9, 30)),
        closeAt: '',
        workflowLocked: true
      }]
    }));

    expect(input('openAt').value).toBe('');
    expect(component.activeRow()!.workflowLocked).toBe(false);
    expect(component.activeRow()!.learningUnitId).toBe('lu-1');
  });

  /* ---- The sequential lock ---------------------------------------------- */

  /**
   * Production's rule: a sequence and a calendar cannot both own unlocking, so
   * turning the sequence on CLEARS the dates rather than only grey them. Left
   * behind, they would come back into force when the toggle went off again.
   */
  it('clears and disables every date when the sequential lock goes on', async () => {
    await open(entry());

    component.setOpenAt('2026-09-01T09:30');
    component.select(1);
    component.setCloseAt('2026-09-30T17:00');
    component.select(0);
    fixture.detectChanges();

    component.toggleSequential();
    fixture.detectChanges();

    expect(component.sequentiallyLocked()).toBe(true);
    expect(component.rows().every(row => row.openAt === '' && row.closeAt === '')).toBe(true);
    expect(input('openAt').disabled).toBe(true);
    expect(input('closeAt').disabled).toBe(true);
    // And it says why, rather than leaving two dead fields.
    expect(fixture.nativeElement.textContent)
      .toContain('Date unlock disabled as sequential lock is enabled');
  });

  it('writes empty dates while the sequential lock is on', async () => {
    await open(entry());

    component.setOpenAt('2026-09-01T09:30');
    component.toggleSequential();
    component.save();

    expect(saved[0].sequentiallyLocked).toBe(true);
    expect(saved[0].workflowIds!.every(row => row.openAt === '' && row.closeAt === '')).toBe(true);
  });

  /* ---- What it emits ---------------------------------------------------- */

  it('emits production shape: one positional row per unit, dates or empty strings', async () => {
    await open(entry());

    component.setOpenAt('2026-09-01T09:30');
    component.toggleWorkflowLocked();
    component.save();

    expect(saved.length).toBe(1);
    expect(saved[0].sequentiallyLocked).toBe(false);

    const rows = saved[0].workflowIds!;

    expect(rows.length).toBe(2);
    expect(rows.map(row => row.learningUnitId)).toEqual(['lu-1', 'lu-2']);

    // Timestamp, not a Date and not a string.
    expect(rows[0].openAt).toBeInstanceOf(Timestamp);
    expect((rows[0].openAt as Timestamp).toDate()).toEqual(new Date(2026, 8, 1, 9, 30));
    expect(rows[0].workflowLocked).toBe(true);

    // The untouched unit is still written, as an empty row rather than a hole.
    expect(rows[1].openAt).toBe('');
    expect(rows[1].closeAt).toBe('');
    expect(rows[1].workflowLocked).toBe(false);

    // Never undefined or null: Firestore rejects the first and production does
    // not use the second.
    for (const row of rows) {
      expect(row.openAt === '' || row.openAt instanceof Timestamp).toBe(true);
      expect(row.closeAt === '' || row.closeAt instanceof Timestamp).toBe(true);
    }
  });

  it('carries an existing workflowId through untouched', async () => {
    await open(entry({
      workflowIds: [{
        learningUnitId: 'lu-1', workflowId: 'wf-keep',
        openAt: '', closeAt: '', workflowLocked: false
      }]
    }));

    component.toggleWorkflowLocked();
    component.save();

    expect(saved[0].workflowIds![0].workflowId).toBe('wf-keep');
  });

  /* ---- Units --------------------------------------------------------- */

  it('renders one tab per learning unit, in the programme order', async () => {
    await open(entry(), units(3));

    expect(tabs().map(tab => tab.textContent!.trim()))
      .toEqual(['Squares and Square Roots', 'Card Sorting', 'Quadrilaterals']);
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');

    tabs()[2].click();
    fixture.detectChanges();

    expect(component.activeIndex()).toBe(2);
    expect(tabs()[2].getAttribute('aria-selected')).toBe('true');
  });

  /**
   * A programme with no learning units is the normal case in this app today, so
   * it says so rather than showing an empty strip.
   */
  it('explains itself when the programme has no learning units', async () => {
    await open(entry(), []);

    expect(tabs()).toEqual([]);
    expect(fixture.nativeElement.querySelector('.lock-empty').textContent)
      .toContain('no learning units yet');
    // The programme-wide toggle still works.
    expect(fixture.nativeElement.querySelector('.switch')).not.toBeNull();

    component.toggleSequential();
    component.save();

    expect(saved[0].sequentiallyLocked).toBe(true);
    expect(saved[0].workflowIds).toEqual([]);
  });

  it('names the programme it is about', async () => {
    await open(entry());

    expect(fixture.nativeElement.querySelector('.lock-context').textContent)
      .toContain('Oak 26-27 Grade 8 - Science');
  });

  /* ---- Cancel ---------------------------------------------------------- */

  it('closes without emitting when Cancel is clicked', async () => {
    await open(entry());
    component.setOpenAt('2026-09-01T09:30');

    let closed = 0;
    component.closed.subscribe(() => (closed += 1));

    (fixture.nativeElement.querySelector('.modal-foot .btn-ghost') as HTMLButtonElement).click();

    expect(closed).toBe(1);
    expect(saved).toEqual([]);
  });

  it('exposes the switches as switches, with their state', async () => {
    await open(entry());

    const [sequential] = Array.from(
      fixture.nativeElement.querySelectorAll('.switch') as NodeListOf<HTMLElement>
    );

    expect(sequential.getAttribute('role')).toBe('switch');
    expect(sequential.getAttribute('aria-checked')).toBe('false');

    sequential.click();
    fixture.detectChanges();

    expect(sequential.getAttribute('aria-checked')).toBe('true');
  });
});

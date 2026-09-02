import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Timestamp } from 'firebase/firestore';

import {
  PickableUnit,
  Programme,
  ProgrammeAssignment
} from '../../models/teaching.model';
import { EditProgramme } from './edit-programme';

/**
 * Edit Programme — three tabs, one save.
 *
 * WHAT THESE GUARD is the claim that "whatever is edited lands in the right
 * document field". Every tab patches into the same `Partial<Programme>` and
 * `save()` emits it, so the risk is not that a write fails but that a tab writes
 * to the WRONG field — or that one tab's edit clobbers another's.
 *
 * TWO FIELDS, TWO SHAPES, which is where a mistake would hide:
 *
 *   learningUnitsIds  an ARRAY, positional — a classroom's per-unit locking lines
 *                     up against it index for index
 *   assignmentIds     a MAP keyed by doc id, each entry { assignmentId,
 *                     assignmentDueDate }
 *
 * Crossing them writes a document production cannot read: an array under
 * `assignmentIds` renders nothing in its own panel, and a map under
 * `learningUnitsIds` breaks the locking alignment silently.
 */

function unit(docId: string, code: string): PickableUnit {
  return {
    docId,
    code,
    name: `Unit ${code}`,
    typeCode: 'TA',
    isoCode: 'EN',
    version: 'V10',
    createdAt: null
  };
}

const UNITS: PickableUnit[] = [unit('u1', 'AE01'), unit('u2', 'AE02')];

const ASSIGNMENTS = [
  { docId: 'a1', displayName: 'Case Study Quiz', type: 'QUIZ' },
  { docId: 'a2', displayName: 'Observation Sheet', type: 'UPLOAD' }
];

function programme(overrides: Partial<Programme> = {}): Programme {
  return {
    docId: 'p1',
    programmeId: 'p1',
    programmeName: 'Maths Grade 4',
    programmeCode: 'P10001',
    displayName: 'Maths Grade 4',
    programmeDescription: 'A description',
    institutionId: 'inst-1',
    institutionName: 'BEACON HILL UNIVESITY',
    grades: ['4'],
    age: [],
    type: 'REGULAR',
    programmeStatus: 'LIVE',
    programmeImagePath: '',
    learningUnitsIds: ['u1'],
    activeStatus: true,
    createdSource: 'teacher-corner-web',
    isLocalHost: false,
    ownerId: 'uid-1',
    createdAt: null,
    updatedAt: null,
    ...overrides
  } as unknown as Programme;
}

async function mount(existing: Programme = programme()): Promise<{
  fixture: ComponentFixture<EditProgramme>;
  component: EditProgramme;
  saved: Partial<Programme>[];
}> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({ imports: [EditProgramme] }).compileComponents();

  const fixture = TestBed.createComponent(EditProgramme);
  const component = fixture.componentInstance;
  const saved: Partial<Programme>[] = [];

  fixture.componentRef.setInput('programme', existing);
  fixture.componentRef.setInput('units', UNITS);
  fixture.componentRef.setInput('assignments', ASSIGNMENTS);
  component.saved.subscribe(patch => saved.push(patch));
  fixture.detectChanges();

  return { fixture, component, saved };
}

describe('EditProgramme', () => {

  it('offers production\'s three tabs, Basic Info first', async () => {
    const { component } = await mount();

    expect([...component.tabs]).toEqual(['Basic Info', 'Learning Units', 'Assignments']);
    expect(component.tab()).toBe('Basic Info');
  });

  /* ---- What each tab reads --------------------------------------------- */

  it('reads the stored units and assignments until they are touched', async () => {
    const due = Timestamp.fromDate(new Date(2026, 8, 30, 16, 45));
    const { component } = await mount(
      programme({
        learningUnitsIds: ['u2', 'u1'],
        assignmentIds: { a1: { assignmentId: 'a1', assignmentDueDate: due } }
      })
    );

    expect(component.selectedIds()).toEqual(['u2', 'u1']);
    expect(component.selectedAssignments()).toEqual({
      a1: { assignmentId: 'a1', assignmentDueDate: due }
    });
  });

  /** Most programmes have no such key; the picker needs a map regardless. */
  it('reads an absent assignments map as empty', async () => {
    const { component } = await mount(programme({ assignmentIds: undefined }));

    expect(component.selectedAssignments()).toEqual({});
  });

  /* ---- What each tab writes -------------------------------------------- */

  /**
   * THE UNITS TAB WRITES ONLY `learningUnitsIds`, and the assignments tab only
   * `assignmentIds`. A patch carrying the other field would overwrite something
   * the user never opened.
   */
  it('writes the units tab to learningUnitsIds alone', async () => {
    const { component, saved } = await mount();

    component.tab.set('Learning Units');
    component.setUnits(['u2', 'u1']);
    component.save();

    expect(saved.length).toBe(1);
    expect(saved[0].learningUnitsIds).toEqual(['u2', 'u1']);
    expect('assignmentIds' in saved[0]).toBe(false);
  });

  it('writes the assignments tab to assignmentIds alone', async () => {
    const due = Timestamp.fromDate(new Date(2026, 8, 30, 16, 45));
    const map: Record<string, ProgrammeAssignment> = {
      a1: { assignmentId: 'a1', assignmentDueDate: due }
    };

    const { component, saved } = await mount();

    component.tab.set('Assignments');
    component.setAssignments(map);
    component.save();

    expect(saved.length).toBe(1);
    expect(saved[0].assignmentIds).toEqual(map);
    expect('learningUnitsIds' in saved[0]).toBe(false);
  });

  /**
   * BOTH TABS IN ONE SITTING land in one patch, each in its own field. This is
   * the case where a shared `edits` object could go wrong by overwriting.
   */
  it('carries edits from every tab in a single save', async () => {
    const { component, saved } = await mount();

    component.setName('Renamed');
    component.setUnits(['u2']);
    component.setAssignments({
      a2: { assignmentId: 'a2', assignmentDueDate: null }
    });
    component.save();

    expect(saved.length).toBe(1);
    expect(saved[0].programmeName).toBe('Renamed');
    expect(saved[0].learningUnitsIds).toEqual(['u2']);
    expect(saved[0].assignmentIds).toEqual({
      a2: { assignmentId: 'a2', assignmentDueDate: null }
    });
  });

  /** A field nobody touched is absent, so update() cannot rewrite it. */
  it('emits nothing for the fields left alone', async () => {
    const { component, saved } = await mount();

    component.setUnits(['u2']);
    component.save();

    expect('programmeName' in saved[0]).toBe(false);
    expect('programmeDescription' in saved[0]).toBe(false);
    expect('institutionId' in saved[0]).toBe(false);
  });

  /* ---- Save gating ----------------------------------------------------- */

  it('refuses to save with nothing changed', async () => {
    const { component, saved } = await mount();

    component.save();

    expect(saved.length).toBe(0);
    expect(component.dirty()).toBe(false);
  });

  /**
   * BY VALUE, NOT BY IDENTITY. Every edit produces a fresh object, so a map
   * ticked and then set back to what was stored would otherwise leave Save
   * enabled and write an identical document.
   */
  it('is not dirty when the assignments map is edited back to what it was', async () => {
    const due = Timestamp.fromDate(new Date(2026, 8, 30, 16, 45));
    const { component } = await mount(
      programme({ assignmentIds: { a1: { assignmentId: 'a1', assignmentDueDate: due } } })
    );

    // A different object with the same content, and a Timestamp rebuilt from the
    // same instant — which is not the same reference.
    component.setAssignments({
      a1: {
        assignmentId: 'a1',
        assignmentDueDate: Timestamp.fromDate(new Date(2026, 8, 30, 16, 45))
      }
    });

    expect(component.dirty()).toBe(false);
  });

  it('is dirty when a due date actually moves', async () => {
    const { component } = await mount(
      programme({
        assignmentIds: {
          a1: {
            assignmentId: 'a1',
            assignmentDueDate: Timestamp.fromDate(new Date(2026, 8, 30, 16, 45))
          }
        }
      })
    );

    component.setAssignments({
      a1: {
        assignmentId: 'a1',
        assignmentDueDate: Timestamp.fromDate(new Date(2026, 9, 1, 9, 0))
      }
    });

    expect(component.dirty()).toBe(true);
  });

  it('is dirty when an assignment is added or removed', async () => {
    const { component } = await mount(
      programme({ assignmentIds: { a1: { assignmentId: 'a1', assignmentDueDate: null } } })
    );

    component.setAssignments({});
    expect(component.dirty()).toBe(true);

    component.setAssignments({
      a1: { assignmentId: 'a1', assignmentDueDate: null },
      a2: { assignmentId: 'a2', assignmentDueDate: null }
    });
    expect(component.dirty()).toBe(true);
  });

  /** The array field keeps its own content comparison, order included. */
  it('is dirty only when the unit order really changes', async () => {
    const { component } = await mount(programme({ learningUnitsIds: ['u1', 'u2'] }));

    component.setUnits(['u1', 'u2']);
    expect(component.dirty()).toBe(false);

    component.setUnits(['u2', 'u1']);
    expect(component.dirty()).toBe(true);
  });
});

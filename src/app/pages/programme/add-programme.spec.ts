import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Timestamp } from 'firebase/firestore';

import {
  Institution,
  PickableUnit,
  ProgrammeDraft
} from '../../models/teaching.model';
import { ProgrammeService } from '../../services/programme.service';
import { ResourceUploadService } from '../../services/resource-upload.service';
import { AddProgramme, PROGRAMME_STEPS, REVIEW_STEP } from './add-programme';

/**
 * Add Programme — step 3's selection, ordering and drag arithmetic.
 *
 * WHY THIS AND NOT THE REST OF THE WIZARD. The order of `learningUnitsIds` is
 * STORED and positional: a classroom's per-unit locking is an array lined up
 * against it index for index, so an off-by-one in a drop silently attaches the
 * wrong lock to the wrong unit. Nothing about that is visible in a screenshot,
 * and it is the one part of this component with real arithmetic in it.
 *
 * The services are stubbed only so the component can be constructed: the code
 * preview fires from ngOnInit — see the second suite for why it is not the
 * constructor — and nothing here uploads.
 */

class StubProgrammeService {
  /** Every floor it was asked for, so the timing bug below can be asserted. */
  floors: number[] = [];

  async previewCode(floor: number): Promise<string> {
    this.floors.push(floor);
    return 'P00042';
  }
}

class StubUploadService {
  async upload(): Promise<{ path: string }> {
    return { path: 'programmes/x.png' };
  }
}

function unit(docId: string, code: string, isoCode = 'EN'): PickableUnit {
  return {
    docId,
    code,
    name: `Unit ${code}`,
    typeCode: 'TA',
    isoCode,
    version: 'V10',
    createdAt: null
  };
}

/* One document is one row, so a code appearing twice in two languages is two
   entries — production's shape, and what learningUnitsIds requires. */
const CATALOGUE: PickableUnit[] = [
  unit('a', 'AE01', 'TA'),
  unit('b', 'AE02'),
  unit('c', 'AV01', 'HI'),
  unit('d', 'BE15')
];

/** The one school the wizard needs to be able to resolve on save. */
const SCHOOL = {
  docId: 'inst-1',
  institutionName: 'BEACON HILL UNIVESITY'
} as unknown as Institution;

describe('AddProgramme — step 3', () => {

  let fixture: ComponentFixture<AddProgramme>;
  let component: AddProgramme;

  /**
   * Fills every field save() checks, then emits, and returns the draft.
   *
   * A helper rather than repeated setup: save() refuses unless step one and step
   * two are both valid, so a test about step 4 would otherwise be nine lines of
   * unrelated form filling before the assertion it is actually making.
   */
  function emitDraft(): ProgrammeDraft {
    const drafts: ProgrammeDraft[] = [];

    component.submitted.subscribe(draft => drafts.push(draft));

    fixture.componentRef.setInput('institutions', [SCHOOL]);
    component.institutionId.set(SCHOOL.docId);
    component.programmeName.set('A programme');
    component.description.set('A description');
    component.status.set('LIVE');
    component.type.set('SCHOOL');
    component.setScope('grade');
    // Through the setters: scopeFrom/scopeTo are computed off the grade or age
    // pair, so they are read-only.
    component.setScopeFrom('5');
    component.setScopeTo('5');

    component.save();

    expect(drafts.length).toBe(1);

    return drafts[0];
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AddProgramme],
      providers: [
        { provide: ProgrammeService, useClass: StubProgrammeService },
        { provide: ResourceUploadService, useClass: StubUploadService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AddProgramme);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('institutions', []);
    fixture.componentRef.setInput('units', CATALOGUE);
    fixture.detectChanges();
  });

  /* ---- The wizard's shape ---------------------------------------------- */

  /**
   * FIVE STEPS NOW, production's own. Select Assignments was left out while this
   * app had no assignments collection; it has one, so the step is real.
   */
  it('has five steps, with Review last', () => {
    expect(PROGRAMME_STEPS.map(step => step.label)).toEqual([
      'Institution',
      'Create Programme',
      'Select Learning Units',
      'Select Assignments',
      'Review'
    ]);
    expect(REVIEW_STEP).toBe(5);
    expect(component.reviewStep).toBe(5);
  });

  /**
   * REVIEW IS DERIVED FROM THE LENGTH, not typed. This is the guard that caught
   * the last growth of the stepper: a hardcoded review index rendered the summary
   * on the learning-units step and left two blank steps after it.
   */
  it('keeps the review step as the last one', () => {
    expect(REVIEW_STEP).toBe(PROGRAMME_STEPS.length);
    expect(PROGRAMME_STEPS[PROGRAMME_STEPS.length - 1].label).toBe('Review');
  });

  /* ---- Continue --------------------------------------------------------- */

  it('blocks Continue on step 3 until something is selected', () => {
    component.step.set(3);
    expect(component.continueBlocked()).toBe(true);

    component.selectedIds.set(['a']);
    expect(component.continueBlocked()).toBe(false);
  });

  /* ---- Step 4: assignments --------------------------------------------- */

  /**
   * SKIPPABLE, which is production's own behaviour: its footer button reads Skip
   * on this step. A programme with no assignments is a normal programme, and the
   * label says so at the moment the reader decides whether to engage with it.
   */
  it('never blocks Continue on the assignments step', () => {
    component.step.set(4);

    expect(component.continueBlocked()).toBe(false);
  });

  it('reads Skip on step 4 only while nothing is chosen', () => {
    component.step.set(4);
    expect(component.showSkip()).toBe(true);

    component.selectedAssignments.set({
      a1: { assignmentId: 'a1', assignmentDueDate: null }
    });
    expect(component.showSkip()).toBe(false);

    // And never on another step, whatever is selected.
    component.step.set(3);
    expect(component.showSkip()).toBe(false);
  });

  /**
   * ALWAYS WRITTEN, EMPTY WHEN SKIPPED. 2715 of production's programmes carry the
   * key with an empty map; an omitted field and an empty one read differently to
   * whoever looks next, and absent says nobody has been through this step.
   */
  it('emits an empty map when the step was skipped', () => {
    const draft = emitDraft();

    expect(draft.assignmentIds).toEqual({});
  });

  it('emits the chosen assignments keyed by doc id', () => {
    const due = Timestamp.fromDate(new Date(2026, 8, 5));

    component.selectedAssignments.set({
      a1: { assignmentId: 'a1', assignmentDueDate: due },
      a2: { assignmentId: 'a2', assignmentDueDate: null }
    });

    const draft = emitDraft();

    expect(Object.keys(draft.assignmentIds ?? {}).sort()).toEqual(['a1', 'a2']);
    expect(draft.assignmentIds?.['a1'].assignmentDueDate).toBe(due);
    expect(draft.assignmentIds?.['a2'].assignmentDueDate).toBeNull();
  });

  /* ----------------------------------------------------------------------
     Review
     ---------------------------------------------------------------------- */

  it('lists the review rows in production\'s order', async () => {
    expect(component.reviewRows().map(row => row.label)).toEqual([
      'Programme Name',
      'Display Name',
      'Programme Code',
      'Description',
      'Type',
      'Status',
      'Image',
      'Institution',
      'Grades'
    ]);
  });

  /* NOTHING IS DROPPED. This used to filter empties out, so a programme with no
     description showed one fewer row and the reader could not tell an omitted
     field from one that does not exist. */
  it('keeps every row even when the value is empty', () => {
    expect(component.reviewRows().length).toBe(9);
    expect(component.reviewRows().find(row => row.label === 'Description')?.value).toBe('');
  });

  it('falls back to the programme name for an empty display name', () => {
    component.programmeName.set('Sundial Term 1');

    const rows = component.reviewRows();

    expect(rows.find(row => row.label === 'Display Name')?.value).toBe('Sundial Term 1');
  });

  it('switches the scope row between Grades and Ages', () => {
    expect(component.reviewRows().some(row => row.label === 'Grades')).toBe(true);

    component.setScope('age');

    expect(component.reviewRows().some(row => row.label === 'Ages')).toBe(true);
    expect(component.reviewRows().some(row => row.label === 'Grades')).toBe(false);
  });

  it('marks Status and Image so the template can render them specially', () => {
    const rows = component.reviewRows();

    expect(rows.find(row => row.label === 'Status')?.kind).toBe('status');
    expect(rows.find(row => row.label === 'Image')?.kind).toBe('image');
    expect(rows.find(row => row.label === 'Type')?.kind).toBe('text');
  });

  /* isActiveStatus, not `=== 'LIVE'`: production stores both spellings in
     mixed case. */
  it('treats LIVE and ACTIVE, in any case, as live', () => {
    expect(component.isLiveStatus('LIVE')).toBe(true);
    expect(component.isLiveStatus('active')).toBe(true);
    expect(component.isLiveStatus('DEVELOPEMENT')).toBe(false);
    expect(component.isLiveStatus('')).toBe(false);
  });

  /* THE CHOSEN ORDER, not the catalogue's — the Review must show the sequence
     that is about to be written. */
  it('shows the selected units on the review, in the chosen order', () => {
    component.selectedIds.set(['d', 'a']);

    expect(component.selectedUnits().map(row => row.code)).toEqual(['BE15', 'AE01']);
  });
});

/* ==========================================================================
   Opening pre-scoped, from Add Classroom
   ========================================================================== */

/**
 * WHY THIS MATTERS. Add Classroom's "New programme for this grade" used to open a
 * name-only inline form that produced a programme with no description, type,
 * status, image or learning units. It opens THIS component now, and it already
 * knows the school and grade — so the wizard has to start on step 2 without
 * asking again, and must not offer a way back into step 1, whose Search flow
 * could change the school out from under the classroom being created.
 */
describe('AddProgramme — opened pre-scoped', () => {

  async function mount(inputs: Record<string, unknown>): Promise<{
    fixture: ComponentFixture<AddProgramme>;
    component: AddProgramme;
    service: StubProgrammeService;
    el: HTMLElement;
  }> {
    TestBed.resetTestingModule();
    const service = new StubProgrammeService();

    await TestBed.configureTestingModule({
      imports: [AddProgramme],
      providers: [
        { provide: ProgrammeService, useValue: service },
        { provide: ResourceUploadService, useClass: StubUploadService }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(AddProgramme);
    fixture.componentRef.setInput('institutions', []);
    fixture.componentRef.setInput('units', CATALOGUE);

    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return {
      fixture,
      component: fixture.componentInstance,
      service,
      el: fixture.nativeElement as HTMLElement
    };
  }

  it('starts on step 1 when no school is supplied', async () => {
    const { component } = await mount({});

    expect(component.step()).toBe(1);
    expect(component.institutionLocked()).toBe(false);
  });

  it('starts on step 2 with the school already chosen', async () => {
    const { component } = await mount({
      lockedInstitutionId: 'inst-7',
      presetGrades: ['4']
    });

    expect(component.step()).toBe(2);
    expect(component.institutionId()).toBe('inst-7');
    expect(component.institutionLocked()).toBe(true);
  });

  /**
   * ONE GRADE, seeded as the range's `from` with `to` left empty — Add Classroom
   * knows exactly one grade, and a range would invent scope nobody asked for.
   */
  it('seeds the single preset grade as the whole scope', async () => {
    const { component } = await mount({
      lockedInstitutionId: 'inst-7',
      presetGrades: ['4']
    });

    expect(component.gradeFrom()).toBe('4');
    expect(component.gradeTo()).toBe('');
    expect(component.scopeValuesChosen()).toEqual(['4']);
  });

  /** A club programme carries no grade, and must not be given one. */
  it('leaves the scope empty when no grade is preset', async () => {
    const { component } = await mount({ lockedInstitutionId: 'inst-7', presetGrades: [] });

    expect(component.gradeFrom()).toBe('');
    expect(component.scopeValuesChosen()).toEqual([]);
  });

  /**
   * STEP 2 IS THE FLOOR. Back from there would land on a step whose question has
   * already been answered, and whose Search could reselect a different school.
   */
  it('cannot go back into step 1 when the school is locked', async () => {
    const { component } = await mount({ lockedInstitutionId: 'inst-7', presetGrades: ['4'] });

    component.back();

    expect(component.step()).toBe(2);
  });

  it('offers Cancel rather than Back on its first reachable step', async () => {
    const locked = await mount({ lockedInstitutionId: 'inst-7', presetGrades: ['4'] });
    expect(locked.el.querySelector('.modal-foot .btn-ghost')?.textContent?.trim()).toBe('Cancel');

    const open = await mount({});
    expect(open.el.querySelector('.modal-foot .btn-ghost')?.textContent?.trim()).toBe('Cancel');
  });

  it('still walks back to step 2 from later steps when locked', async () => {
    const { component } = await mount({ lockedInstitutionId: 'inst-7', presetGrades: ['4'] });

    component.step.set(3);
    component.back();

    expect(component.step()).toBe(2);
  });

  /* ---- The code preview's floor ---------------------------------------- */

  /**
   * THE BUG THIS PINS. The preview was requested from the CONSTRUCTOR, where a
   * signal input is not bound yet — an optional one returns its default — so
   * `existing()` read `[]` and the catalogue floor was never applied. A teacher
   * whose own counter document did not exist was shown P10001 as the next code
   * while the catalogue already held P10024. It runs in ngOnInit now.
   */
  it('floors the code preview with the caller\'s catalogue', async () => {
    const { service } = await mount({
      existing: [
        { programmeCode: 'P10024' } as never,
        { programmeCode: 'P10007' } as never
      ]
    });

    expect(service.floors).toEqual([10024]);
  });

  it('asks for the preview exactly once', async () => {
    const { service } = await mount({ existing: [] });

    expect(service.floors.length).toBe(1);
  });
});

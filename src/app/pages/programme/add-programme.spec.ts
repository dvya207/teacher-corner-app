import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PickableUnit } from '../../models/teaching.model';
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
 * preview fires from the constructor, and nothing here uploads.
 */

class StubProgrammeService {
  async previewCode(): Promise<string> {
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

describe('AddProgramme — step 3', () => {

  let fixture: ComponentFixture<AddProgramme>;
  let component: AddProgramme;

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

  it('has four steps, with Review last', () => {
    expect(PROGRAMME_STEPS.map(step => step.label)).toEqual([
      'Institution',
      'Create Programme',
      'Select Learning Units',
      'Review'
    ]);
    expect(REVIEW_STEP).toBe(4);
    expect(component.reviewStep).toBe(4);
  });

  it('does not offer Select Assignments', () => {
    expect(PROGRAMME_STEPS.some(step => step.label.includes('Assignment'))).toBe(false);
  });

  /* ---- Continue --------------------------------------------------------- */

  it('blocks Continue on step 3 until something is selected', () => {
    component.step.set(3);
    expect(component.continueBlocked()).toBe(true);

    component.selectedIds.set(['a']);
    expect(component.continueBlocked()).toBe(false);
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

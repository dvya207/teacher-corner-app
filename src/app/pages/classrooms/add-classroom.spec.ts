import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Classroom, Institution, Programme } from '../../models/teaching.model';
import { AddClassroom } from './add-classroom';

/**
 * Add Classroom — the handoff to the Create Programme wizard.
 *
 * WHY ONLY THIS PART. The form's sequential unlocking is production behaviour
 * covered by the picker suite next door; what is new and easy to get silently
 * wrong is the request this component emits when the programme picker has
 * nothing to offer.
 *
 * It used to open a name-only inline form here and emit a whole ProgrammeDraft
 * built from it — no description, no type, no status, no image, and
 * `learningUnitsIds: []`. Now that a classroom stores its allotted units, a
 * programme created that way could never allot any. So the link asks the PAGE
 * for the real wizard instead, and the two assertions that matter are that the
 * inline form is gone and that the scope travels with the request: the wizard
 * skips its first step on the strength of it, and a wrong school or grade there
 * would attach the programme to the wrong place.
 */

function institution(overrides: Partial<Institution> = {}): Institution {
  return {
    docId: 'inst-1',
    institutionName: 'Kuvempu University',
    board: 'CBSE',
    pincode: '577451',
    country: 'India',
    ...overrides
  } as Institution;
}

describe('AddClassroom — the Create Programme handoff', () => {

  let fixture: ComponentFixture<AddClassroom>;
  let component: AddClassroom;
  let requests: { institutionId: string; institutionName: string; grades: string[] }[];

  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({ imports: [AddClassroom] }).compileComponents();

    fixture = TestBed.createComponent(AddClassroom);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('institutions', [institution()]);
    fixture.componentRef.setInput('classrooms', [] as Classroom[]);
    fixture.componentRef.setInput('programmes', [] as Programme[]);
    fixture.detectChanges();

    requests = [];
    component.programmeWizardRequested.subscribe(scope => requests.push(scope));
  });

  afterEach(() => {
    fixture.destroy();
  });

  /**
   * Gets far enough for the programme section to RENDER.
   *
   * `searched` is the one that is easy to miss: the whole chain of unlocked
   * computeds runs through `schoolUnlocked = searched()`, so without it the
   * programme block stays behind "Select Programmes" and the link is not in the
   * DOM at all.
   */
  function fillClassroom(grade = '4'): void {
    component.type.set('CLASSROOM');
    component.pincode.set('577451');
    component.board.set('CBSE');
    component.searched.set(true);
    component.institutionId.set('inst-1');
    component.grade.set(grade);
    component.section.set('B');
    fixture.detectChanges();
  }

  it('asks for the wizard with the chosen school and grade', () => {
    fillClassroom('4');

    component.openProgrammeForm();

    expect(requests).toEqual([
      { institutionId: 'inst-1', institutionName: 'Kuvempu University', grades: ['4'] }
    ]);
  });

  /** A club programme is not grade-scoped, so it must carry no grade. */
  it('sends no grade for a STEM club', () => {
    component.type.set('STEM-CLUB');
    component.institutionId.set('inst-1');
    component.stemClubName.set('Robotics');
    fixture.detectChanges();

    component.openProgrammeForm();

    expect(requests[0].grades).toEqual([]);
  });

  /**
   * NOTHING IS EMITTED WITHOUT A SCHOOL. The wizard skips its own first step on
   * the strength of this value, so an empty institutionId would open it locked to
   * no school at all — worse than not opening.
   */
  it('emits nothing when no school is chosen yet', () => {
    component.type.set('CLASSROOM');
    fixture.detectChanges();

    component.openProgrammeForm();

    expect(requests).toEqual([]);
  });

  /**
   * THE INLINE FORM IS GONE, pinned so a revert is visible. Its absence is the
   * point of the change: a programme created by it had no learning units, and a
   * classroom now stores the units it is allotted.
   */
  it('no longer carries a name-only inline create form', () => {
    fillClassroom();

    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('#np-name')).toBeNull();
    expect(el.querySelector('.new-programme')).toBeNull();
    expect(el.textContent).not.toContain('Create programme');

    // The link that opens the wizard is still there.
    expect(el.textContent).toContain('New programme for this');
  });

  /** The component still writes nothing itself; it only asks. */
  it('exposes no programme-draft output any more', () => {
    expect((component as unknown as Record<string, unknown>)['programmeRequested'])
      .toBeUndefined();
    expect((component as unknown as Record<string, unknown>)['createProgramme'])
      .toBeUndefined();
  });
});

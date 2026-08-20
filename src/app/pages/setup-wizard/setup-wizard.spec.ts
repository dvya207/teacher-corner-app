import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Timestamp } from 'firebase/firestore';

import {
  Classroom,
  Institution,
  InstitutionDraft,
  Programme,
  Teacher,
  TeacherDraft
} from '../../models/teaching.model';
import { InstitutionService } from '../../services/institution.service';
import { ClassroomService } from '../../services/classroom.service';
import { ProgrammeService } from '../../services/programme.service';
import { TeacherService } from '../../services/teacher.service';
import { SetupWizard, registeredMessage } from './setup-wizard';

/**
 * Set Up Wizard — step 1, Institution Selection.
 *
 * WHAT IS WORTH PINNING HERE. The form's behaviour is almost entirely
 * DERIVED — which control is open, which schools are offered, whether Continue
 * advances — and every one of those derivations has a way of being subtly wrong
 * that still renders. So the tests are about the chain, the filter and the
 * invalidation, not about whether four labels appear.
 *
 * InstitutionService is stubbed. Firestore is not involved.
 */

function institution(overrides: Partial<Institution> = {}): Institution {
  const address = {
    city: 'Shivamogga',
    country: 'India',
    district: 'Shivamogga',
    landmark: '',
    pincode: '577452',
    state: 'Karnataka',
    street: '',
    subDistrict: '',
    village: '',
    ...(overrides.institutionAddress ?? {})
  };

  return {
    docId: 'inst-1',
    institutionName: 'Oak Public School',
    board: 'CBSE',
    classroomCounter: 0,
    genderType: 'Co-ed',
    institutionCode: '',
    medium: 'EN',
    registrationNumber: '',
    representativeCountryCode: '+91',
    representativePhoneNumber: '',
    representativeEmail: '',
    representativeFirstName: '',
    representativeLastName: '',
    typeofSchool: 'Private School',
    customerSchool: false,
    active: true,
    verified: false,
    ownerId: 'teacher-1',
    createdAt: Timestamp.fromDate(new Date('2026-01-01')),
    ...overrides,
    institutionAddress: address
  } as Institution;
}

function programme(overrides: Partial<Programme> = {}): Programme {
  return {
    docId: 'prog-1',
    programmeId: 'prog-1',
    programmeName: 'Oak 26-27 Grade 1 - Science',
    displayName: 'Oak 26-27 Grade 1 - Science',
    programmeCode: 'P10001',
    programmeDescription: '',
    institutionId: 'inst-1',
    institutionName: 'Oak Public School',
    grades: ['1'],
    type: 'REGULAR',
    programmeStatus: 'LIVE',
    ownerId: 'teacher-1',
    ...overrides
  } as Programme;
}

/**
 * The classrooms step 2 attaches teachers to.
 *
 * REQUIRED NOW: the form picks a classroom rather than a grade and a programme,
 * so a wizard with no classrooms cannot register anybody.
 */
function classroomFixture(fields: Partial<Classroom> = {}): Classroom {
  return {
    docId: 'c1',
    classroomId: 'c1',
    classroomCode: 'C1',
    type: 'CLASSROOM',
    classroomName: '4 A',
    stemClubName: '',
    grade: '4',
    section: 'A',
    board: 'CBSE',
    institutionId: 'inst-1',
    institutionName: 'Oak School',
    programmes: {
      'prog-1': {
        programmeId: 'prog-1',
        programmeName: 'Science',
        programmeCode: 'P1',
        displayName: 'Science',
        sequentiallyLocked: false
      }
    },
    studentCounter: 0,
    studentCredentialStoragePath: '',
    ownerId: 'teacher-1',
    ...fields
  } as Classroom;
}

class StubClassroomService {
  created: Record<string, unknown>[] = [];
  createError: unknown = null;
  private next = 0;

  constructor(public classrooms: Classroom[] = [classroomFixture()]) {}

  list = async (): Promise<Classroom[]> => this.classrooms;

  create = async (draft: Record<string, unknown>): Promise<Classroom> => {
    if (this.createError) {
      throw this.createError;
    }

    this.created.push(draft);
    const docId = `made-${++this.next}`;

    // The real service composes the name from grade and section rather than
    // storing what it was handed.
    return {
      ...draft,
      docId,
      classroomId: docId,
      classroomName: `${draft['grade']} ${draft['section']}`.trim()
    } as unknown as Classroom;
  };

  describeError = (_error: unknown, fallback: string): string => fallback;
}

class StubProgrammeService {
  constructor(public programmes: Programme[] = [programme()]) {}
  list = async (): Promise<Programme[]> => this.programmes;
  describeError = (_error: unknown, fallback: string): string => fallback;
}

class StubTeacherService {
  createError: (Error & { created?: Teacher[] }) | null = null;
  calls: TeacherDraft[][] = [];
  appended: { docId: string; classrooms: Record<string, unknown> }[] = [];
  existing: Teacher[] = [];
  private next = 0;

  list = async (): Promise<Teacher[]> => this.existing;

  appendClassrooms = async (
    teacher: Teacher,
    additions: Record<string, unknown>
  ): Promise<Teacher> => {
    this.appended.push({ docId: teacher.docId, classrooms: additions });

    return {
      ...teacher,
      classrooms: { ...teacher.classrooms, ...additions } as Teacher['classrooms']
    };
  };

  createMany = async (drafts: TeacherDraft[]): Promise<Teacher[]> => {
    this.calls.push(drafts);

    if (this.createError) {
      throw this.createError;
    }

    return drafts.map(draft => ({
      ...draft,
      // Keyed by phone, as the real service does.
      docId: draft.teacherMeta.phoneNumber || `t${++this.next}`,
      ownerId: 'teacher-1'
    } as unknown as Teacher));
  };

  describeError = (_error: unknown, fallback: string): string => fallback;
}

class StubInstitutionService {
  /** Set by tests that need create() to fail. */
  createError: Error | null = null;
  /** What create() resolves with, and what the page should end up selecting. */
  created: Institution = institution({ docId: 'new-1', institutionName: 'Brand New School' });
  createCalls: InstitutionDraft[] = [];

  list = async (): Promise<Institution[]> => this.institutions;
  describeError = (_error: unknown, fallback: string): string => fallback;

  create = async (draft: InstitutionDraft): Promise<Institution> => {
    this.createCalls.push(draft);

    if (this.createError) {
      throw this.createError;
    }

    return this.created;
  };

  constructor(public institutions: Institution[] = []) {}
}

describe('Set Up Wizard — Institution Selection', () => {

  let fixture: ComponentFixture<SetupWizard>;
  let component: SetupWizard;
  let service: StubInstitutionService;

  async function render(institutions: Institution[] = [institution()]): Promise<void> {
    service = new StubInstitutionService(institutions);

    await TestBed.configureTestingModule({
      imports: [SetupWizard],
      providers: [
        { provide: InstitutionService, useValue: service },
        { provide: TeacherService, useValue: new StubTeacherService() },
        { provide: ProgrammeService, useValue: new StubProgrammeService() },
        { provide: ClassroomService, useValue: new StubClassroomService() }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SetupWizard);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await component.load();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /* ---- The stepper ------------------------------------------------------- */

  /**
   * PINNED at two. Add STEM Club Teachers, Add Students and Add STEM Club
   * Students were removed on instruction; a stepper that advertises a step the
   * wizard cannot reach is worse than a short one.
   */
  it('renders exactly the two steps the wizard has', async () => {
    await render();

    const labels = [...el().querySelectorAll('.stepper .step-label')]
      .map(step => step.textContent?.trim());

    expect(labels).toEqual(['Institution Selection', 'Add Teachers']);
  });

  it('opens on step 1 with only that step marked current', async () => {
    await render();

    expect(component.step()).toBe(1);
    expect(el().querySelectorAll('.step.is-current').length).toBe(1);
    expect(el().querySelector('.step.is-current .step-label')?.textContent?.trim())
      .toBe('Institution Selection');
  });

  /* ---- Progressive unlocking --------------------------------------------- */

  /**
   * Country defaults to India, so pincode is the one control open on first
   * paint. This is the state the reference screenshot's form starts in.
   */
  it('opens with Country filled and everything below Pincode locked', async () => {
    await render();

    expect(component.country()).toBe('India');
    expect(component.locked('pincode')).toBe(false);
    expect(component.locked('board')).toBe(true);
    expect(component.locked('school')).toBe(true);
  });

  /**
   * THE BUG THIS CATCHES: unlocking Board on any non-empty pincode. The school
   * list is filtered on the pincode, so opening Board after "577" would offer a
   * Board whose school list is guaranteed empty for a reason the user cannot see.
   */
  it('keeps Board locked until the pincode is a complete six digits', async () => {
    await render();

    component.setPincode('577');
    expect(component.locked('board')).toBe(true);

    component.setPincode('577452');
    expect(component.locked('board')).toBe(false);
  });

  it('unlocks School only once a Board is chosen', async () => {
    await render();

    component.setPincode('577452');
    expect(component.locked('school')).toBe(true);

    component.setBoard('CBSE');
    expect(component.locked('school')).toBe(false);
  });

  /* ---- The pincode input -------------------------------------------------- */

  it('strips non-digits and caps an Indian pincode at six', async () => {
    await render();

    component.setPincode('57a7-452999');

    expect(component.pincode()).toBe('577452');
  });

  /**
   * The six-digit rule is India's, and the Country select is not fixed to India.
   * A UK postcode must survive being typed.
   */
  it('leaves a non-Indian postal code alone', async () => {
    await render();

    component.setCountry('United Kingdom');
    component.setPincode('SW1A 1AA');

    expect(component.pincode()).toBe('SW1A 1AA');
    expect(component.locked('board')).toBe(false);
  });

  /* ---- The school list ---------------------------------------------------- */

  it('offers only institutions matching the country, pincode and board', async () => {
    await render([
      institution({ docId: 'a', institutionName: 'Oak Public School' }),
      institution({ docId: 'b', institutionName: 'Elsewhere High', board: 'ICSE' }),
      institution({
        docId: 'c',
        institutionName: 'Other Pincode School',
        institutionAddress: { pincode: '560001' } as Institution['institutionAddress']
      })
    ]);

    component.setPincode('577452');
    component.setBoard('CBSE');

    expect(component.matchingSchools().map(match => match.docId)).toEqual(['a']);
  });

  it('offers nothing until the pincode is complete', async () => {
    await render();

    component.setBoard('CBSE');
    component.setPincode('577');

    expect(component.matchingSchools()).toEqual([]);
  });

  it('reports a search that ran and matched nothing', async () => {
    await render([institution({ board: 'ICSE' })]);

    component.setPincode('577452');
    component.setBoard('CBSE');
    fixture.detectChanges();

    expect(component.noMatches()).toBe(true);
    expect(el().querySelector('.field-hint')?.textContent?.trim())
      .toContain('No institution of yours is registered');
  });

  /**
   * "Not searched yet" and "searched, found nothing" must not look the same, or
   * an unfinished pincode reads as a broken lookup.
   */
  it('does not report no-matches before the search can run', async () => {
    await render([]);

    expect(component.noMatches()).toBe(false);
  });

  /* ---- Invalidation ------------------------------------------------------- */

  /**
   * THE BUG THIS CATCHES: narrowing the search while a school stays selected.
   * Without this the wizard could advance carrying a school the current filter
   * would no longer return.
   */
  it('clears the chosen school when the pincode changes', async () => {
    await render();

    component.setPincode('577452');
    component.setBoard('CBSE');
    component.setSchool('inst-1');

    component.setPincode('560001');

    expect(component.school()).toBe('');
  });

  it('clears the chosen school when the board changes', async () => {
    await render();

    component.setPincode('577452');
    component.setBoard('CBSE');
    component.setSchool('inst-1');

    component.setBoard('ICSE');

    expect(component.school()).toBe('');
  });

  /** A country change invalidates the pincode too, whose format it governs. */
  it('clears pincode, board and school when the country changes', async () => {
    await render();

    component.setPincode('577452');
    component.setBoard('CBSE');
    component.setSchool('inst-1');

    component.setCountry('Germany');

    expect(component.pincode()).toBe('');
    expect(component.board()).toBe('');
    expect(component.school()).toBe('');
  });

  /* ---- Validation and Continue -------------------------------------------- */

  /* ---- Continue is gated ---------------------------------------------------
     Reversed on instruction: the button used to stay clickable so that pressing
     it revealed what was missing. It is now dead until step 1 is complete, which
     means BLUR is the only thing left that explains a gap. */

  it('keeps Continue dead until every required field is answered', async () => {
    await render();

    const button = () => el().querySelector<HTMLButtonElement>('.wizard-foot button')!;

    expect(button().disabled).toBe(true);

    component.setPincode('577452');
    fixture.detectChanges();
    expect(button().disabled).toBe(true);

    component.setBoard('CBSE');
    fixture.detectChanges();
    expect(button().disabled).toBe(true);

    component.setSchool('inst-1');
    fixture.detectChanges();
    expect(button().disabled).toBe(false);
  });

  /** Blur now carries all of the explaining, so it must still work. */
  it('still explains a gap on blur, with Continue dead', async () => {
    await render();

    component.setPincode('577452');
    component.setBoard('CBSE');
    component.markBlurred('school');
    fixture.detectChanges();

    expect(component.canPressContinue()).toBe(false);
    expect(el().querySelector('.field-error')?.textContent?.trim()).toBe('School is required');
  });

  it('keeps Continue dead while the institutions are still loading', async () => {
    await render();

    component.loading.set(true);
    component.setPincode('577452');
    component.setBoard('CBSE');
    component.setSchool('inst-1');

    expect(component.canPressContinue()).toBe(false);
  });

  it('keeps Continue dead while Bulk Upload is on', async () => {
    await render();

    component.setPincode('577452');
    component.setBoard('CBSE');
    component.setSchool('inst-1');
    component.toggleBulkUpload();

    expect(component.canPressContinue()).toBe(false);
  });

  /* ---- Field order ---------------------------------------------------------
     THE BUG THESE CATCH: adding the bulk panel moved Board above the pincode,
     while the unlock chain still ran country -> pincode -> board. Board was
     therefore permanently disabled and sat ABOVE the field it was waiting on,
     which left step 1 with no way forward at all. */

  it('orders the controls Country, Pincode, Board, School', async () => {
    await render();

    const ids = [...el().querySelectorAll<HTMLElement>('.field select, .field input')]
      .map(control => control.id)
      .filter(Boolean);

    expect(ids).toEqual(['sw-country', 'sw-pincode', 'sw-board', 'sw-school']);
  });

  it('puts Board straight after Country in bulk mode, where there is no pincode', async () => {
    await render();
    component.toggleBulkUpload();
    fixture.detectChanges();

    const ids = [...el().querySelectorAll<HTMLElement>('.wizard-card .field select, .wizard-card .field input')]
      .map(control => control.id)
      .filter(id => id.startsWith('sw-'));

    expect(ids).toEqual(['sw-country', 'sw-board']);
    expect(el().querySelector('#sw-pincode')).toBeNull();
  });

  /**
   * The control the user actually got stuck on: India chosen, Board dead, and no
   * way to reach the pincode that would have opened it.
   */
  it('unlocks Board once the pincode is complete, never before', async () => {
    await render();
    const board = () => el().querySelector<HTMLSelectElement>('#sw-board')!;

    expect(board().disabled).toBe(true);

    component.setPincode('577');
    fixture.detectChanges();
    expect(board().disabled).toBe(true);

    component.setPincode('577452');
    fixture.detectChanges();
    expect(board().disabled).toBe(false);
  });

  it('shows no errors on first paint', async () => {
    await render();

    expect(el().querySelectorAll('.field-error').length).toBe(0);
  });

  /**
   * The state the reference screenshot is in: everything filled except School,
   * which is outlined red under a "School is required" message.
   */
  it('marks School required, and stays on step 1, when Continue is pressed without one', async () => {
    await render();

    component.setPincode('577452');
    component.setBoard('CBSE');
    component.next();
    fixture.detectChanges();

    expect(component.step()).toBe(1);
    expect(component.isMissing('school')).toBe(true);
    expect(el().querySelector('#sw-school')?.classList).toContain('is-error');
    expect(el().querySelector('.field-error')?.textContent?.trim()).toBe('School is required');
  });

  it('advances to Add Teachers once a school is chosen', async () => {
    await render();

    component.setPincode('577452');
    component.setBoard('CBSE');
    component.setSchool('inst-1');
    component.next();
    fixture.detectChanges();

    expect(component.step()).toBe(2);
    // Step 2 is the real Add Teachers form now, not a stub.
    expect(el().querySelector('app-add-teachers')).not.toBeNull();
    expect(el().querySelector('.step.is-current .step-label')?.textContent?.trim())
      .toBe('Add Teachers');
  });

  /** Back returns without re-running the validation the user already passed. */
  it('returns to step 1 from step 2 with the selection intact', async () => {
    await render();

    component.setPincode('577452');
    component.setBoard('CBSE');
    component.setSchool('inst-1');
    component.next();
    component.back();
    fixture.detectChanges();

    expect(component.step()).toBe(1);
    expect(component.school()).toBe('inst-1');
    expect(el().querySelectorAll('.field-error').length).toBe(0);
  });

  it('never advances past the last step', async () => {
    await render();

    component.step.set(2);
    component.next();

    expect(component.step()).toBe(2);
  });

  /**
   * Add Teachers is the END of the wizard now. A dead Next Step beside it reads
   * as something broken rather than as something finished.
   */
  it('offers no Next Step on the last step', async () => {
    await render();

    component.setPincode('577452');
    component.setBoard('CBSE');
    component.setSchool('inst-1');
    component.next();
    fixture.detectChanges();

    const nav = [...el().querySelectorAll('.step-nav button')]
      .map(button => button.textContent?.trim());

    expect(component.step()).toBe(2);
    expect(nav).toEqual(['Previous Step']);
  });

  /* ---- Bulk upload -------------------------------------------------------- */

  it('opens with the toggle off and the single-school form showing', async () => {
    await render();

    expect(component.bulkUpload()).toBe(false);
    expect(el().querySelector('.switch')?.getAttribute('aria-checked')).toBe('false');
    expect(el().querySelector('#sw-country')).not.toBeNull();
  });

  /**
   * The two modes are alternatives BELOW Board, not above it: Country and Board
   * apply to every school in an uploaded file, so they are shared. The pincode
   * and school search are what the bulk panel replaces.
   */
  it('replaces the search controls with the bulk panel when toggled on', async () => {
    await render();

    component.toggleBulkUpload();
    fixture.detectChanges();

    expect(el().querySelector('#sw-pincode')).toBeNull();
    expect(el().querySelector('#sw-school')).toBeNull();
    expect(el().querySelector('app-bulk-upload-schools')).not.toBeNull();
    expect(el().querySelector('#sw-country')).not.toBeNull();
    expect(el().querySelector('.switch')?.getAttribute('aria-checked')).toBe('true');
  });

  /* ---- Load failure ------------------------------------------------------- */

  it('shows why the school list is unavailable rather than an empty select', async () => {
    await TestBed.configureTestingModule({
      imports: [SetupWizard],
      providers: [
        {
          provide: InstitutionService,
          useValue: {
            list: async () => { throw new Error('permission-denied'); },
            describeError: (_e: unknown, fallback: string) => fallback
          }
        },
        { provide: TeacherService, useValue: new StubTeacherService() },
        { provide: ProgrammeService, useValue: new StubProgrammeService() },
        { provide: ClassroomService, useValue: new StubClassroomService() }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SetupWizard);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await component.load();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.loadError()).toBe('Could not load your institutions.');
    expect(el().querySelector('.load-error')?.textContent?.trim())
      .toBe('Could not load your institutions.');
    expect(el().querySelector('#sw-country')).toBeNull();
  });
});

describe('Set Up Wizard — Add a New Institution', () => {

  let fixture: ComponentFixture<SetupWizard>;
  let component: SetupWizard;
  let service: StubInstitutionService;
  let teacherService: StubTeacherService;

  async function render(institutions: Institution[] = []): Promise<void> {
    service = new StubInstitutionService(institutions);
    teacherService = new StubTeacherService();

    await TestBed.configureTestingModule({
      imports: [SetupWizard],
      providers: [
        { provide: InstitutionService, useValue: service },
        { provide: TeacherService, useValue: teacherService },
        { provide: ProgrammeService, useValue: new StubProgrammeService() },
        { provide: ClassroomService, useValue: new StubClassroomService() }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SetupWizard);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await component.load();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /** Reaches the state where the search has run and found nothing. */
  async function searchWithNoMatches(): Promise<void> {
    component.setPincode('577452');
    component.setBoard('CBSE');
    fixture.detectChanges();
    await component.load();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /* ---- The entry ---------------------------------------------------------- */

  it('offers the entry inside the dropdown once School is unlocked', async () => {
    await render();
    await searchWithNoMatches();

    const options = [...el().querySelectorAll('#sw-school option')]
      .map(option => option.textContent?.trim());

    expect(options).toContain('+ Add a New Institution');
  });

  it('does not offer it before School is unlocked', async () => {
    await render();

    const options = [...el().querySelectorAll('#sw-school option')]
      .map(option => option.textContent?.trim());

    expect(options).not.toContain('+ Add a New Institution');
  });

  /**
   * THE BUG THIS CATCHES: disabling the School select when the search found
   * nothing. That is exactly when the entry is needed, and a disabled control
   * puts the only way forward out of reach — the step dead-ends.
   */
  it('leaves the School select usable when the search found nothing', async () => {
    await render();
    await searchWithNoMatches();

    expect(component.noMatches()).toBe(true);
    expect(el().querySelector<HTMLSelectElement>('#sw-school')?.disabled).toBe(false);
  });

  it('points the empty-search hint at the entry', async () => {
    await render();
    await searchWithNoMatches();

    expect(el().querySelector('.field-hint.is-warn')?.textContent)
      .toContain('+ Add a New Institution');
  });

  /* ---- Opening ------------------------------------------------------------ */

  it('opens the inline form, and selects no school, when the entry is chosen', async () => {
    await render();
    await searchWithNoMatches();

    component.setSchool(component.addInstitutionValue);
    fixture.detectChanges();

    expect(component.creatingInstitution()).toBe(true);
    expect(component.school()).toBe('');
    expect(el().querySelector('app-add-institution-inline')).not.toBeNull();
  });

  /**
   * The sentinel must never reach the school signal, or Continue would advance
   * carrying "__add_institution__" as the chosen institution.
   */
  it('never stores the sentinel as a school', async () => {
    await render();
    await searchWithNoMatches();

    component.setSchool(component.addInstitutionValue);
    component.next();

    expect(component.school()).not.toBe(component.addInstitutionValue);
    expect(component.step()).toBe(1);
  });

  /**
   * THE BUG THIS CATCHES: the control left reading "+ Add a New Institution".
   *
   * A native <select> moves itself to the clicked option before any handler runs,
   * and [selected] does not pull it back. The signal was correctly empty while
   * the DOM said otherwise, so cancelling returned the user to a dropdown that
   * looked like it had a school chosen and a Continue that refused to advance.
   */
  it('puts the control back rather than displaying the sentinel', async () => {
    await render();
    await searchWithNoMatches();

    const select = el().querySelector<HTMLSelectElement>('#sw-school')!;
    select.value = component.addInstitutionValue;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(component.creatingInstitution()).toBe(true);
    expect(select.value).not.toBe(component.addInstitutionValue);
    expect(select.value).toBe('');
  });

  it('restores the previously chosen school after cancelling', async () => {
    await render([institution({ docId: 'a', institutionName: 'Oak Public School' })]);
    await searchWithNoMatches();

    const select = el().querySelector<HTMLSelectElement>('#sw-school')!;
    select.value = 'a';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(component.school()).toBe('a');

    select.value = component.addInstitutionValue;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(select.value).toBe('a');
    expect(component.school()).toBe('a');
  });

  it('carries the failed search into the form as its country, board and pincode', async () => {
    await render();
    await searchWithNoMatches();
    component.setSchool(component.addInstitutionValue);
    fixture.detectChanges();

    const inline = el().querySelector('app-add-institution-inline');

    expect(inline?.querySelector<HTMLInputElement>('#ai-country')?.value).toBe('India');
    expect(inline?.querySelector<HTMLInputElement>('#ai-board')?.value)
      .toBe('Central Board Of Secondary Education');
  });

  it('closes without selecting anything when the form is dismissed', async () => {
    await render();
    await searchWithNoMatches();
    component.setSchool(component.addInstitutionValue);

    component.closeInstitutionForm();
    fixture.detectChanges();

    expect(component.creatingInstitution()).toBe(false);
    expect(component.school()).toBe('');
    expect(el().querySelector('app-add-institution-inline')).toBeNull();
  });

  /* ---- Creating ----------------------------------------------------------- */

  it('registers the school through the same service the Institutions page uses', async () => {
    await render();
    await searchWithNoMatches();
    component.setSchool(component.addInstitutionValue);

    await component.createInstitution({ institutionName: 'Brand New School' } as InstitutionDraft);
    fixture.detectChanges();

    expect(service.createCalls.length).toBe(1);
    expect(component.creatingInstitution()).toBe(false);
    expect(component.school()).toBe('new-1');
  });

  /**
   * THE BUG THIS CATCHES: filing the school correctly and then hiding it.
   *
   * The inline form leaves pincode editable, so the school that comes back need
   * not match the pincode that was searched on. If the search is not moved to it,
   * the new school is absent from matchingSchools() and the select renders blank
   * against a school signal that does hold its id.
   */
  it('moves the search to the new school when its pincode differs', async () => {
    await render();
    service.created = institution({
      docId: 'new-2',
      institutionName: 'Corrected Pincode School',
      institutionAddress: { pincode: '560001' } as Institution['institutionAddress']
    });

    await searchWithNoMatches();
    component.setSchool(component.addInstitutionValue);
    await component.createInstitution({} as InstitutionDraft);
    fixture.detectChanges();

    expect(component.pincode()).toBe('560001');
    expect(component.matchingSchools().map(match => match.docId)).toEqual(['new-2']);
    expect(component.selectedSchool()?.docId).toBe('new-2');
  });

  it('shows the new school in the dropdown and lets the step complete', async () => {
    await render();
    await searchWithNoMatches();
    component.setSchool(component.addInstitutionValue);
    await component.createInstitution({} as InstitutionDraft);
    fixture.detectChanges();

    const options = [...el().querySelectorAll('#sw-school option')]
      .map(option => option.textContent?.trim());

    expect(options).toContain('Brand New School');
    expect(component.stepOneComplete()).toBe(true);

    component.next();
    expect(component.step()).toBe(2);
  });

  /** The confirmation is a toast now, not a line inside the card. */
  it('confirms the registration in a toast', async () => {
    await render();
    await searchWithNoMatches();
    component.setSchool(component.addInstitutionValue);
    await component.createInstitution({} as InstitutionDraft);
    fixture.detectChanges();

    expect(el().querySelector('.toast')?.textContent)
      .toContain('Brand New School registered successfully');
  });

  /* ---- Failure ------------------------------------------------------------ */

  /** A failed write must not close the form, or everything typed is lost. */
  it('keeps the form open and explains a failed registration', async () => {
    await render();
    service.createError = new Error('permission-denied');

    await searchWithNoMatches();
    component.setSchool(component.addInstitutionValue);
    await component.createInstitution({} as InstitutionDraft);
    fixture.detectChanges();

    expect(component.creatingInstitution()).toBe(true);
    expect(component.saveError()).toBe('Could not register the school.');
    expect(component.school()).toBe('');
    expect(el().querySelector('app-add-institution-inline')).not.toBeNull();
  });

  it('ignores a second submit while the first is still in flight', async () => {
    await render();
    await searchWithNoMatches();
    component.setSchool(component.addInstitutionValue);

    const first = component.createInstitution({} as InstitutionDraft);
    const second = component.createInstitution({} as InstitutionDraft);
    await Promise.all([first, second]);

    expect(service.createCalls.length).toBe(1);
  });
});

describe('Set Up Wizard — registering teachers', () => {

  let fixture: ComponentFixture<SetupWizard>;
  let component: SetupWizard;
  let teacherService: StubTeacherService;
  let programmeService: StubProgrammeService;
  let classroomService: StubClassroomService;

  async function reachStepTwo(programmes: Programme[] = [programme()]): Promise<void> {
    teacherService = new StubTeacherService();
    programmeService = new StubProgrammeService(programmes);
    classroomService = new StubClassroomService();

    await TestBed.configureTestingModule({
      imports: [SetupWizard],
      providers: [
        {
          provide: InstitutionService,
          useValue: new StubInstitutionService([
            institution({ docId: 'inst-1', institutionName: 'Oak Public School' })
          ])
        },
        { provide: TeacherService, useValue: teacherService },
        { provide: ProgrammeService, useValue: programmeService },
        { provide: ClassroomService, useValue: classroomService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SetupWizard);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await component.load();
    await fixture.whenStable();

    component.setPincode('577452');
    component.setBoard('CBSE');
    component.setSchool('inst-1');
    component.next();
    fixture.detectChanges();
  }

  const row = (phone: string, first = 'Anita') => ({
    phone,
    email: '',
    firstName: first,
    lastName: 'Rao',
    role: 'School Teacher',
    classrooms: [{ grade: '4', section: 'A', programmeId: 'prog-1' }],
    existingId: ''
  });

  /** The dial code follows step 1's country, and is stored apart from the digits. */
  it('stores the dial code and the subscriber digits separately', async () => {
    await reachStepTwo();

    await component.addTeachers([row('9876543210')]);
    const draft = teacherService.calls[0][0];

    expect(draft.teacherMeta.countryCode).toBe('+91');
    expect(draft.teacherMeta.phoneNumber).toBe('9876543210');
    // Production carries the same digits under both names.
    expect(draft.teacherMeta.phone).toBe('9876543210');
  });

  it('keeps what came back, so the count survives more than one Submit', async () => {
    await reachStepTwo();

    await component.addTeachers([row('9876543210')]);
    await component.addTeachers([row('9123456780', 'Bhavana')]);

    expect(component.teachers().length).toBe(2);
    // Keyed by phone now, not by a generated id.
    expect(component.teachers().map(teacher => teacher.docId))
      .toEqual(['9876543210', '9123456780']);
  });

  it('trims the names it was given', async () => {
    await reachStepTwo();

    await component.addTeachers([{ ...row('9876543210'), firstName: '  Anita  ' }]);

    expect(teacherService.calls[0][0].teacherMeta.firstName).toBe('Anita');
  });

  /**
   * THE BUG THIS CATCHES: dropping the teachers that DID land.
   *
   * createMany writes sequentially and attaches what it managed to `created`.
   * Resetting the count to zero on failure would invite a re-submit that
   * duplicates every teacher already written.
   */
  it('keeps the teachers that landed when a later one fails', async () => {
    await reachStepTwo();
    const partial = Object.assign(new Error('permission-denied'), {
      // teacherMeta is required: the lookup pool reads identity out of it, so a
      // fixture without one throws when the step re-renders.
      created: [{
        docId: 't99',
        teacherMeta: { countryCode: '+91', phoneNumber: 't99', firstName: 'X', lastName: 'Y', email: '' },
        classrooms: {}
      } as unknown as Teacher]
    });
    teacherService.createError = partial;

    await component.addTeachers([row('9876543210'), row('9123456780')]);
    fixture.detectChanges();

    expect(component.teachers().map(teacher => teacher.docId)).toEqual(['t99']);
    expect(component.teacherError()).toBe('Could not register those teachers.');
  });

  it('shows the failure on the step rather than swallowing it', async () => {
    await reachStepTwo();
    teacherService.createError = Object.assign(new Error('permission-denied'), {});

    await component.addTeachers([row('9876543210')]);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.load-error')?.textContent)
      .toContain('Could not register those teachers.');
  });

  it('clears a previous error on the next attempt', async () => {
    await reachStepTwo();
    teacherService.createError = Object.assign(new Error('permission-denied'), {});
    await component.addTeachers([row('9876543210')]);

    teacherService.createError = null;
    await component.addTeachers([row('9876543210')]);

    expect(component.teacherError()).toBe('');
  });

  it('ignores a second submit while the first is still in flight', async () => {
    await reachStepTwo();

    const first = component.addTeachers([row('9876543210')]);
    const second = component.addTeachers([row('9123456780')]);
    await Promise.all([first, second]);

    expect(teacherService.calls.length).toBe(1);
  });

  /* ---- The classroom entries ---------------------------------------------- */

  /**
   * THE FORM COLLECTS GRADE, SECTION AND PROGRAMME, matching production's own Add
   * Teachers step. The classroom is RESOLVED from grade + section within the
   * chosen school rather than being picked.
   */
  it('matches an existing classroom by grade and section, and keys on its id', async () => {
    await reachStepTwo();

    await component.addTeachers([row('9876543210')]);
    const entries = teacherService.calls[0][0].classrooms;

    // classroomFixture() is 4 A at inst-1, which is what row() asks for.
    expect(Object.keys(entries)).toEqual(['c1']);
    expect(entries['c1'].classroomId).toBe('c1');
    expect(entries['c1'].classroomName).toBe('4 A');
  });

  /**
   * NOTHING IS CREATED. Writing a classroom as a side effect of registering a
   * teacher would have this step quietly populating a collection the form never
   * mentions — and the wizard runs right after a school is created, when it
   * legitimately has none.
   */
  /**
   * STRICT: NO TEACHER IS WRITTEN WITHOUT A CLASSROOM.
   *
   * This used to record the teacher anyway, keyed by a generated id and carrying
   * an empty classroomId. Those entries are unusable — nothing can follow them,
   * and they cannot be told apart from a real class whose data went missing — so
   * the submit fails visibly and the admin can retry.
   */
  it('registers nobody when the classroom cannot be created', async () => {
    await reachStepTwo();
    classroomService.createError = new Error('permission-denied');

    await component.addTeachers([{
      ...row('9876543210'),
      classrooms: [{ grade: '9', section: 'Z', programmeId: 'prog-1' }]
    }]);

    expect(teacherService.calls.length).toBe(0);
    expect(component.teacherError()).toBe('Could not register those teachers.');
  });

  /** The school comes from step 1, never from the form. */
  it('stamps the chosen school on every entry', async () => {
    await reachStepTwo();

    await component.addTeachers([row('9876543210')]);

    expect(teacherService.calls[0][0].classrooms['c1'].institutionId).toBe('inst-1');
  });

  /** Per classroom, following production, not hoisted onto the teacher. */
  it('stores the role on the classroom entry', async () => {
    await reachStepTwo();

    await component.addTeachers([row('9876543210')]);

    expect(teacherService.calls[0][0].classrooms['c1'].userRole).toBe('School Teacher');
  });

  /** The form holds ids only, so the programme is resolved into production's shape. */
  it('resolves the chosen programme into a full programme entry', async () => {
    await reachStepTwo([programme({ docId: 'prog-1', programmeId: 'prog-1', displayName: 'Science' })]);

    await component.addTeachers([row('9876543210')]);

    expect(teacherService.calls[0][0].classrooms['c1'].programmes).toEqual([{
      programmeId: 'prog-1',
      programmeName: 'Oak 26-27 Grade 1 - Science',
      displayName: 'Science',
      programmeCode: 'P10001',
      sequentiallyLocked: false
    }]);
  });

  /**
   * TWO ROWS FOR ONE CLASS ARE ONE CLASSROOM WITH TWO PROGRAMMES. Keying on the
   * class means the second row would otherwise overwrite the first.
   */
  it('merges rows that name the same class, accumulating their programmes', async () => {
    await reachStepTwo([
      programme({ docId: 'prog-1', programmeId: 'prog-1', displayName: 'Science' }),
      programme({ docId: 'prog-2', programmeId: 'prog-2', displayName: 'Maths' })
    ]);

    await component.addTeachers([{
      ...row('9876543210'),
      classrooms: [
        { grade: '4', section: 'A', programmeId: 'prog-1' },
        { grade: '4', section: 'A', programmeId: 'prog-2' }
      ]
    }]);

    const entries = teacherService.calls[0][0].classrooms;

    expect(Object.keys(entries)).toEqual(['c1']);
    expect(entries['c1'].programmes.map(p => p.programmeId)).toEqual(['prog-1', 'prog-2']);
  });

  it('does not duplicate a programme picked twice for the same class', async () => {
    await reachStepTwo();

    await component.addTeachers([{
      ...row('9876543210'),
      classrooms: [
        { grade: '4', section: 'A', programmeId: 'prog-1' },
        { grade: '4', section: 'A', programmeId: 'prog-1' }
      ]
    }]);

    expect(teacherService.calls[0][0].classrooms['c1'].programmes.length).toBe(1);
  });

  /** Two different classes stay two entries. */
  it('keeps separate classes separate', async () => {
    await reachStepTwo();

    await component.addTeachers([{
      ...row('9876543210'),
      classrooms: [
        { grade: '4', section: 'A', programmeId: 'prog-1' },
        { grade: '5', section: 'B', programmeId: 'prog-1' }
      ]
    }]);

    // Two real classrooms: c1 matched, and 5 B was created.
    expect(Object.keys(teacherService.calls[0][0].classrooms).length).toBe(2);
  });

  /**
   * A CLASS WITH NO CLASSROOM GETS ONE, so the entry carries a real reference
   * instead of an empty classroomId that nothing can follow. The wizard runs
   * right after a school is created, so this is the common case rather than the
   * edge one.
   */
  it('creates the classroom when none matches, and keys on its id', async () => {
    await reachStepTwo();

    await component.addTeachers([{
      ...row('9876543210'),
      classrooms: [{ grade: '9', section: 'Z', programmeId: 'prog-1' }]
    }]);

    expect(classroomService.created.length).toBe(1);

    const entries = teacherService.calls[0][0].classrooms;

    expect(Object.keys(entries)).toEqual(['made-1']);
    expect(entries['made-1'].classroomId).toBe('made-1');
    expect(entries['made-1'].classroomName).toBe('9 Z');
  });

  /** Otherwise the teacher teaches a programme their own classroom does not run. */
  it('attaches the chosen programme to the classroom it creates', async () => {
    await reachStepTwo();

    await component.addTeachers([{
      ...row('9876543210'),
      classrooms: [{ grade: '9', section: 'Z', programmeId: 'prog-1' }]
    }]);

    expect(Object.keys(classroomService.created[0]['programmes'] as object)).toEqual(['prog-1']);
  });

  /**
   * SEVERAL PROGRAMMES IN ONE CLASS is the case that was broken. Resolving row by
   * row created the classroom on the first row with only that programme attached,
   * so the second landed on the teacher while the classroom did not run it.
   */
  it('creates the classroom running every programme the teacher takes in it', async () => {
    await reachStepTwo([
      programme({ docId: 'prog-1', programmeId: 'prog-1', displayName: 'Science' }),
      programme({ docId: 'prog-2', programmeId: 'prog-2', displayName: 'Maths' })
    ]);

    await component.addTeachers([{
      ...row('9876543210'),
      classrooms: [
        { grade: '9', section: 'Z', programmeId: 'prog-1' },
        { grade: '9', section: 'Z', programmeId: 'prog-2' }
      ]
    }]);

    // ONE classroom, running BOTH.
    expect(classroomService.created.length).toBe(1);
    expect(Object.keys(classroomService.created[0]['programmes'] as object).sort())
      .toEqual(['prog-1', 'prog-2']);

    // And the teacher carries both on the one entry.
    const entries = teacherService.calls[0][0].classrooms;

    expect(Object.keys(entries)).toEqual(['made-1']);
    expect(entries['made-1'].programmes.map(p => p.programmeId).sort())
      .toEqual(['prog-1', 'prog-2']);
  });

  /** Different classes stay different classrooms, each with its own programme. */
  it('creates one classroom per class', async () => {
    await reachStepTwo();

    await component.addTeachers([{
      ...row('9876543210'),
      classrooms: [
        { grade: '9', section: 'Y', programmeId: 'prog-1' },
        { grade: '9', section: 'Z', programmeId: 'prog-1' }
      ]
    }]);

    expect(classroomService.created.length).toBe(2);
    expect(Object.keys(teacherService.calls[0][0].classrooms).sort())
      .toEqual(['made-1', 'made-2']);
  });

  /** Two rows for one class must reuse the first create, not race a second. */
  it('creates one classroom for two rows naming the same class', async () => {
    await reachStepTwo();

    await component.addTeachers([{
      ...row('9876543210'),
      classrooms: [
        { grade: '9', section: 'Z', programmeId: 'prog-1' },
        { grade: '9', section: 'Z', programmeId: 'prog-1' }
      ]
    }]);

    expect(classroomService.created.length).toBe(1);
    expect(Object.keys(teacherService.calls[0][0].classrooms)).toEqual(['made-1']);
  });

  it('reuses a matching classroom rather than creating another', async () => {
    await reachStepTwo();

    await component.addTeachers([row('9876543210')]);

    expect(classroomService.created.length).toBe(0);
  });

  /* ---- Which programmes are assignable ------------------------------------ */

  it('offers only the chosen institution\'s live REGULAR programmes', async () => {
    await reachStepTwo([
      programme({ docId: 'p-ok', displayName: 'Keep me' }),
      programme({ docId: 'p-other-school', institutionId: 'inst-2', displayName: 'Other school' }),
      programme({ docId: 'p-club', type: 'STEM-CLUB', displayName: 'Club' }),
      programme({ docId: 'p-draft', programmeStatus: 'DEVELOPEMENT', displayName: 'Draft' })
    ]);

    expect(component.assignableProgrammes().map(option => option.id)).toEqual(['p-ok']);
  });

  it('falls back to programmeName when a programme has no displayName', async () => {
    await reachStepTwo([
      programme({ docId: 'p1', displayName: '', programmeName: 'Fallback Name' })
    ]);

    expect(component.assignableProgrammes()[0].name).toBe('Fallback Name');
  });

  /**
   * THE BUG THIS CATCHES: a failing catalogue taking the whole page down.
   *
   * The institutions are step 1 and the page is unusable without them; the
   * catalogue is step 2's and can fail without blocking the institution choice.
   */
  it('still loads the page when the programme catalogue fails', async () => {
    teacherService = new StubTeacherService();

    await TestBed.configureTestingModule({
      imports: [SetupWizard],
      providers: [
        {
          provide: InstitutionService,
          useValue: new StubInstitutionService([institution({ docId: 'inst-1' })])
        },
        { provide: TeacherService, useValue: teacherService },
        {
          provide: ProgrammeService,
          useValue: {
            list: async () => { throw new Error('permission-denied'); },
            describeError: (_e: unknown, fallback: string) => fallback
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SetupWizard);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await component.load();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.loadError()).toBe('');
    expect(component.loading()).toBe(false);
    expect(component.assignableProgrammes()).toEqual([]);
  });

  /* ---- Recognised numbers append, they do not duplicate ------------------- */

  /**
   * THE POINT OF THE LOOKUP. Without this the wizard writes a SECOND teacher
   * document carrying the same phone number, and the admin ends up with two rows
   * for one person.
   */
  it('appends to the existing teacher rather than creating a second one', async () => {
    await reachStepTwo();
    const existing = {
      docId: 'existing-1',
      teacherMeta: { phoneNumber: '9876543210', countryCode: '+91', firstName: 'Anita', lastName: 'Rao', email: '' },
      classrooms: {}
    } as unknown as Teacher;
    component.registered.set([existing]);

    await component.addTeachers([{
      ...row('9876543210'),
      existingId: 'existing-1'
    }]);

    expect(teacherService.calls.length).toBe(0);
    expect(teacherService.appended.length).toBe(1);
    expect(teacherService.appended[0].docId).toBe('existing-1');
  });

  it('still creates when the number was not recognised', async () => {
    await reachStepTwo();

    await component.addTeachers([row('9000000000')]);

    expect(teacherService.calls.length).toBe(1);
    expect(teacherService.appended.length).toBe(0);
  });

  /** A stale id — the teacher was deleted in another tab — must not append blind. */
  it('creates when the existing id no longer resolves', async () => {
    await reachStepTwo();
    component.registered.set([]);

    await component.addTeachers([{ ...row('9876543210'), existingId: 'gone' }]);

    expect(teacherService.calls.length).toBe(1);
    expect(teacherService.appended.length).toBe(0);
  });

  /**
   * The lookup pool has to include what this run just wrote, or typing the same
   * number twice in one sitting would fail to recognise it the second time.
   */
  it('adds a newly created teacher to the lookup pool', async () => {
    await reachStepTwo();

    await component.addTeachers([row('9876543210')]);

    // The phone IS the id now, so this is what the lookup will match on.
    expect(component.registered().map(teacher => teacher.docId)).toContain('9876543210');
  });

  /** Replaced, not appended, or the lookup could match a stale copy. */
  it('replaces rather than duplicates a teacher it appended to', async () => {
    await reachStepTwo();
    const existing = {
      docId: 'existing-1',
      teacherMeta: { phoneNumber: '9876543210' },
      classrooms: {}
    } as unknown as Teacher;
    component.registered.set([existing]);

    await component.addTeachers([{ ...row('9876543210'), existingId: 'existing-1' }]);

    expect(component.registered().filter(t => t.docId === 'existing-1').length).toBe(1);
    expect(Object.keys(component.registered()[0].classrooms).length).toBe(1);
  });

  /** A failing teacher list must not take the page down; the lookup just finds nobody. */
  it('still loads the page when the teacher list fails', async () => {
    teacherService = new StubTeacherService();
    teacherService.list = async () => { throw new Error('permission-denied'); };

    await TestBed.configureTestingModule({
      imports: [SetupWizard],
      providers: [
        {
          provide: InstitutionService,
          useValue: new StubInstitutionService([institution({ docId: 'inst-1' })])
        },
        { provide: TeacherService, useValue: teacherService },
        { provide: ProgrammeService, useValue: new StubProgrammeService() },
        { provide: ClassroomService, useValue: new StubClassroomService() }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SetupWizard);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await component.load();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.loadError()).toBe('');
    expect(component.registered()).toEqual([]);
  });

});
describe('Set Up Wizard — bulk upload mode', () => {

  let fixture: ComponentFixture<SetupWizard>;
  let component: SetupWizard;

  async function render(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [SetupWizard],
      providers: [
        {
          provide: InstitutionService,
          useValue: new StubInstitutionService([institution({ docId: 'inst-1' })])
        },
        { provide: TeacherService, useValue: new StubTeacherService() },
        { provide: ProgrammeService, useValue: new StubProgrammeService() },
        { provide: ClassroomService, useValue: new StubClassroomService() }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SetupWizard);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await component.load();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /** The two modes are alternatives, so one set of controls replaces the other. */
  it('swaps the pincode and school controls for the bulk panel', async () => {
    await render();
    expect(el().querySelector('#sw-pincode')).not.toBeNull();
    expect(el().querySelector('app-bulk-upload-schools')).toBeNull();

    component.toggleBulkUpload();
    fixture.detectChanges();

    expect(el().querySelector('#sw-pincode')).toBeNull();
    expect(el().querySelector('#sw-school')).toBeNull();
    expect(el().querySelector('app-bulk-upload-schools')).not.toBeNull();
  });

  /** Country and Board apply to every school in the file, so both stay. */
  it('keeps Country and Board in bulk mode', async () => {
    await render();
    component.toggleBulkUpload();
    fixture.detectChanges();

    expect(el().querySelector('#sw-country')).not.toBeNull();
    expect(el().querySelector('#sw-board')).not.toBeNull();
  });

  /**
   * THE BUG THIS CATCHES: Board locked for ever in bulk mode.
   *
   * The unlock chain ran country → pincode → board, and bulk mode does not render
   * a pincode — so nothing could fill it and every control after it stayed shut.
   */
  it('unlocks Board straight after Country when there is no pincode', async () => {
    await render();
    component.toggleBulkUpload();
    fixture.detectChanges();

    expect(component.locked('board')).toBe(false);
    expect(el().querySelector<HTMLSelectElement>('#sw-board')?.disabled).toBe(false);
  });

  it('locks Board again when bulk mode is switched off with no pincode', async () => {
    await render();
    component.toggleBulkUpload();
    expect(component.locked('board')).toBe(false);

    component.toggleBulkUpload();

    expect(component.locked('board')).toBe(true);
  });

  /** Bulk mode has its own Upload flow; there is nothing for Continue to do. */
  it('keeps Continue dead in bulk mode', async () => {
    await render();
    component.setPincode('577452');
    component.setBoard('CBSE');
    component.setSchool('inst-1');
    expect(component.canPressContinue()).toBe(true);

    component.toggleBulkUpload();

    expect(component.canPressContinue()).toBe(false);
  });
});

describe('registeredMessage', () => {

  /**
   * NAMES THE TEACHER. This step runs several times in a row, and a confirmation
   * that reads identically every time cannot be told from the previous one still
   * on screen.
   */
  it('names a single teacher', () => {
    expect(registeredMessage([{ teacherMeta: { firstName: 'Santosh', lastName: 'Kanta' } }]))
      .toBe('Santosh Kanta registered successfully');
  });

  it('falls back to the plain sentence when there is no name', () => {
    expect(registeredMessage([{ teacherMeta: { firstName: '', lastName: '' } }]))
      .toBe('Teacher registered successfully');
    expect(registeredMessage([{}])).toBe('Teacher registered successfully');
  });

  it('trims a name padded with spaces', () => {
    expect(registeredMessage([{ teacherMeta: { firstName: '  Anita', lastName: 'Rao  ' } }]))
      .toBe('Anita Rao registered successfully');
  });

  it('counts when more than one came back at once', () => {
    expect(registeredMessage([
      { teacherMeta: { firstName: 'A', lastName: '' } },
      { teacherMeta: { firstName: 'B', lastName: '' } }
    ]))
      .toBe('2 teachers registered successfully');
  });
});

describe('Set Up Wizard — the success toast', () => {

  let fixture: ComponentFixture<SetupWizard>;
  let component: SetupWizard;
  let teacherService: StubTeacherService;

  async function reachStepTwo(): Promise<void> {
    teacherService = new StubTeacherService();

    await TestBed.configureTestingModule({
      imports: [SetupWizard],
      providers: [
        {
          provide: InstitutionService,
          useValue: new StubInstitutionService([institution({ docId: 'inst-1' })])
        },
        { provide: TeacherService, useValue: teacherService },
        { provide: ProgrammeService, useValue: new StubProgrammeService() },
        { provide: ClassroomService, useValue: new StubClassroomService() }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SetupWizard);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await component.load();
    await fixture.whenStable();

    component.setPincode('577452');
    component.setBoard('CBSE');
    component.setSchool('inst-1');
    component.next();
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  const row = () => ({
    phone: '9876543210',
    email: '',
    firstName: 'Santosh',
    lastName: 'Kanta',
    role: 'School Teacher',
    classrooms: [{ grade: '4', section: 'A', programmeId: 'prog-1' }],
    existingId: ''
  });

  it('shows nothing until something has been registered', async () => {
    await reachStepTwo();

    expect(el().querySelector('.toast')).toBeNull();
  });

  it('confirms a registration by name', async () => {
    await reachStepTwo();

    await component.addTeachers([row()]);
    fixture.detectChanges();

    const toast = el().querySelector('.toast');
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toContain('Santosh Kanta registered successfully');
  });

  /** Confirmation, not an interruption: an assertive region would cut across. */
  it('announces itself politely', async () => {
    await reachStepTwo();
    await component.addTeachers([row()]);
    fixture.detectChanges();

    expect(el().querySelector('.toast')?.getAttribute('role')).toBe('status');
  });

  it('can be dismissed', async () => {
    await reachStepTwo();
    await component.addTeachers([row()]);
    fixture.detectChanges();

    component.dismissNotice();
    fixture.detectChanges();

    expect(component.notice()).toBe('');
    expect(el().querySelector('.toast')).toBeNull();
  });

  /** A failed write must not claim success. */
  it('says nothing when the registration failed', async () => {
    await reachStepTwo();
    teacherService.createError = Object.assign(new Error('permission-denied'), {});

    await component.addTeachers([row()]);
    fixture.detectChanges();

    expect(component.notice()).toBe('');
    expect(el().querySelector('.toast')).toBeNull();
    expect(el().querySelector('.load-error')).not.toBeNull();
  });

  /**
   * The second message must not be hidden early by the first one's timeout, so
   * the timer is reset rather than left running.
   */
  it('replaces the message when a second teacher is registered', async () => {
    await reachStepTwo();
    await component.addTeachers([row()]);

    await component.addTeachers([{ ...row(), firstName: 'Bhavana' }]);
    fixture.detectChanges();

    expect(component.notice()).toBe('Bhavana Kanta registered successfully');
  });

  /** A timer firing into a destroyed component is how this becomes a leak. */
  it('clears its timer on destroy', async () => {
    await reachStepTwo();
    await component.addTeachers([row()]);
    expect(component.notice()).not.toBe('');

    component.ngOnDestroy();

    expect(() => component.ngOnDestroy()).not.toThrow();
  });
});

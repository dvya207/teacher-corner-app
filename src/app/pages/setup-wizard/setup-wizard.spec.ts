import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Timestamp } from 'firebase/firestore';

import {
  Institution,
  InstitutionDraft,
  Programme,
  Teacher,
  TeacherDraft
} from '../../models/teaching.model';
import { InstitutionService } from '../../services/institution.service';
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

class StubProgrammeService {
  constructor(public programmes: Programme[] = [programme()]) {}
  list = async (): Promise<Programme[]> => this.programmes;
  describeError = (_error: unknown, fallback: string): string => fallback;
}

class StubTeacherService {
  createError: (Error & { created?: Teacher[] }) | null = null;
  calls: TeacherDraft[][] = [];
  appended: { docId: string; classes: readonly unknown[] }[] = [];
  existing: Teacher[] = [];
  private next = 0;

  list = async (): Promise<Teacher[]> => this.existing;

  appendClasses = async (teacher: Teacher, additions: readonly unknown[]): Promise<Teacher> => {
    this.appended.push({ docId: teacher.docId, classes: additions });
    return { ...teacher, classes: [...teacher.classes, ...additions] as Teacher['classes'] };
  };

  createMany = async (drafts: TeacherDraft[]): Promise<Teacher[]> => {
    this.calls.push(drafts);

    if (this.createError) {
      throw this.createError;
    }

    return drafts.map(draft => ({
      ...draft,
      docId: `t${++this.next}`,
      ownerId: 'teacher-1',
      teacherName: `${draft.firstName} ${draft.lastName}`.trim()
    } as Teacher));
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
        { provide: ProgrammeService, useValue: new StubProgrammeService() }
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
        { provide: ProgrammeService, useValue: new StubProgrammeService() }
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
        { provide: ProgrammeService, useValue: new StubProgrammeService() }
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

  async function reachStepTwo(programmes: Programme[] = [programme()]): Promise<void> {
    teacherService = new StubTeacherService();
    programmeService = new StubProgrammeService(programmes);

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
        { provide: ProgrammeService, useValue: programmeService }
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
    classes: [{ grade: '1', section: 'A', programmeId: 'prog-1' }],
    existingId: ''
  });

  /**
   * institutionId comes from the WIZARD, not the form — the form never asks
   * which school, and a form-supplied one would be a value the user could point
   * anywhere.
   */
  it('registers each row against the institution chosen in step 1', async () => {
    await reachStepTwo();

    await component.addTeachers([row('9876543210')]);

    expect(teacherService.calls.length).toBe(1);
    expect(teacherService.calls[0][0].institutionId).toBe('inst-1');
  });

  /** The dial code follows step 1's country, and is stored apart from the digits. */
  it('stores the dial code and the subscriber digits separately', async () => {
    await reachStepTwo();

    await component.addTeachers([row('9876543210')]);
    const draft = teacherService.calls[0][0];

    expect(draft.countryCode).toBe('+91');
    expect(draft.phoneNumber).toBe('9876543210');
  });

  it('keeps what came back, so the count survives more than one Submit', async () => {
    await reachStepTwo();

    await component.addTeachers([row('9876543210')]);
    await component.addTeachers([row('9123456780', 'Bhavana')]);

    expect(component.teachers().length).toBe(2);
    expect(component.teachers().map(teacher => teacher.docId)).toEqual(['t1', 't2']);
  });

  it('trims the names it was given', async () => {
    await reachStepTwo();

    await component.addTeachers([{ ...row('9876543210'), firstName: '  Anita  ' }]);

    expect(teacherService.calls[0][0].firstName).toBe('Anita');
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
      created: [{ docId: 't99' } as Teacher]
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

  /* ---- The class fields --------------------------------------------------- */

  it('carries grade, section and programme onto the teacher', async () => {
    await reachStepTwo();

    await component.addTeachers([row('9876543210')]);
    const draft = teacherService.calls[0][0];

    expect(draft.classes).toEqual([{
      grade: '1',
      section: 'A',
      programmeId: 'prog-1',
      programmeName: 'Oak 26-27 Grade 1 - Science'
    }]);
  });

  /** A teacher takes several classes, and every one must reach the document. */
  it('carries every class a teacher takes', async () => {
    await reachStepTwo([
      programme({ docId: 'prog-1', displayName: 'Science' }),
      programme({ docId: 'prog-2', displayName: 'Maths' })
    ]);

    await component.addTeachers([{
      ...row('9876543210'),
      classes: [
        { grade: '1', section: 'A', programmeId: 'prog-1' },
        { grade: '2', section: 'B', programmeId: 'prog-2' }
      ]
    }]);

    expect(teacherService.calls[0][0].classes).toEqual([
      { grade: '1', section: 'A', programmeId: 'prog-1', programmeName: 'Science' },
      { grade: '2', section: 'B', programmeId: 'prog-2', programmeName: 'Maths' }
    ]);
  });

  /**
   * The form only ever holds the programme ID, so the name is resolved here.
   * Denormalised as a SNAPSHOT: a programme later renamed does not rewrite it.
   */
  it('resolves the programme name from the id the form supplied', async () => {
    await reachStepTwo();

    await component.addTeachers([row('9876543210')]);

    expect(teacherService.calls[0][0].classes[0].programmeName)
      .toBe('Oak 26-27 Grade 1 - Science');
  });

  it('stores an empty name rather than undefined for an unknown programme', async () => {
    await reachStepTwo();

    await component.addTeachers([{
      ...row('9876543210'),
      classes: [{ grade: '1', section: 'A', programmeId: 'gone' }]
    }]);

    expect(teacherService.calls[0][0].classes[0].programmeName).toBe('');
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
      phoneNumber: '9876543210',
      classes: [{ grade: '1', section: 'A', programmeId: 'prog-1', programmeName: 'Science' }]
    } as Teacher;
    component.registered.set([existing]);

    await component.addTeachers([{
      ...row('9876543210'),
      existingId: 'existing-1',
      classes: [{ grade: '2', section: 'B', programmeId: 'prog-1' }]
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

    expect(component.registered().map(teacher => teacher.docId)).toContain('t1');
  });

  /** Replaced, not appended, or the lookup could match a stale copy. */
  it('replaces rather than duplicates a teacher it appended to', async () => {
    await reachStepTwo();
    const existing = { docId: 'existing-1', phoneNumber: '9876543210', classes: [] } as unknown as Teacher;
    component.registered.set([existing]);

    await component.addTeachers([{ ...row('9876543210'), existingId: 'existing-1' }]);

    expect(component.registered().filter(t => t.docId === 'existing-1').length).toBe(1);
    expect(component.registered()[0].classes.length).toBe(1);
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
        { provide: ProgrammeService, useValue: new StubProgrammeService() }
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
        { provide: ProgrammeService, useValue: new StubProgrammeService() }
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
    expect(registeredMessage([{ teacherName: 'Santosh Kanta' }]))
      .toBe('Santosh Kanta registered successfully');
  });

  it('falls back to the plain sentence when there is no name', () => {
    expect(registeredMessage([{ teacherName: '' }])).toBe('Teacher registered successfully');
    expect(registeredMessage([{}])).toBe('Teacher registered successfully');
  });

  it('trims a name padded with spaces', () => {
    expect(registeredMessage([{ teacherName: '  Anita Rao  ' }]))
      .toBe('Anita Rao registered successfully');
  });

  it('counts when more than one came back at once', () => {
    expect(registeredMessage([{ teacherName: 'A' }, { teacherName: 'B' }]))
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
        { provide: ProgrammeService, useValue: new StubProgrammeService() }
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
    classes: [{ grade: '1', section: 'A', programmeId: 'prog-1' }],
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

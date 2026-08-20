import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Classroom, Institution, Programme } from '../../models/teaching.model';
import { AuthService } from '../../services/auth.service';
import { InstitutionService } from '../../services/institution.service';
import { ProfileService } from '../../services/profile.service';
import { ProgrammeService } from '../../services/programme.service';
import { ClassroomService } from '../../services/classroom.service';
import { Register } from './register';

/**
 * Create Account.
 *
 * THE LOAD-BEARING ASSERTION here is that the PINCODE ALONE surfaces schools. The
 * board narrows the list and must not be required to see it: a teacher looking for
 * their college does not necessarily know which board it is filed under, and
 * requiring it first hides the very row that would have told them.
 */

/** Only the fields the component reads. */
function institution(
  docId: string,
  institutionName: string,
  pincode: string,
  board: string,
  country = 'India'
): Institution {
  return {
    docId,
    institutionName,
    board,
    institutionAddress: { country, pincode }
  } as unknown as Institution;
}

const OAK = institution('inst-1', 'Oak Public School', '560001', 'CBSE');
const BIRCH = institution('inst-2', 'Birch High', '560001', 'ICSE');
const ASH = institution('inst-3', 'Ash Academy', '560002', 'CBSE');
/** Same pincode, different country: must not be offered. */
const ELM = institution('inst-4', 'Elm International', '560001', 'CBSE', 'Nepal');

class StubInstitutionService {
  institutions: Institution[];
  listCalls = 0;

  constructor(institutions: Institution[] = [OAK, BIRCH, ASH, ELM]) {
    this.institutions = institutions;
  }

  async list(): Promise<Institution[]> {
    this.listCalls += 1;
    return this.institutions;
  }

  describeError(_error: unknown, fallback: string): string {
    return fallback;
  }
}

/**
 * PROGRAMMES CARRY institutionId, because the register page now scopes them to the
 * schools the pincode found. A stub without one belongs to no school and the list
 * reads empty — which is what made the old stub pass every test while covering
 * nothing.
 */
function stubProgramme(
  docId: string,
  programmeName: string,
  institutionId: string,
  displayName = ''
): Programme {
  // programmeId as well as docId: toProgrammeMap keys the classroom's programmes
  // map on programmeId, so a stub without one keys everything under 'undefined'.
  return {
    docId,
    programmeId: docId,
    programmeName,
    displayName,
    programmeCode: 'P1',
    institutionId
  } as unknown as Programme;
}

/**
 * The classrooms the form reads only to resolve a classroomId for the request.
 * An empty list is a legitimate state: the request then carries none.
 */
class StubClassroomService {
  created: unknown[] = [];
  createError: unknown = null;

  constructor(public classrooms: Classroom[] = []) {}

  async list(): Promise<Classroom[]> { return this.classrooms; }

  async create(draft: Record<string, unknown>): Promise<Classroom> {
    if (this.createError) {
      throw this.createError;
    }

    this.created.push(draft);

    // The real service COMPOSES the name from grade and section rather than
    // storing what it was handed, so the stub has to as well or callers see ''.
    return {
      ...draft,
      docId: 'new-c1',
      classroomId: 'new-c1',
      classroomName: `${draft['grade']} ${draft['section']}`.trim()
    } as unknown as Classroom;
  }

  describeError(_error: unknown, fallback: string): string { return fallback; }
}

class StubProgrammeService {
  constructor(
    public programmes: Programme[] = [
      // OAK and BIRCH sit at 560001; ASH is at 560002.
      stubProgramme('prog-1', 'STEM Foundation', 'inst-1'),
      stubProgramme('prog-2', 'Robotics', 'inst-2'),
      stubProgramme('prog-3', 'Faraway Science', 'inst-3', 'Faraway Science Lab')
    ]
  ) {}

  async list(): Promise<Programme[]> {
    return this.programmes;
  }
}

class StubProfileService {
  saved: unknown[] = [];
  async save(profile: unknown): Promise<void> {
    this.saved.push(profile);
  }
  describeError(_error: unknown, fallback: string): string {
    return fallback;
  }
}

class StubAuthService {
  currentUser = { phoneNumber: '+916362398700' };
  logoutCalls = 0;

  async logout(): Promise<void> {
    this.logoutCalls += 1;
  }
}

describe('Register', () => {
  let fixture: ComponentFixture<Register>;
  let component: Register;
  let institutions: StubInstitutionService;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    institutions = new StubInstitutionService();

    await TestBed.configureTestingModule({
      imports: [Register],
      providers: [
        provideRouter([]),
        { provide: InstitutionService, useValue: institutions },
        { provide: ProgrammeService, useValue: new StubProgrammeService() },
        { provide: ClassroomService, useValue: new StubClassroomService() },
        { provide: ProfileService, useValue: new StubProfileService() },
        { provide: AuthService, useValue: new StubAuthService() }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(Register);
    component = fixture.componentInstance;
    fixture.detectChanges();
    // The constructor load is async.
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const names = () => component.schools().map(school => school.name);

  /* ---- The pincode drives the lookup ------------------------------------- */

  it('offers nothing until the pincode is complete', () => {
    expect(component.schools()).toEqual([]);

    component.onPincodeInput('5600');
    expect(component.pincodeComplete()).toBe(false);
    expect(component.schools()).toEqual([]);
  });

  /** The whole point of the change: no board needed. */
  it('surfaces every school at the pincode as soon as it is complete, with no board chosen', () => {
    component.onPincodeInput('560001');

    expect(component.pincodeComplete()).toBe(true);
    expect(component.board()).toBe('');
    expect(names()).toEqual(['Birch High', 'Oak Public School']);
  });

  it('narrows to the board once one is chosen', () => {
    component.onPincodeInput('560001');
    component.onBoardChange('CBSE');

    expect(names()).toEqual(['Oak Public School']);
  });

  it('excludes schools at other pincodes', () => {
    component.onPincodeInput('560002');
    expect(names()).toEqual(['Ash Academy']);
  });

  /** Same pincode digits in another country are a different place entirely. */
  it('excludes schools in another country', () => {
    component.onPincodeInput('560001');
    expect(names()).not.toContain('Elm International');
  });

  it('reports no matches for a complete pincode nothing is filed under', () => {
    component.onPincodeInput('999999');

    expect(component.schools()).toEqual([]);
    expect(component.noMatches()).toBe(true);
  });

  it('does not report no matches before a pincode is complete', () => {
    expect(component.noMatches()).toBe(false);
  });

  /* ---- Changing the search clears a stale selection ---------------------- */

  it('drops a chosen school when the pincode changes', () => {
    component.onPincodeInput('560001');
    component.school.set('inst-1');

    component.onPincodeInput('560002');

    // Leaving it set would submit a school the new search never offered.
    expect(component.school()).toBe('');
  });

  it('drops a chosen school when the country changes', () => {
    component.onPincodeInput('560001');
    component.school.set('inst-1');

    component.onCountryChange('Nepal');

    expect(component.school()).toBe('');
    expect(component.pincode()).toBe('');
  });

  /* ---- Search refetches -------------------------------------------------- */

  it('refetches the school list on Search, picking up one added elsewhere', async () => {
    component.onPincodeInput('560001');
    expect(names()).toEqual(['Birch High', 'Oak Public School']);

    institutions.institutions = [
      ...institutions.institutions,
      institution('inst-5', 'Cedar School', '560001', 'CBSE')
    ];

    await component.search();

    expect(names()).toEqual(['Birch High', 'Cedar School', 'Oak Public School']);
  });

  /* ---- Submit gate ------------------------------------------------------- */

  it('will not submit until every required field is filled', () => {
    expect(component.canSubmit()).toBe(false);

    component.onPincodeInput('560001');
    component.onBoardChange('CBSE');
    component.school.set('inst-1');
    component.firstName.set('Divya');
    component.lastName.set('Jain');
    component.email.set('divya@school.edu.in');
    component.grade.set('3');

    // Section still missing.
    expect(component.canSubmit()).toBe(false);

    component.section.set('A');

    // AND the programme, which is required now: a class with no programme is not
    // a teaching assignment anybody can act on, and it left programmeId empty on
    // the request and then on the promoted profile.
    expect(component.canSubmit()).toBe(false);

    component.programme.set('prog-1');
    expect(component.canSubmit()).toBe(true);
  });
});

/**
 * THE PROGRAMME LIST IS SCOPED BY THE PINCODE.
 *
 * It previously mapped every programme the account could read, so a teacher at
 * one pincode was offered programmes belonging to schools in other towns — and
 * picking one wrote a programme its own school does not run.
 */
describe('Register — the programme list', () => {
  let fixture: ComponentFixture<Register>;
  let component: Register;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Register],
      providers: [
        { provide: InstitutionService, useValue: new StubInstitutionService([OAK, BIRCH, ASH]) },
        { provide: ProgrammeService, useValue: new StubProgrammeService() },
        { provide: ClassroomService, useValue: new StubClassroomService() },
        { provide: ProfileService, useValue: new StubProfileService() },
        { provide: AuthService, useValue: new StubAuthService() }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(Register);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const programmeNames = () => component.programmes().map(item => item.name);

  it('offers nothing before the pincode is complete', () => {
    expect(component.programmes()).toEqual([]);

    component.onPincodeInput('5600');

    expect(component.programmes()).toEqual([]);
  });

  it('offers the programmes of every school the pincode matched', () => {
    component.onPincodeInput('560001');

    // OAK and BIRCH are at 560001; ASH's programme is at 560002 and must not appear.
    expect(programmeNames()).toEqual(['Robotics', 'STEM Foundation']);
  });

  /** THE BUG THIS CATCHES: being offered another town's programmes. */
  it('never offers a programme belonging to a school at another pincode', () => {
    component.onPincodeInput('560002');

    // ASH's programme only, and labelled by its displayName — the same rule the
    // setup wizard uses, so the two screens name a programme identically.
    expect(programmeNames()).toEqual(['Faraway Science Lab']);
  });

  it('narrows to one school’s programmes once a school is chosen', () => {
    component.onPincodeInput('560001');
    component.onSchoolChange('inst-1');

    expect(programmeNames()).toEqual(['STEM Foundation']);
  });

  /**
   * WITHOUT THIS the scoping is defeated by a stale signal: pick a school and its
   * programme, switch school, and the old programme is still selected — one the
   * new school does not run, which submit would happily write.
   */
  it('clears a chosen programme when the school changes', () => {
    component.onPincodeInput('560001');
    component.onSchoolChange('inst-1');
    component.programme.set('prog-1');

    component.onSchoolChange('inst-2');

    expect(component.programme()).toBe('');
  });

  it('clears both the school and the programme when the pincode changes', () => {
    component.onPincodeInput('560001');
    component.onSchoolChange('inst-1');
    component.programme.set('prog-1');

    component.onPincodeInput('560002');

    expect(component.school()).toBe('');
    expect(component.programme()).toBe('');
  });

  it('clears them when the board narrows the search too', () => {
    component.onPincodeInput('560001');
    component.onSchoolChange('inst-1');
    component.programme.set('prog-1');

    component.onBoardChange('ICSE');

    expect(component.school()).toBe('');
    expect(component.programme()).toBe('');
  });

});

/**
 * REGISTRATION WRITES A REQUEST, NOT A FINISHED PROFILE.
 *
 * The school, class and programme are held on a selfRegTeacherApproval entry with
 * approvalStatus false, and ProfileService promotes them onto the profile only
 * once an administrator flips that to true. The whole submit path had no coverage
 * before this.
 */
describe('Register — what submit writes', () => {
  let fixture: ComponentFixture<Register>;
  let component: Register;
  let profile: StubProfileService;

  async function render(classrooms: Classroom[] = []): Promise<void> {
    TestBed.resetTestingModule();
    profile = new StubProfileService();

    await TestBed.configureTestingModule({
      imports: [Register],
      providers: [
        { provide: InstitutionService, useValue: new StubInstitutionService([OAK]) },
        { provide: ProgrammeService, useValue: new StubProgrammeService() },
        { provide: ClassroomService, useValue: new StubClassroomService(classrooms) },
        { provide: ProfileService, useValue: profile },
        { provide: AuthService, useValue: new StubAuthService() }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(Register);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** OAK sits at 560001 on CBSE, and carries prog-1. */
  function fillForm(): void {
    component.onPincodeInput('560001');
    component.onBoardChange('CBSE');
    component.onSchoolChange('inst-1');
    component.firstName.set('Anita');
    component.lastName.set('Rao');
    component.email.set('anita@example.com');
    component.grade.set('9');
    component.section.set('B');
    component.programme.set('prog-1');
  }

  function classroom(fields: Partial<Classroom> = {}): Classroom {
    return {
      docId: 'c1',
      classroomId: 'c1',
      type: 'CLASSROOM',
      classroomName: '9 B',
      stemClubName: '',
      grade: '9',
      section: 'B',
      institutionId: 'inst-1',
      institutionName: 'Oak Public School',
      programmes: {},
      ownerId: 'u1',
      ...fields
    } as Classroom;
  }

  const written = () => profile.saved[0] as Record<string, unknown>;
  const request = () =>
    Object.values(written()['selfRegTeacherApproval'] as Record<string, Record<string, unknown>>)[0];

  it('files the request with approvalStatus false, never true', async () => {
    await render();
    fillForm();

    await component.submit();

    expect(profile.saved.length).toBe(1);
    expect(request()['approvalStatus']).toBe(false);
  });

  /**
   * THE POINT OF THE SPLIT. A waiting teacher's profile says who asked and what
   * for, and nothing about where they teach.
   */
  it('does not write the teaching details onto the profile yet', async () => {
    await render();
    fillForm();

    await component.submit();

    for (const field of [
      'institutionId', 'institutionName', 'grade', 'section',
      'programmeId', 'programmeName', 'currentClassInfo', 'profileComplete'
    ]) {
      expect(written()[field]).toBeUndefined();
    }
  });

  it('still records who asked', async () => {
    await render();
    fillForm();

    await component.submit();

    expect(written()['firstName']).toBe('Anita');
    expect(written()['lastName']).toBe('Rao');
    expect(written()['email']).toBe('anita@example.com');
    expect(written()['countryCode']).toBe('+91');
  });

  /** Carried on the request so an approval has something to promote. */
  it('carries the class and programme on the request', async () => {
    await render();
    fillForm();

    await component.submit();

    expect(request()['grade']).toBe('9');
    expect(request()['section']).toBe('B');
    expect(request()['programmeId']).toBe('prog-1');
    expect(request()['institutionId']).toBe('inst-1');
    expect(request()['institutionName']).toBe('Oak Public School');
  });

  /** Production keys these by classroomId, so a match is used where one exists. */
  it('keys the request by classroomId when a classroom matches', async () => {
    await render([classroom()]);
    fillForm();

    await component.submit();

    expect(Object.keys(written()['selfRegTeacherApproval'] as object)).toEqual(['c1']);
    expect(request()['classroomId']).toBe('c1');
    expect(request()['classroomName']).toBe('9 B');
  });

  /**
   * A CLASS WITH NO CLASSROOM GETS ONE. The request is keyed by the created id,
   * so it carries a reference something can follow — see the resolution suite
   * below for the create itself.
   */
  it('keys by a newly created classroom when none matches', async () => {
    await render([classroom({ docId: 'c9', classroomId: 'c9', grade: '4', section: 'A' })]);
    fillForm();

    await component.submit();

    expect(request()['classroomId']).toBe('new-c1');
    expect(request()['classroomName']).toBe('9 B');
  });

  it('will not submit an incomplete form', async () => {
    await render();
    component.onPincodeInput('560001');

    await component.submit();

    expect(profile.saved.length).toBe(0);
  });
});

/**
 * A CLASSROOM IS CREATED WHERE NONE MATCHES, so the request carries a real
 * reference. It previously carried an empty classroomId, which nothing can
 * follow.
 */
describe('Register — resolving the classroom', () => {
  let fixture: ComponentFixture<Register>;
  let component: Register;
  let profile: StubProfileService;
  let classrooms: StubClassroomService;

  async function render(existing: Classroom[] = []): Promise<void> {
    TestBed.resetTestingModule();
    profile = new StubProfileService();
    classrooms = new StubClassroomService(existing);

    await TestBed.configureTestingModule({
      imports: [Register],
      providers: [
        { provide: InstitutionService, useValue: new StubInstitutionService([OAK]) },
        { provide: ProgrammeService, useValue: new StubProgrammeService() },
        { provide: ClassroomService, useValue: classrooms },
        { provide: ProfileService, useValue: profile },
        { provide: AuthService, useValue: new StubAuthService() }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(Register);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function fillForm(): void {
    component.onPincodeInput('560001');
    component.onBoardChange('CBSE');
    component.onSchoolChange('inst-1');
    component.firstName.set('Anita');
    component.lastName.set('Rao');
    component.email.set('anita@example.com');
    component.grade.set('9');
    component.section.set('B');
    component.programme.set('prog-1');
  }

  const request = () =>
    Object.values(
      (profile.saved[0] as Record<string, unknown>)['selfRegTeacherApproval'] as
        Record<string, Record<string, unknown>>
    )[0];

  it('creates the classroom when none matches, and uses its id', async () => {
    await render();
    fillForm();

    await component.submit();

    expect(classrooms.created.length).toBe(1);
    expect(request()['classroomId']).toBe('new-c1');
  });

  it('creates it for the chosen school, grade and section', async () => {
    await render();
    fillForm();

    await component.submit();
    const draft = classrooms.created[0] as Record<string, unknown>;

    expect(draft['institutionId']).toBe('inst-1');
    expect(draft['grade']).toBe('9');
    expect(draft['section']).toBe('B');
    expect(draft['type']).toBe('CLASSROOM');
  });

  /**
   * THE POINT. A classroom created with no programmes would leave the teacher
   * recorded as teaching a programme their own class does not run.
   */
  it('attaches the chosen programme to the classroom it creates', async () => {
    await render();
    fillForm();

    await component.submit();
    const draft = classrooms.created[0] as Record<string, unknown>;

    expect(Object.keys(draft['programmes'] as object)).toEqual(['prog-1']);
  });

  it('reuses an existing classroom rather than creating a second one', async () => {
    await render([{
      docId: 'c-existing',
      classroomId: 'c-existing',
      type: 'CLASSROOM',
      classroomName: '9 B',
      stemClubName: '',
      grade: '9',
      section: 'B',
      institutionId: 'inst-1',
      programmes: {}
    } as unknown as Classroom]);
    fillForm();

    await component.submit();

    expect(classrooms.created.length).toBe(0);
    expect(request()['classroomId']).toBe('c-existing');
  });

  /**
   * STRICT: NOTHING IS FILED WITHOUT A CLASSROOM.
   *
   * This used to file the request anyway with an empty classroomId, on the
   * reasoning that a secondary write should not cost somebody their
   * registration. That produced records nobody could follow and which could not
   * be told apart from a real class whose data went missing — so it refuses, and
   * says so, which the teacher can retry.
   */
  it('refuses to file anything when the classroom cannot be created', async () => {
    await render();
    classrooms.createError = new Error('permission-denied');
    fillForm();

    await component.submit();

    expect(profile.saved.length).toBe(0);
    expect(component.errorMessage()).toBe(
      'Could not complete your registration. Please try again.'
    );
  });
});

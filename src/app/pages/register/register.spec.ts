import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Institution, Programme } from '../../models/teaching.model';
import { AuthService } from '../../services/auth.service';
import { InstitutionService } from '../../services/institution.service';
import { ProfileService } from '../../services/profile.service';
import { ProgrammeService } from '../../services/programme.service';
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
  return { docId, programmeName, displayName, institutionId } as unknown as Programme;
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

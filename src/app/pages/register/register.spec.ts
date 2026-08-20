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
  institutions: Institution[] = [OAK, BIRCH, ASH, ELM];
  listCalls = 0;

  async list(): Promise<Institution[]> {
    this.listCalls += 1;
    return this.institutions;
  }

  describeError(_error: unknown, fallback: string): string {
    return fallback;
  }
}

class StubProgrammeService {
  async list(): Promise<Programme[]> {
    return [{ docId: 'prog-1', programmeName: 'STEM Foundation' } as unknown as Programme];
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

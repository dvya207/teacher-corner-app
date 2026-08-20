import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { TeacherProfile } from '../../models/teaching.model';
import { AuthService } from '../../services/auth.service';
import { ProfileService } from '../../services/profile.service';
import { Approval } from './approval';

/**
 * Approval pending.
 *
 * THE POINT OF THIS SUITE is the live redirect. The page promises in its own copy
 * that no refresh is needed, so "does it leave when ApprovedStatus flips" is the
 * behaviour worth pinning, along with detaching the listener afterwards — an
 * onSnapshot left attached keeps a socket open and keeps firing into a navigation
 * that has already happened.
 */

class StubProfileService {
  /** Captured so a test can fire it, standing in for the Firestore snapshot. */
  approvedCallback: (() => void) | null = null;
  unsubscribeCalls = 0;
  watchCalls = 0;

  profile: Partial<TeacherProfile> = {
    firstName: 'Divya',
    lastName: 'Jain',
    currentClassInfo: {
      institutionId: 'inst-1',
      institutionName: 'KUVEMPU UNIVERSITY',
      classroomName: '1 B',
      programmeId: 'prog-1',
      programmeName: 'STEM'
    }
  };

  async load(): Promise<TeacherProfile> {
    return this.profile as TeacherProfile;
  }

  watchApproval(onApproved: () => void): () => void {
    this.watchCalls += 1;
    this.approvedCallback = onApproved;

    return () => {
      this.unsubscribeCalls += 1;
    };
  }
}

class StubAuthService {
  logoutCalls = 0;
  async logout(): Promise<void> {
    this.logoutCalls += 1;
  }
}

describe('Approval', () => {
  let fixture: ComponentFixture<Approval>;
  let profile: StubProfileService;
  let navigated: unknown[][];

  beforeEach(async () => {
    TestBed.resetTestingModule();
    profile = new StubProfileService();

    await TestBed.configureTestingModule({
      imports: [Approval],
      providers: [
        provideRouter([]),
        { provide: ProfileService, useValue: profile },
        { provide: AuthService, useValue: new StubAuthService() }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(Approval);

    navigated = [];
    vi.spyOn(TestBed.inject(Router), 'navigate').mockImplementation((...args: unknown[]) => {
      navigated.push(args);
      return Promise.resolve(true);
    });

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  /* ---- The copy names the actual request ---------------------------------- */

  it('names the classroom and institution from the profile', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('1 B');
    expect(text).toContain('KUVEMPU UNIVERSITY');
  });

  /** Production promises a WhatsApp message; this app sends none. */
  it('promises no channel it does not have', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(text).not.toContain('WhatsApp');
    expect(text).toContain('do not need to refresh');
  });

  /* ---- The live redirect -------------------------------------------------- */

  it('starts watching for approval as soon as it renders', () => {
    expect(profile.watchCalls).toBe(1);
    expect(profile.approvedCallback).not.toBeNull();
  });

  it('stays put until approval arrives', () => {
    expect(navigated).toEqual([]);
  });

  /** The behaviour the copy promises: no refresh. */
  it('leaves for the dashboard the moment ApprovedStatus flips', async () => {
    profile.approvedCallback!();
    await fixture.whenStable();

    expect(navigated).toEqual([[['/dashboard']]]);
  });

  it('detaches the listener once it has left', async () => {
    profile.approvedCallback!();
    await fixture.whenStable();

    expect(profile.unsubscribeCalls).toBe(1);
  });

  /**
   * A later write to users/{uid} delivers another snapshot while still approved, so
   * the callback can fire more than once. A second navigate to a route already active
   * is wasted work at best.
   */
  it('navigates only once even if approval fires again', async () => {
    const fire = profile.approvedCallback!;

    fire();
    await fixture.whenStable();
    fire();
    await fixture.whenStable();

    expect(navigated).toEqual([[['/dashboard']]]);
  });

  it('detaches the listener when the page is destroyed unapproved', () => {
    fixture.destroy();

    expect(profile.unsubscribeCalls).toBe(1);
  });
});

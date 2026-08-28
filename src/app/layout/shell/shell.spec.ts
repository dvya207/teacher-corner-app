import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  AllottedInstitution,
  TeacherAllotment,
  TeacherClassroom
} from '../../models/teaching.model';
import { AuthService } from '../../services/auth.service';
import { DashboardService } from '../../services/dashboard.service';
import { NotificationService } from '../../services/notification.service';
import { Shell } from './shell';

/**
 * Shell — the sidebar's contents and order.
 *
 * WHY THIS EXISTS. The shell sits behind authGuard, so it cannot be opened in a
 * browser without real credentials — the same reason dashboard.spec.ts asserts on
 * rendering rather than only on logic. The nav is also the one part of this
 * component that is a list someone edits by hand, and the two failure modes are
 * both silent: an entry added in the wrong position, or an existing entry
 * displaced by a new one. Both are pinned here.
 *
 * AuthService and NotificationService are stubbed, so this runs without Firebase.
 * The real Router is provided rather than stubbed because every nav entry uses
 * routerLink, which injects ActivatedRoute and cannot render without it.
 */

class StubAuthService {
  displayName(): string {
    return 'Conrad Fisher Connie';
  }

  identity(): string {
    return 'conrad@mail.com';
  }

  initials(): string {
    return 'CF';
  }

  role(): string {
    return 'Teacher';
  }

  currentUid(): string | null {
    return 'stub-uid';
  }
}

/**
 * The feed is SIGNALS, not methods — the shell reads `feed` and `unreadCount`
 * directly into its own fields, so a stub exposing them as functions leaves the
 * template calling a signal that isn't one.
 */
class StubNotificationService {
  readonly feed = signal([]);
  readonly unreadCount = signal(0);
  readonly loaded = signal(true);

  async load(): Promise<void> {
    // Nothing to read: the stub feed is always empty.
  }

  async markAllRead(): Promise<void> {
    // Nothing to mark.
  }

  reset(): void {
    // Nothing to reset.
  }
}

async function mount(): Promise<{ fixture: ComponentFixture<Shell>; el: HTMLElement }> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [Shell],
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: new StubAuthService() },
      { provide: NotificationService, useValue: new StubNotificationService() }
    ]
  }).compileComponents();

  const fixture = TestBed.createComponent(Shell);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('Shell — sidebar navigation', () => {

  it('lists the five admin pages in order, Set Up Wizard first and Learning Units last', async () => {
    const { fixture } = await mount();

    expect(fixture.componentInstance.adminNav.map(item => item.label)).toEqual([
      'Set Up Wizard',
      'Institutions',
      'Classrooms',
      'Programme',
      'Learning Units'
    ]);
  });

  /**
   * The POSITION is the assertion, not merely the membership.
   *
   * "Above the tables it feeds" is a positional requirement, and an entry
   * appended anywhere in this array still passes a test that only checks the
   * label is present somewhere.
   */
  it('puts Set Up Wizard above Institutions, not at the end', async () => {
    const { fixture } = await mount();
    const labels = fixture.componentInstance.adminNav.map(item => item.label);

    expect(labels[0]).toBe('Set Up Wizard');
    expect(labels.indexOf('Set Up Wizard')).toBeLessThan(labels.indexOf('Institutions'));
  });

  it('leaves the three pre-existing entries on their original paths and icons', async () => {
    const { fixture } = await mount();
    const [, institutions, classrooms, programme] = fixture.componentInstance.adminNav;

    expect(institutions).toEqual({ label: 'Institutions', path: '/institutions', icon: 'building' });
    expect(classrooms).toEqual({ label: 'Classrooms', path: '/classrooms', icon: 'classroom' });
    expect(programme).toEqual({ label: 'Programme', path: '/programme', icon: 'programme' });
  });

  it('points Set Up Wizard at the real /setup-wizard route', async () => {
    const { fixture } = await mount();
    const item = fixture.componentInstance.adminNav.find(
      entry => entry.label === 'Set Up Wizard'
    );

    expect(item?.path).toBe('/setup-wizard');
    expect(item?.icon).toBe('settings');
  });

  it('renders the entry as a link to /setup-wizard', async () => {
    const { el } = await mount();
    const links = [...el.querySelectorAll<HTMLAnchorElement>('.sidebar-nav a.nav-item')];
    const labels = links.map(link => link.textContent?.trim());

    expect(labels).toContain('Set Up Wizard');

    const setupWizard = links.find(link => link.textContent?.trim() === 'Set Up Wizard');

    expect(setupWizard?.getAttribute('href')).toBe('/setup-wizard');
  });

  it('renders Set Up Wizard before Institutions in the DOM, not just in the array', async () => {
    const { el } = await mount();
    const labels = [...el.querySelectorAll('.sidebar-nav a.nav-item')]
      .map(link => link.textContent?.trim());

    expect(labels.indexOf('Set Up Wizard')).toBe(labels.indexOf('Institutions') - 1);
  });

  /** Dashboard is its own group above the Admin heading and is unaffected. */
  it('leaves the primary nav untouched', async () => {
    const { fixture } = await mount();

    expect(fixture.componentInstance.primaryNav).toEqual([
      { label: 'Dashboard', path: '/dashboard', icon: 'grid' }
    ]);
  });

  /**
   * Learning Units is IN, and reachable.
   *
   * This test asserted the opposite until the entry and its route were restored.
   * It is kept and inverted rather than deleted, because the thing worth guarding
   * did not change — only its direction. The RENDERED HREF is half the assertion:
   * the array can carry the entry while the route block in app.routes.ts is still
   * missing, and that combination is a link in the sidebar that lands the user on
   * the splash. Checking both together is what catches it.
   */
  it('includes Learning Units, and links to a route that resolves', async () => {
    const { fixture, el } = await mount();
    const labels = [
      ...fixture.componentInstance.primaryNav,
      ...fixture.componentInstance.adminNav
    ].map(item => item.label);

    expect(labels).toContain('Learning Units');

    const hrefs = [...el.querySelectorAll<HTMLAnchorElement>('.sidebar-nav a.nav-item')]
      .map(link => link.getAttribute('href'));

    expect(hrefs).toContain('/learning-units');
  });
});

/**
 * Shell — the Institutions tree.
 *
 * WHY THIS EXISTS. The tree is driven by the teacher's own allotment, the same
 * read the dashboard cards use, and it is three levels deep with an accordion at
 * the second. What can silently go wrong is the wiring rather than the styling:
 * an empty allotment rendering an empty group, both schools open at once, or a
 * class row labelled by something other than grade and section.
 *
 * DashboardService is stubbed so nothing reaches Firestore — the real one is
 * injected by the shell's constructor, which is why the group renders empty
 * rather than throwing when a read fails.
 */
describe('Shell — the Institutions tree', () => {

  class StubDashboardService {
    constructor(private institutions: AllottedInstitution[]) {}

    async myAllotment(): Promise<TeacherAllotment> {
      return {
        institutions: this.institutions,
        classroomCount: this.institutions.reduce((n, i) => n + i.classrooms.length, 0)
      };
    }
  }

  function classroom(overrides: Partial<TeacherClassroom> = {}): TeacherClassroom {
    return {
      activeStatus: true,
      classroomId: 'c1',
      classroomName: '1 A',
      grade: '1',
      section: 'A',
      institutionId: 'inst-1',
      institutionName: 'ThinkTac',
      type: 'CLASSROOM',
      ...overrides
    } as unknown as TeacherClassroom;
  }

  async function mountTree(institutions: AllottedInstitution[]) {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Shell],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: new StubAuthService() },
        { provide: NotificationService, useValue: new StubNotificationService() },
        { provide: DashboardService, useValue: new StubDashboardService(institutions) }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  const TWO_SCHOOLS: AllottedInstitution[] = [
    {
      institutionId: 'inst-1',
      institutionName: 'ThinkTac',
      classrooms: [
        classroom({ classroomId: 'a', grade: '1', section: 'A' }),
        classroom({ classroomId: 'b', grade: '2', section: 'A' })
      ]
    },
    {
      institutionId: 'inst-2',
      institutionName: 'Airaa Academy',
      classrooms: [classroom({ classroomId: 'c', grade: '4', section: 'A' })]
    }
  ];

  /* NO GROUP AT ALL when nothing is allotted — an "Institutions" header opening
     onto an empty list says the read failed when it did not. */
  it('renders no group when nothing is allotted', async () => {
    const fixture = await mountTree([]);

    expect(fixture.nativeElement.querySelector('.nav-group')).toBeNull();
  });

  it('renders the group, closed, when schools are allotted', async () => {
    const fixture = await mountTree(TWO_SCHOOLS);
    const group = fixture.nativeElement.querySelector('.nav-group');

    expect(group).toBeTruthy();
    expect(group.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('.nav-tree')).toBeNull();
  });

  it('lists the schools once opened', async () => {
    const fixture = await mountTree(TWO_SCHOOLS);
    const component = fixture.componentInstance;

    component.toggleInstitutions();
    fixture.detectChanges();

    const names = Array.from(
      fixture.nativeElement.querySelectorAll('.nav-school .nav-label')
    ).map((el: unknown) => (el as HTMLElement).textContent?.trim());

    expect(names).toEqual(['ThinkTac', 'Airaa Academy']);
  });

  /* AN ACCORDION, which is production's behaviour: opening the second school
     closes the first, or five schools of three classes push Admin off-screen. */
  it('opens one school at a time', async () => {
    const fixture = await mountTree(TWO_SCHOOLS);
    const component = fixture.componentInstance;

    component.toggleInstitutions();
    component.toggleSchool(TWO_SCHOOLS[0]);
    fixture.detectChanges();

    expect(component.isSchoolOpen(TWO_SCHOOLS[0])).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('.nav-class').length).toBe(2);

    component.toggleSchool(TWO_SCHOOLS[1]);
    fixture.detectChanges();

    expect(component.isSchoolOpen(TWO_SCHOOLS[0])).toBe(false);
    expect(component.isSchoolOpen(TWO_SCHOOLS[1])).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('.nav-class').length).toBe(1);
  });

  it('closes a school when it is clicked again', async () => {
    const fixture = await mountTree(TWO_SCHOOLS);
    const component = fixture.componentInstance;

    component.toggleInstitutions();
    component.toggleSchool(TWO_SCHOOLS[0]);
    component.toggleSchool(TWO_SCHOOLS[0]);
    fixture.detectChanges();

    expect(component.openSchool()).toBeNull();
    expect(fixture.nativeElement.querySelector('.nav-class')).toBeNull();
  });

  /* GRADE AND SECTION, which is what production's rows show — not the
     classroom's name, which is far too long for a sidebar row. */
  it('labels a class by grade and section', async () => {
    const fixture = await mountTree(TWO_SCHOOLS);
    const component = fixture.componentInstance;

    expect(component.classLabel(classroom({ grade: '1', section: 'A' }))).toBe('1 A');
    expect(component.classLabel(classroom({ grade: '10', section: 'NA' }))).toBe('10 NA');
  });

  /* A STEM club carries neither, so the name is the only thing left to show. */
  it('falls back to the name when there is no grade or section', async () => {
    const fixture = await mountTree(TWO_SCHOOLS);
    const component = fixture.componentInstance;

    expect(
      component.classLabel(
        classroom({ grade: '', section: '', classroomName: 'ThinkTac STEM Forge' })
      )
    ).toBe('ThinkTac STEM Forge');
  });

  it('leaves the Admin group and Dashboard untouched', async () => {
    const fixture = await mountTree(TWO_SCHOOLS);
    const component = fixture.componentInstance;

    component.toggleInstitutions();
    fixture.detectChanges();

    expect(component.primaryNav.map(item => item.label)).toEqual(['Dashboard']);
    expect(fixture.nativeElement.textContent).toContain('Admin');
    expect(fixture.nativeElement.textContent).toContain('Classrooms');
  });
});

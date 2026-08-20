import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../../services/auth.service';
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

  it('lists the four admin pages in order, Set Up Wizard first', async () => {
    const { fixture } = await mount();

    expect(fixture.componentInstance.adminNav.map(item => item.label)).toEqual([
      'Set Up Wizard',
      'Institutions',
      'Classrooms',
      'Programme'
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
   * Learning Units stays out.
   *
   * Its route still resolves and the page, its add/edit form and
   * LearningUnitService all still exist; only the nav entry was removed, and
   * adding Set Up Wizard must not have quietly restored this one alongside it.
   */
  it('omits Learning Units', async () => {
    const { fixture, el } = await mount();
    const labels = [
      ...fixture.componentInstance.primaryNav,
      ...fixture.componentInstance.adminNav
    ].map(item => item.label);

    expect(labels).not.toContain('Learning Units');

    const hrefs = [...el.querySelectorAll<HTMLAnchorElement>('.sidebar-nav a.nav-item')]
      .map(link => link.getAttribute('href'));

    expect(hrefs).not.toContain('/learning-units');
  });
});

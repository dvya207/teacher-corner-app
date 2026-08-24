import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { DashboardCounts } from '../../models/teaching.model';
import { AuthService } from '../../services/auth.service';
import { DashboardService } from '../../services/dashboard.service';
import { Dashboard } from './dashboard';

/**
 * Dashboard — what the page renders.
 *
 * AuthService, DashboardService and Router are stubbed, so this runs without
 * Firebase. The page sits behind authGuard and cannot be opened in a browser
 * without real credentials, which is why the assertions here cover rendering
 * and not just logic: this is the only automated check on what this page
 * actually renders.
 *
 * The absence assertions are deliberate. A "What's new" card, a "Quick Actions"
 * heading, two large expandable cards and the four action tiles were all removed
 * from this page over time; a half-finished revert would put markup back without
 * anyone noticing, so their absence is pinned here.
 */

class StubAuthService {
  /**
   * SIGNAL-BACKED, mirroring the real service.
   *
   * `AuthService.displayName()` reads an internal version signal before reading
   * the auth record, so a caller inside a `computed` re-runs when the name
   * changes. A stub returning a constant could not tell a computed apart from a
   * value snapshotted once at construction — which is exactly what the greeting
   * used to be.
   */
  readonly name = signal('Conrad Fisher Connie');

  displayName(): string {
    return this.name();
  }
}

class StubDashboardService {
  constructor(private result: DashboardCounts | Error) {}

  async counts(): Promise<DashboardCounts> {
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

/**
 * The real router, not a stub: the banner's two links use routerLink, which
 * injects ActivatedRoute and needs the router's own providers to render at all.
 * Imperative navigation is observed with a spy instead.
 */
async function mount(
  result: DashboardCounts | Error = { institutions: 2, classrooms: 0 }
): Promise<{
  fixture: ComponentFixture<Dashboard>;
  navigated: unknown[][];
  el: HTMLElement;
  auth: StubAuthService;
}> {
  const auth = new StubAuthService();
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [Dashboard],
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: auth },
      { provide: DashboardService, useValue: new StubDashboardService(result) }
    ]
  }).compileComponents();

  const navigated: unknown[][] = [];
  vi.spyOn(TestBed.inject(Router), 'navigate').mockImplementation(
    async (commands: readonly unknown[]) => {
      navigated.push([...commands]);
      return true;
    }
  );

  const fixture = TestBed.createComponent(Dashboard);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, navigated, el: fixture.nativeElement as HTMLElement, auth };
}

describe('Dashboard', () => {

  /*
   * THE GREETING FOLLOWS A PROFILE EDIT.
   *
   * `username` was a plain field holding whatever displayName() returned at
   * construction, so renaming yourself from "abc def" to "xyz pqr" left this
   * banner on the old name until a full reload. It is a `computed` now.
   *
   * Asserted through the RENDERED text rather than the component field, because
   * a signal interpolated without being invoked renders as a function and would
   * still pass a field-level check.
   */
  it('updates the greeting when the display name changes', async () => {
    const { el, fixture, auth } = await mount();
    expect(el.querySelector('h1')?.textContent).toContain('Conrad Fisher Connie');

    auth.name.set('Xyz Pqr');
    fixture.detectChanges();

    expect(el.querySelector('h1')?.textContent).toContain('Xyz Pqr');
    expect(el.querySelector('h1')?.textContent).not.toContain('Conrad Fisher Connie');
  });

  it('renders the name as text, not as a function', async () => {
    // Guards the template calling username() rather than interpolating the
    // signal itself, which renders "function computed()..." and is visible only
    // in the DOM.
    const { el } = await mount();
    const heading = el.querySelector('h1')?.textContent ?? '';

    expect(heading).not.toContain('function');
    expect(heading).not.toContain('=>');
  });

  it('renders the welcome banner and both counts', async () => {
    const { el } = await mount();

    expect(el.querySelector('h1')?.textContent).toContain('Conrad Fisher Connie');

    const tiles = el.querySelectorAll('.count-tile');
    expect(tiles.length).toBe(2);
    expect(tiles[0].textContent).toContain('2');
    expect(tiles[0].textContent).toContain('Institutions');
    expect(tiles[1].textContent).toContain('0');
    expect(tiles[1].textContent).toContain('Classrooms');
  });

  it('does not render the removed cards, tiles or headings', async () => {
    const { el } = await mount();

    for (const selector of [
      '.whats-new-card', '.new-badge', '.section-title', '.actions-grid',
      '.action-card', '.expand-panel',
      // The four action tiles — Programmes, Learning Units, Assignments, Kit
      // Manager — were removed too. Pinned here for the same reason: a partial
      // revert would restore markup nobody asked for.
      '.tile-grid', '.tile'
    ]) {
      expect(el.querySelector(selector)).toBeNull();
    }

    expect(el.textContent).not.toContain('Quick Actions');
    expect(el.textContent).not.toContain("What's new");
    expect(el.textContent).not.toContain('Kit Manager');
  });

  /**
   * A failed count read must not render as 0 — that is a plausible-looking wrong
   * answer rather than a visible error.
   */
  it('shows an error rather than a zero when the counts fail', async () => {
    const { el } = await mount(Object.assign(new Error('nope'), { code: 'permission-denied' }));

    expect(el.querySelector('.load-error')).not.toBeNull();
    expect(el.querySelector('.count-tile')?.textContent).not.toContain('0');
    // The banner still renders both count tiles — showing a dash, not a zero.
    expect(el.querySelectorAll('.count-tile').length).toBe(2);
  });
});

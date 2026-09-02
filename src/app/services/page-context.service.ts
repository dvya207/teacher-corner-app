import { Injectable, signal } from '@angular/core';

/**
 * A breadcrumb a PAGE names for itself.
 *
 * WHY THIS EXISTS. The shell builds its breadcrumb from static route `data` —
 * `{ title: 'Classroom', crumbRoot: 'Admin' }` — which is right for every page
 * whose name is fixed. It is wrong for a page ABOUT one record: the classroom
 * page read "Admin › Classroom" whatever class was open, so the crumb named the
 * screen instead of what was on it, and did so under the wrong section.
 *
 * The shell reads what is set here IN PREFERENCE to route data, and the route
 * data remains the fallback — so a page that says nothing behaves exactly as
 * before, and nothing else had to change.
 *
 * CLEARED ON NAVIGATION by the shell, not by the page. A page that set a crumb
 * and then navigated away cannot be relied on to clean up — it is already
 * destroyed — and a stale crumb naming the previous record is worse than a
 * generic one.
 *
 * THE MIDDLE IS A LIST, NOT ONE SEGMENT, and it became one when the workflow
 * stepper needed four: institution › class › programme › learning unit, which is
 * production's own crumb on that page. A single middle segment could carry three
 * in total, so the stepper would have had to drop one — and which one you drop is
 * the question that has no good answer, because each names a different thing the
 * reader navigated through.
 */
@Injectable({
  providedIn: 'root'
})
export class PageContextService {

  /** Overrides the route's `title`, or '' to leave it alone. */
  readonly title = signal('');

  /** Overrides the route's `crumbRoot`, or '' to leave it alone. */
  readonly crumbRoot = signal('');

  /**
   * The segments between the root and the title. Empty renders none.
   *
   * BLANKS ARE DROPPED BY THE SETTER, not by the shell: a classroom with no
   * programme showing has nothing to put in that position, and rendering it would
   * give the crumb a stray separator with nothing after it.
   */
  readonly crumbTrail = signal<readonly string[]>([]);

  /**
   * @param middle Segments between the root and the title, in order. Any that are
   *   empty or whitespace are dropped.
   */
  set(root: string, middle: readonly string[] | string, title: string): void {
    const trail = (typeof middle === 'string' ? [middle] : middle)
      .map(segment => segment.trim())
      .filter(segment => segment !== '');

    this.crumbRoot.set(root);
    this.crumbTrail.set(trail);
    this.title.set(title);
  }

  clear(): void {
    this.crumbRoot.set('');
    this.crumbTrail.set([]);
    this.title.set('');
  }
}

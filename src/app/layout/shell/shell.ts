import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet
} from '@angular/router';
import { filter } from 'rxjs/operators';

import { Icon, IconName } from '../../components/icon/icon';
import { NotificationModule } from '../../models/teaching.model';
import { NotificationService } from '../../services/notification.service';
import { Logo } from '../../components/logo/logo';
import { UpdateProfile } from '../../components/update-profile/update-profile';
import { AuthService } from '../../services/auth.service';
import { ConfigurationService } from '../../services/configuration.service';

export interface NavItem {
  label: string;
  path: string;
  icon: IconName;
}

/**
 * The signed-in chrome: sidebar, topbar, and the outlet every page renders
 * into.
 *
 * This is a layout route rather than a component each page embeds. Embedding
 * would rebuild the sidebar on every navigation, losing the collapsed state and
 * re-running its animations; as a parent route the shell is instantiated once
 * and only the outlet's contents change.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule, Icon, Logo, UpdateProfile],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  /**
   * Escape closes the mobile drawer.
   *
   * The keyboard equivalent of tapping the scrim, which is a div that never takes
   * focus and so cannot receive a keydown of its own. `closeDrawer` rather than
   * `toggleDrawer`: Escape means dismiss, and toggling would OPEN the drawer for
   * anyone pressing Escape with it already closed.
   */
  host: { '(document:keydown.escape)': 'closeDrawer()' }
})
export class Shell {

  readonly primaryNav: NavItem[] = [
    { label: 'Dashboard', path: '/dashboard', icon: 'grid' }
  ];

  /**
   * Set Up Wizard leads the Admin group, as it does in production's sidebar.
   *
   * FIRST, not appended. It is the guided path through the three pages below it —
   * it creates an institution, then its teachers and students — so it belongs
   * above the individual tables rather than after them. Its route and page
   * already existed; this is the entry that was previously withheld.
   *
   * `settings` is its icon because `settings` is already the icon the page's own
   * heading renders, and production draws a cog here too.
   *
   * Learning Units is deliberately ABSENT.
   *
   * Removed from the nav, and then its ROUTE was removed too, both on instruction.
   * /learning-units no longer resolves: it falls through to the '**' route and lands
   * on the splash. The page, its add/edit form and LearningUnitService are all still
   * in the repo — see the note in app.routes.ts for why the code stays — so bringing
   * it back is one route block and one entry in this list.
   *
   * The three entries after Set Up Wizard are untouched, in their original order.
   */
  readonly adminNav: NavItem[] = [
    { label: 'Set Up Wizard', path: '/setup-wizard',  icon: 'settings' },
    { label: 'Institutions',  path: '/institutions',  icon: 'building' },
    { label: 'Classrooms',    path: '/classrooms',    icon: 'classroom' },
    { label: 'Programme',     path: '/programme',     icon: 'programme' }
  ];

  readonly collapsed = signal(false);

  /** Mobile only: the sidebar becomes an overlay drawer rather than a column. */
  readonly drawerOpen = signal(false);

  readonly searchQuery = signal('');

  /**
   * Which topbar popover is open, or null.
   *
   * One signal rather than a boolean per popover: they overlap visually, so
   * two open at once is a state with no sensible rendering. This makes that
   * unrepresentable instead of relying on every toggle remembering to close
   * the other.
   */
  readonly openPopover = signal<'user' | 'notifications' | null>(null);

  readonly userMenuOpen = computed(() => this.openPopover() === 'user');
  readonly notificationsOpen = computed(() => this.openPopover() === 'notifications');

  /**
   * The teacher's own feed, read from users/{uid}/notifications.
   *
   * Was a static empty array with a note saying a real feed would need a new
   * top-level collection and a rules change. It needed neither: the feed lives
   * under the user's own document, which `users/{uid}/{document=**}` already
   * covers, so this became a change of source with the template untouched.
   */
  private notificationService = inject(NotificationService);

  readonly notifications = this.notificationService.feed;
  readonly unreadCount = this.notificationService.unreadCount;

  /**
   * Second breadcrumb segment, from the active route's `title` data.
   *
   * Read from route data rather than from the URL, so a path like /institutions
   * renders as "Institutions" without a slug-to-label lookup living in the
   * template.
   */
  readonly pageTitle = signal('Dashboard');

  /** First breadcrumb segment. 'ThinkTac' unless a route overrides it. */
  readonly crumbRoot = signal('ThinkTac');

  /** Topbar search placeholder, so it can name what the page actually searches. */
  readonly searchPlaceholder = signal('Search...');

  private auth = inject(AuthService);
  private router = inject(Router);
  private configuration = inject(ConfigurationService);

  readonly displayName = signal(this.auth.displayName());
  readonly displayInitials = signal(this.auth.initials());
  readonly userRole = this.auth.role();
  readonly userIdentity = this.auth.identity();

  constructor() {
    // ONCE PER SESSION, from the shell: this is the first thing that renders after
    // sign-in, the Configuration collection needs an authenticated reader, and every
    // page that uses an option list lives inside here. load() is a no-op on repeat
    // calls, and every list already holds its built-in value, so nothing waits on it.
    void this.configuration.load();

    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        this.applyRouteData();

        // A navigation from inside the drawer has to close it, or the new page
        // renders underneath the overlay it was launched from.
        this.drawerOpen.set(false);
        this.openPopover.set(null);
      });

    this.applyRouteData();

    // The feed is loaded ONCE, here, rather than per page: the shell outlives
    // every route inside it, so a page navigation must not re-read it. Not
    // awaited — the topbar renders with an empty bell and gains its count when
    // the read lands, which is the right order for furniture.
    /**
     * THE FEED IS DELIBERATELY NOT LOADED.
     *
     * Nothing writes a notification any more — the calls that logged one on every
     * institution, classroom and programme change were removed on instruction —
     * so reading the collection could only ever surface entries written before
     * that, which is exactly what was asked to stop appearing. The bell keeps its
     * empty state instead.
     *
     * Documents already in users/{uid}/notifications are left alone. Nothing
     * reads them, and deleting somebody's stored data to tidy up is not a
     * side effect this change should have.
     */
  }

  /** Pulls every topbar value the active route declares, in one pass. */
  private applyRouteData(): void {
    const data = this.deepestData();

    this.pageTitle.set(data['title'] ?? 'Dashboard');
    this.crumbRoot.set(data['crumbRoot'] ?? 'ThinkTac');
    this.searchPlaceholder.set(data['search'] ?? 'Search...');
  }

  /**
   * Walks to the deepest activated child, which is the one carrying the title.
   *
   * Walks the ROUTER STATE SNAPSHOT rather than this component's own
   * ActivatedRoute. Reading `activatedRoute.firstChild.snapshot` from the
   * constructor throws: the shell is instantiated while its child route is
   * still being activated, so the child ActivatedRoute exists in the tree but
   * has no snapshot assigned yet. The router's own snapshot is already the
   * incoming one by that point, so it is safe at both call sites.
   */
  private deepestData(): Record<string, string> {
    let node = this.router.routerState.snapshot.root;

    while (node.firstChild) {
      node = node.firstChild;
    }

    return node.data as Record<string, string>;
  }

  toggleCollapsed(): void {
    this.collapsed.update(value => !value);
  }

  /**
   * Dismiss only, for the Escape key.
   *
   * Separate from toggleDrawer because Escape means "close", and toggling would
   * open the drawer for anyone pressing Escape while it is already shut.
   */
  closeDrawer(): void {
    this.drawerOpen.set(false);
  }

  toggleDrawer(): void {
    this.drawerOpen.update(value => !value);
  }

  toggleUserMenu(): void {
    this.openPopover.update(current => (current === 'user' ? null : 'user'));
  }

  toggleNotifications(): void {
    this.openPopover.update(current =>
      current === 'notifications' ? null : 'notifications'
    );
  }

  /** Which icon a feed entry shows, by the module it came from. */
  moduleIcon(module: NotificationModule): IconName {
    const icons: Record<NotificationModule, IconName> = {
      institution: 'building',
      classroom: 'classroom',
      programme: 'programme'
    };

    return icons[module] ?? 'bell';
  }

  markAllRead(): void {
    void this.notificationService.markAllRead();
  }

  /**
   * Opening the panel marks what is in it read.
   *
   * The unread count answers "is there anything I have not seen", so it should
   * clear when the answer becomes no. Done on OPEN rather than on close, so the
   * count does not sit stale behind an open panel the user is reading.
   */
  private markFeedSeen(): void {
    if (this.unreadCount() > 0) {
      void this.notificationService.markAllRead();
    }
  }

  /** Opens the modal in place rather than navigating away from the page. */
  readonly profileOpen = signal(false);

  editProfile(): void {
    this.openPopover.set(null);
    this.profileOpen.set(true);
  }

  closeProfile(): void {
    this.profileOpen.set(false);
  }

  /**
   * Refreshes the topbar after a save.
   *
   * username/userInitials are read once from the auth record at construction,
   * so a profile saved to Firestore would otherwise leave the topbar showing
   * the old name until a full reload.
   */
  onProfileSaved(profile: { firstName: string; lastName: string }): void {
    const name = `${profile.firstName} ${profile.lastName}`.trim();

    if (name) {
      this.displayName.set(name);
      this.displayInitials.set(
        (profile.firstName[0] ?? '') + (profile.lastName[0] ?? '')
      );
    }
  }

  /**
   * Signs out, then hands off to the confirmation page rather than dropping
   * the user straight on /login, which is indistinguishable from a session
   * that expired on its own.
   *
   * The sign-out happens here, before navigating, so the shell is never left
   * rendering a signed-in chrome over a dead session.
   */
  async logout(): Promise<void> {

    try {
      await this.auth.logout();
    } catch {
      /**
       * Navigate anyway. An unawaited rejection here — a network blip during
       * signOut — would otherwise leave the button doing nothing at all, with
       * no feedback, which reads as a broken app. The sign-out page retries
       * the sign-out for exactly this case, and /login's guard is the
       * authoritative check either way.
       */
    }

    // The feed is one teacher's own record of what they did, so it must not be
    // sitting in the bell when the next person signs in on this machine. The
    // documents stay; only the in-memory copy is dropped.
    this.notificationService.reset();

    await this.router.navigate(['/sign-out']);
  }
}

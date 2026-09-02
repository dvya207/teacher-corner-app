import { Component, computed, effect, inject, signal } from '@angular/core';
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
import {
  AllottedInstitution,
  TeacherClassroom
} from '../../models/teaching.model';
import { AuthService } from '../../services/auth.service';
import { PageContextService } from '../../services/page-context.service';
import { DashboardService } from '../../services/dashboard.service';
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

  /* ======================================================================
     INSTITUTIONS — the signed-in teacher's own schools and classes

     Production's sidebar carries this between Dashboard and the Admin group: a
     collapsible 'Institutions' item listing the schools this person teaches at,
     each expanding to the classes they teach there.

     THE SAME ALLOTMENT THE DASHBOARD USES. DashboardService.myAllotment reads
     the teacher's own documents and groups them, so the sidebar and the
     dashboard cards can never disagree about what someone is assigned to —
     which they would if this counted separately.
     ====================================================================== */

  private dashboard = inject(DashboardService);

  /**
   * READS THE SHARED SIGNAL, rather than holding its own copy.
   *
   * The sidebar and the dashboard render the same allotment; two snapshots drift
   * apart the moment one is refreshed and the other is not, which is exactly what
   * deleting a classroom used to do.
   */
  readonly allotment = computed(() => this.dashboard.allotment().institutions);

  /** Whether the Institutions group itself is open. Closed until asked for. */
  readonly institutionsOpen = signal(false);

  /**
   * Which school's classes are showing, by key, or null.
   *
   * AN ACCORDION — one at a time, which is production's behaviour: opening
   * Airaa Academy closes ThinkTac. With five schools and three classes each,
   * all-open would push the whole Admin group off the bottom of the sidebar.
   */
  readonly openSchool = signal<string | null>(null);

  /**
   * The classroom the current URL is about, or ''.
   *
   * Kept so the tree can REVEAL it — see the effect below. Read from the URL
   * rather than handed over by the page, because the shell is a layout route and
   * must not depend on what is rendered inside it.
   */
  private readonly routeClassroomId = signal('');

  /**
   * OPENS THE TREE ONTO THE CLASS BEING VIEWED.
   *
   * WHY THIS EXISTS. Arriving from a dashboard card, or from a shared link, left
   * the Institutions group collapsed — so the sidebar gave no indication of where
   * you were and the class was two clicks from being visible, let alone clickable.
   *
   * AN EFFECT RATHER THAN A NAVIGATION HANDLER, because the two things it needs
   * arrive in either order: the URL changes immediately, and the allotment lands
   * after a read. Whichever is last triggers this, so a hard refresh straight
   * onto a class still opens the tree once the schools appear.
   *
   * It only ever OPENS. Collapsing on navigation away would fight a user who had
   * deliberately opened a different school.
   */
  private readonly revealCurrentClass = effect(() => {
    const classroomId = this.routeClassroomId();

    if (!classroomId) {
      return;
    }

    const school = this.allotment().find(entry =>
      entry.classrooms.some(classroom => classroom.classroomId === classroomId)
    );

    if (!school) {
      return;
    }

    this.institutionsOpen.set(true);
    this.openSchool.set(this.schoolKey(school));
  });

  schoolKey(institution: AllottedInstitution): string {
    return institution.institutionId || institution.institutionName;
  }

  toggleInstitutions(): void {
    this.institutionsOpen.update(open => !open);
  }

  toggleSchool(institution: AllottedInstitution): void {
    const key = this.schoolKey(institution);

    this.openSchool.update(open => (open === key ? null : key));
  }

  isSchoolOpen(institution: AllottedInstitution): boolean {
    return this.openSchool() === this.schoolKey(institution);
  }

  /**
   * A class's label in the tree: '1 A'.
   *
   * Grade and section, which is what production shows — not the classroom's
   * name, because a name like 'ThinkTac STEM Forge' is far too long for a
   * sidebar row and the grade is what distinguishes one class from the next.
   * A class with neither falls back to its name rather than rendering blank.
   */
  /**
   * The programme a class row should open on.
   *
   * THE FIRST ATTACHED, which is the same choice the dashboard cards make and
   * the same one the page falls back to when given nothing. Passing it keeps the
   * two entry points landing identically rather than one relying on the
   * fallback.
   */
  firstProgrammeId(classroom: TeacherClassroom): string {
    return classroom.programmes?.[0]?.programmeId ?? '';
  }

  classLabel(classroom: TeacherClassroom): string {
    const parts = [classroom.grade, classroom.section].filter(part => part.trim() !== '');

    return parts.length > 0 ? parts.join(' ') : classroom.classroomName || '—';
  }

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
   * Learning Units is BACK, and this entry is the whole of the nav side of that.
   *
   * It was withheld twice — first this entry, then its route — and both were
   * restored on instruction. Nothing about the page changed while it was
   * unreachable, which is why bringing it back cost one line here and one route
   * block in app.routes.ts, exactly as the note that stood here predicted.
   *
   * LAST, after Programme, which is the order production's sidebar uses.
   *
   * `chart` is its icon because production draws a bar chart here, and `book` is
   * already spoken for by the page's own Total LUs stat card.
   */
  readonly adminNav: NavItem[] = [
    { label: 'Set Up Wizard',  path: '/setup-wizard',   icon: 'settings' },
    { label: 'Institutions',   path: '/institutions',   icon: 'building' },
    { label: 'Classrooms',     path: '/classrooms',     icon: 'classroom' },
    { label: 'Programme',      path: '/programme',      icon: 'programme' },
    { label: 'Learning Units', path: '/learning-units', icon: 'chart' },
    /* AFTER Learning Units, which is where production's sidebar puts it too —
       the things a classroom is set come after the things it is built from.

       THE ICONS ARE PRODUCTION'S OWN, entry for entry: Learning Units is
       heroicons chart-square-bar ('chart' here), Assignments is academic-cap and
       Workflow Templates is the plain clipboard. Assignments used the ticked
       clipboard and Workflow Templates a grip of dots, neither of which appears
       in its sidebar. */
    { label: 'Assignments',    path: '/assignments',    icon: 'academic-cap' },
    { label: 'Workflow Templates', path: '/workflow-templates', icon: 'clipboard-plain' }
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
  private readonly routeTitle = signal('Dashboard');
  private readonly routeCrumbRoot = signal('ThinkTac');

  private pageContext = inject(PageContextService);

  /*
   * WHAT A PAGE SAYS WINS over what its route says.
   *
   * Route data names the SCREEN; a page about one record can name the record.
   * See PageContextService — the route remains the fallback, so every page that
   * says nothing behaves exactly as it did.
   */
  readonly pageTitle = computed(() => this.pageContext.title() || this.routeTitle());
  readonly crumbRoot = computed(
    () => this.pageContext.crumbRoot() || this.routeCrumbRoot()
  );
  readonly crumbTrail = computed(() => this.pageContext.crumbTrail());

  /** Topbar search placeholder, so it can name what the page actually searches. */
  readonly searchPlaceholder = signal('Search...');

  private auth = inject(AuthService);
  private router = inject(Router);
  private configuration = inject(ConfigurationService);

  // Computed, not signal(...): a signal seeded with a call captures that call's
  // value once and never re-runs it, so the topbar and the avatar kept the name
  // they were built with after a profile edit.
  readonly displayName = computed(() => this.auth.displayName());
  readonly displayInitials = computed(() => this.auth.initials());
  readonly userRole = this.auth.role();
  // Computed for the same reason displayName above is: a plain field snapshots
  // the value at construction, so the "Signed in as" line kept naming the
  // previous account after a session change.
  readonly userIdentity = computed(() => this.auth.identity());

  constructor() {
    // ONCE PER SESSION, from the shell: this is the first thing that renders after
    // sign-in, the Configuration collection needs an authenticated reader, and every
    // page that uses an option list lives inside here. load() is a no-op on repeat
    // calls, and every list already holds its built-in value, so nothing waits on it.
    void this.configuration.load();

    // Same reasoning for the sidebar's Institutions tree: the shell is a layout
    // route and outlives every page, so reading the teacher's allotment here is
    // once per session rather than once per navigation.
    void this.dashboard.refresh();

    // A hard refresh straight onto a class: the URL is already correct here, and
    // the effect above opens the tree once the allotment lands.
    this.readClassroomFromUrl();

    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        this.applyRouteData();
        this.readClassroomFromUrl();

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
  /**
   * Pulls the classroom id out of /institutions/classroom/:id.
   *
   * Matched on the router's URL rather than by walking the activated route: the
   * shell runs this from its own constructor too, before the child route has a
   * snapshot assigned — the same hazard deepestData() documents.
   */
  private readClassroomFromUrl(): void {
    const match = /\/institutions\/classroom\/([^/?#]+)/.exec(this.router.url);

    this.routeClassroomId.set(match ? decodeURIComponent(match[1]) : '');
  }

  private applyRouteData(): void {
    const data = this.deepestData();

    /*
     * CLEARED FIRST, then applied.
     *
     * A page that named itself through PageContextService is already destroyed
     * by the time this runs, so it cannot clean up after itself — and a crumb
     * still naming the previous record is worse than a generic one. The page
     * sets its own crumb again on init.
     */
    this.pageContext.clear();

    this.routeTitle.set(data['title'] ?? 'Dashboard');
    this.routeCrumbRoot.set(data['crumbRoot'] ?? 'ThinkTac');
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

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import { Icon } from '../../components/icon/icon';
import {
  AllottedInstitution,
  TeacherClassroom
} from '../../models/teaching.model';
import { AuthService } from '../../services/auth.service';
import { DashboardService } from '../../services/dashboard.service';

/**
 * Dashboard — the welcome banner and its two headline counts.
 *
 * The four action tiles that used to sit under the banner (Programmes, Learning
 * Units, Assignments, Kit Manager) were removed on instruction, so the banner is
 * the page now and is sized to fill it rather than sitting as a strip above
 * empty space.
 *
 * ZONELESS. The counts arrive after an `await`, and a plain field assigned in a
 * promise continuation notifies the change detection scheduler of nothing — the
 * value would land on the component and never reach the DOM. Everything the
 * template reads that is written post-await is therefore a signal.
 */
/**
 * How many gradients each palette holds, matching production's.
 *
 * Four for the institution cards (.ic-0 … .ic-3 there) and six for the classroom
 * cards (.tcc-color-0 … -5). Cycled by index, not hashed.
 */
const INSTITUTION_COLOURS = 4;
const CLASSROOM_COLOURS = 6;

@Component({
  selector: 'app-dashboard',
  imports: [DatePipe, RouterLink, Icon],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class Dashboard implements OnInit {

  private auth = inject(AuthService);
  private dashboard = inject(DashboardService);

  /**
   * A computed, NOT a value resolved at construction.
   *
   * It was the latter, which is why editing your name left this greeting reading
   * the old one until a reload: the field held whatever displayName() returned
   * the moment this component was built. authGuard still guarantees the session
   * is rehydrated before that happens, so the first read is correct — the bug was
   * only that it never read again.
   */
  readonly username = computed(() => this.auth.displayName());

  /** Captured once rather than per render, so the DatePipe is not handed a new
      Date on every change detection pass. */
  readonly today = new Date();

  /**
   * The signed-in person's own schools and classes.
   *
   * THE TILES READ FROM THIS, not from a separate count query. They sit directly
   * over the cards built from the same data, and two numbers answering different
   * questions in the same banner reads as a bug — see the note on
   * DashboardService.myAllotment.
   */
  /**
   * THE SHARED SIGNAL, not a private copy.
   *
   * The sidebar's Institutions tree renders the same allotment. Holding a second
   * snapshot here meant deleting a classroom left one of them stale — see the
   * note on DashboardService.allotment.
   */
  readonly allotment = this.dashboard.allotment;
  readonly loading = this.dashboard.allotmentLoading;

  /**
   * FROM THE SERVICE, not a local copy.
   *
   * refresh() deliberately does not throw — it is called after a delete, where a
   * read failure must not overwrite the message about the write. So the reason
   * lives on the service and this renders it; a local catch here would never
   * fire and the page would show an empty allotment as though it were genuinely empty.
   */
  readonly error = this.dashboard.allotmentError;

  readonly institutions = computed(() => this.allotment().institutions);
  readonly institutionCount = computed(() => this.institutions().length);
  readonly classroomCount = computed(() => this.allotment().classroomCount);

  /**
   * Nothing allotted, and the read SUCCEEDED.
   *
   * Both halves matter: a denied read returns an empty allotment too, and telling
   * someone "no classrooms are allotted to you" when the truth is "we could not
   * look" sends them to the wrong person for help. The error banner owns that
   * case, so this is false while `error` is set.
   */
  readonly nothingAllotted = computed(
    () => !this.loading() && !this.error() && this.institutionCount() === 0
  );

  /**
   * Which institution card is expanded, by key, or null.
   *
   * ONE AT A TIME, as production's is: the panel of classes opens underneath the
   * row of cards, and two open panels would separate a card from its own classes.
   */
  readonly expanded = signal<string | null>(null);

  keyFor(institution: AllottedInstitution): string {
    return institution.institutionId || institution.institutionName;
  }

  toggle(institution: AllottedInstitution): void {
    const key = this.keyFor(institution);

    this.expanded.update(open => (open === key ? null : key));
  }

  isExpanded(institution: AllottedInstitution): boolean {
    return this.expanded() === this.keyFor(institution);
  }

  /** '3 classrooms', '1 classroom' — production's own wording. */
  classroomLabel(institution: AllottedInstitution): string {
    const count = institution.classrooms.length;

    return `${count} ${count === 1 ? 'classroom' : 'classrooms'}`;
  }

  /**
   * The programme the card's Open link should land on.
   *
   * THE FIRST ATTACHED, because a card is about a class rather than about one of
   * its programmes, and the page falls back to the same choice when no id is
   * given. Empty when the class runs none, which the page then reports.
   */
  firstProgrammeId(classroom: TeacherClassroom): string {
    return classroom.programmes?.[0]?.programmeId ?? '';
  }

  /**
   * The card's one badge: its grade, or what it is instead.
   *
   * PRODUCTION'S, verbatim — dashboard.component.html renders
   * `Grade {{ cls.grade }}` when the grade is not null and the type's name when
   * it is, which is why its own screenshot shows 'Grade 0' beside 'Classroom'.
   *
   * Programme chips and the school's name were briefly here too. Both are gone:
   * the instruction was to follow production's structure as it is, and this card
   * carries one badge. The school is named in the panel header above the grid.
   */
  chipFor(classroom: TeacherClassroom): string {
    if (classroom.grade.trim() !== '') {
      return `Grade ${classroom.grade}`;
    }

    return classroom.type === 'CLASSROOM' ? 'Classroom' : 'STEM Club';
  }

  /**
   * Card colours, BY POSITION — production's own `i % 4` and `idx % 6`.
   *
   * This was a hash of the school's identity, so a school kept its colour when
   * another was added above it. Production cycles by index instead, and the
   * instruction was to follow its structure as it is. The consequence is worth
   * knowing: adding a school shifts the colours of everything after it.
   *
   * The two moduli differ because production's palettes do — four institution
   * gradients, six classroom ones.
   */
  instColour(index: number): number {
    return index % INSTITUTION_COLOURS;
  }

  classColour(index: number): number {
    return index % CLASSROOM_COLOURS;
  }

  async ngOnInit(): Promise<void> {
    // The shell already primed the shared signal, so this is a re-read rather
    // than a first read — cheap, and it means arriving at the dashboard after
    // changing something elsewhere shows the change.
    await this.dashboard.refresh();
  }

  /**
   * permission-denied is called out specifically because it is the expected
   * failure while the rules for this app's collections are still undeployed,
   * and it is NOT the same as having no institutions. Collapsing it to a zero
   * would quietly show a wrong number that looks perfectly plausible.
   */
  private describe(error: unknown): string {
    const code = (error as { code?: string })?.code ?? '';

    if (code === 'permission-denied') {
      return 'Not authorised to read your data yet — the Firestore rules for ' +
             'this app have not been deployed.';
    }

    if (code === 'unavailable') {
      return 'Could not reach the database. Check your connection and reload.';
    }

    return 'Could not load your dashboard counts.';
  }
}

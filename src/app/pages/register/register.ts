import { Component, computed, inject, signal } from '@angular/core';
import { ConfigurationService } from '../../services/configuration.service';
import { Router } from '@angular/router';

import { Icon } from '../../components/icon/icon';
import { Logo } from '../../components/logo/logo';
import { COUNTRIES, DEFAULT_COUNTRY, dialFor } from '../../data/institution-options';
import { HERO_MODULES } from '../../data/hero-content';
import { isCompletePincode, toPincodeDigits } from '../../data/setup-wizard-options';
import { Institution, Programme } from '../../models/teaching.model';
import { AuthService } from '../../services/auth.service';
import { InstitutionService } from '../../services/institution.service';
import { ProfileService } from '../../services/profile.service';
import { ProgrammeService } from '../../services/programme.service';

/**
 * Create Account — the profile a teacher fills in after verifying their phone.
 *
 * UI ONLY at this stage, on instruction: the controls, the validation and the
 * enable/disable behaviour are real, and nothing is read from or written to
 * Firestore yet. `submit()` says so rather than pretending, the same way the OTP
 * route did before its functions were deployed.
 *
 * OUTSIDE THE SHELL. No sidebar and no topbar, matching production: a teacher who
 * has not finished registering has nothing to navigate to yet, and offering
 * Institutions or Classrooms first invites a half-registered account with rows
 * already attached to it.
 *
 * EVERY OPTION LIST IS REUSED, not restated. COUNTRIES, BOARDS, GRADES and
 * SECTIONS are the same constants the setup wizard and the classroom forms read,
 * and the pincode helpers are the same ones step one of the wizard uses. A second
 * copy of any of them would drift from the first.
 *
 * ZONELESS, like the rest of the app: anything the template reads and anything
 * written after an await is a signal.
 */
@Component({
  selector: 'app-register',
  imports: [Icon, Logo],
  templateUrl: './register.html',
  styleUrl: './register.css'
})
export class Register {
  private config = inject(ConfigurationService);

  /**
   * The hero chips.
   *
   * REUSED from the login page rather than restated. Production's registration
   * panel lists Lesson Plans, Video Library, Live Workshops, Certifications and
   * Assessment Tools; none of those exists behind this sign-in, and hero-content.ts
   * records that advertising features the app does not have is a promise it cannot
   * keep. These are the modules that are actually there.
   *
   * The whole objects, not just the names: each carries the icon its chip renders,
   * which is the same icon the sidebar uses for that section.
   */
  readonly features = HERO_MODULES;

  /**
   * Where the teacher is in signing up, shown in the hero.
   *
   * REAL STATE, not decoration. By the time this page renders the number is already
   * verified — they reached it by entering a code sent to it — so step one is
   * genuinely done, step two is the form beside it, and step three is the wait the
   * approval page then describes. The "within 24 hours" is the same promise that
   * page makes, kept in step deliberately.
   *
   * NO WHATSAPP. Production's copy promises a WhatsApp message, and this app sends
   * none — the only outbound channel wired up is the Exotel OTP SMS. Naming a channel
   * nothing delivers on is a promise the app cannot keep, so the wait is described
   * without one.
   *
   * This is what the panel holds instead of invented statistics. It fills the space
   * with something the teacher can act on: it tells them there is an approval step
   * coming, which is the one thing about this flow that would otherwise be a surprise.
   */
  readonly steps = [
    { title: 'Mobile number verified', detail: 'You confirmed the code we sent', state: 'done' },
    { title: 'Complete your profile', detail: 'Your school, class and details', state: 'current' },
    { title: 'Approval within 24 hours', detail: "You'll be approved soon", state: 'next' }
  ] as const;

  // ---- Option lists, all reused ------------------------------------------
  readonly countries = COUNTRIES;
  readonly boards = this.config.boards;
  readonly grades = this.config.grades;
  readonly sections = this.config.sections;

  /** Everything this teacher owns, loaded once. */
  private readonly institutions = signal<Institution[]>([]);
  readonly allProgrammes = signal<Programme[]>([]);

  readonly loading = signal(true);

  // ---- Form state ---------------------------------------------------------
  readonly country = signal<string>(DEFAULT_COUNTRY);
  readonly pincode = signal('');
  readonly board = signal('');
  readonly school = signal('');
  readonly firstName = signal('');
  readonly lastName = signal('');
  readonly email = signal('');
  readonly grade = signal('');
  readonly section = signal('');
  readonly programme = signal('');

  readonly refreshing = signal(false);
  readonly pending = signal(false);
  readonly errorMessage = signal('');

  private auth = inject(AuthService);
  private router = inject(Router);
  private institutionService = inject(InstitutionService);
  private programmeService = inject(ProgrammeService);
  private profileService = inject(ProfileService);

  constructor() {
    void this.loadOwnData();
  }

  /**
   * Loads the schools and programmes this teacher owns.
   *
   * BOTH ARE OWNER-SCOPED. The rules only return rows whose ownerId is the caller,
   * so a teacher registering for the first time legitimately gets two empty lists.
   *
   * THERE IS NO LONGER A WAY OUT OF THAT FROM THIS PAGE. An "Add a New
   * Institution" action used to sit under the empty dropdown, reusing the same
   * form Add Classroom opens; it was removed on instruction. A teacher whose
   * pincode has no school on file therefore cannot pick one, and cannot submit,
   * because the school is required. Whoever populates the institutions directory
   * has to do so before that teacher can register.
   *
   * Failures are swallowed into empty lists on purpose: this form's job is to let
   * someone register, and a refused read must not stop that. It just means they
   * create their school here.
   */
  private async loadOwnData(): Promise<void> {
    try {
      const [institutions, programmes] = await Promise.all([
        this.institutionService.list(),
        this.programmeService.list()
      ]);

      this.institutions.set(institutions);
      this.allProgrammes.set(programmes);
    } catch (error) {
      console.error('Could not load schools or programmes for registration.', error);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * The number is read from the AUTH RECORD, not typed.
   *
   * The teacher just proved they hold it by entering a code sent to it. An
   * editable field would let them register a different one, which is the only
   * field on this form that has already been verified.
   */
  readonly phone = this.auth.currentUser?.phoneNumber ?? '';
  readonly dial = dialFor(DEFAULT_COUNTRY);
  readonly phoneDigits = this.phone.replace(/^\+91/, '').replace(/^\+/, '');

  // ---- Validation ---------------------------------------------------------

  /**
   * Pincodes this teacher's schools already use, for the datalist.
   *
   * Filtered by the chosen country, because a suggestion in the wrong format is
   * worse than none: it would fail isCompletePincode the moment it was picked.
   */
  readonly knownPincodes = computed(() =>
    [...new Set(
      this.institutions()
        .filter(item => item.institutionAddress.country === this.country())
        .map(item => item.institutionAddress.pincode.trim())
        .filter(Boolean)
    )].sort()
  );

  /**
   * The schools at the typed pincode.
   *
   * THE PINCODE ALONE DRIVES THIS. As soon as it is complete, every institution
   * already recorded at that pincode appears in the dropdown; the board only
   * narrows the list further, and is not required to see anything.
   *
   * This deliberately differs from step one of the setup wizard, which needs both
   * before it will match. There, the teacher is registering a school they know
   * they own. Here they are trying to FIND their college, and making them guess
   * the board first hides the very row that would have told them which board it
   * is filed under.
   */
  readonly schools = computed(() => {
    if (!this.pincodeComplete()) {
      return [];
    }

    const pincode = this.pincode().trim();
    const board = this.board();

    return this.institutions()
      .filter(item =>
        item.institutionAddress.country === this.country() &&
        item.institutionAddress.pincode.trim() === pincode &&
        // Narrowing only. An unset board matches everything at that pincode.
        (!board || item.board === board)
      )
      .map(item => ({ id: item.docId, name: item.institutionName }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  /**
   * The programmes offered for what the pincode found, NOT the whole catalogue.
   *
   * WHY IT IS NARROWED. This list previously mapped every programme the account
   * could read, so a teacher at one pincode was offered programmes belonging to
   * schools in other towns — and picking one wrote a programme its own school
   * does not run.
   *
   * TWO SCOPES, in order:
   *   a school chosen   that school's programmes only, which is the precise answer
   *   none chosen yet   every school the pincode matched, so the control is usable
   *                     before the school question is answered
   *
   * Empty until the pincode matches something, which is the point: the programme
   * question has no meaningful answer before the school question does.
   */
  readonly programmes = computed(() => {
    const chosen = this.school();
    const scope = chosen
      ? new Set([chosen])
      : new Set(this.schools().map(item => item.id));

    return this.allProgrammes()
      .filter(item => scope.has(item.institutionId))
      .map(item => ({ id: item.docId, name: item.displayName || item.programmeName }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  readonly pincodeComplete = computed(() => isCompletePincode(this.pincode(), this.country()));

  /**
   * Search no longer gates the lookup, which happens as the pincode is typed. It
   * REFETCHES instead, which is the one thing typing cannot do: pick up a school
   * added from another tab, or from the setup wizard, since the list is loaded once.
   */
  readonly canSearch = computed(() => this.pincodeComplete() && !this.refreshing());

  /**
   * A complete pincode matched nothing, which is not the same as not having typed
   * one yet. Keyed on the pincode rather than on a button press, because the lookup
   * is live: an empty dropdown with no explanation reads as broken.
   */
  readonly noMatches = computed(() =>
    this.pincodeComplete() && !this.loading() && !this.refreshing() && this.schools().length === 0
  );

  readonly emailValid = computed(() => {
    const value = this.email().trim();
    return value.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  });

  readonly canSubmit = computed(() =>
    !!this.country() &&
    this.pincodeComplete() &&
    !!this.board() &&
    !!this.school() &&
    this.firstName().trim().length > 0 &&
    this.lastName().trim().length > 0 &&
    this.email().trim().length > 0 &&
    this.emailValid() &&
    !!this.grade() &&
    !!this.section() &&
    !this.pending()
  );

  // ---- Handlers -----------------------------------------------------------

  onCountryChange(value: string): void {
    this.country.set(value);
    // The pincode format and the school list are both country-dependent, so a
    // changed country invalidates both rather than keeping a code that no longer
    // fits the new format.
    this.pincode.set('');
    this.clearSchoolAndProgramme();
  }

  onPincodeInput(value: string): void {
    this.pincode.set(toPincodeDigits(value, this.country()));
    // Narrowing the search must not leave a school selected that the new search
    // would never have offered.
    this.clearSchoolAndProgramme();
  }

  onBoardChange(value: string): void {
    this.board.set(value);
    this.clearSchoolAndProgramme();
  }

  /**
   * A different school means a different programme list.
   *
   * WITHOUT THIS the narrowing is defeated by a stale signal: pick school A and
   * its programme, switch to school B, and `programme` still holds A's — which
   * B does not run, and which submit would happily write.
   */
  onSchoolChange(value: string): void {
    this.school.set(value);
    this.programme.set('');
  }

  /** Both, because the programme list is scoped by the school and the pincode. */
  private clearSchoolAndProgramme(): void {
    this.school.set('');
    this.programme.set('');
  }

  /** Re-reads the institutions, so a school added elsewhere shows up here. */
  async search(): Promise<void> {
    if (!this.canSearch()) {
      return;
    }

    this.errorMessage.set('');
    this.refreshing.set(true);

    try {
      this.institutions.set(await this.institutionService.list());
    } catch (error) {
      this.errorMessage.set(
        this.institutionService.describeError(error, 'Could not refresh the school list.')
      );
    } finally {
      this.refreshing.set(false);
    }
  }

  // ---- Submit -------------------------------------------------------------

  async submit(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }

    this.errorMessage.set('');
    this.pending.set(true);

    const chosenSchool = this.schools().find(item => item.id === this.school());
    const chosenProgramme = this.programmes().find(item => item.id === this.programme());

    try {
      await this.profileService.save({
        firstName: this.firstName().trim(),
        lastName: this.lastName().trim(),
        email: this.email().trim(),
        // The verified number off the session, never the form.
        phone: this.phoneDigits,
        country: this.country(),
        pincode: this.pincode().trim(),
        board: this.board(),
        institutionId: this.school(),
        institutionName: chosenSchool?.name ?? '',
        grade: this.grade(),
        section: this.section(),
        // Programme is optional on this form, so these stay empty rather than
        // writing undefined, which Firestore rejects.
        programmeId: this.programme(),
        programmeName: chosenProgramme?.name ?? '',
        /*
         * The resolved class, as a map, mirroring production's currentStudentInfo.
         *
         * The flat fields above record what was TYPED; this records what it
         * resolved to. Ids rather than names, so a renamed institution or a moved
         * classroom stays followable. classroomName is composed the same way the
         * classrooms page composes it, so "3 A" here means the same thing there.
         */
        currentClassInfo: {
          institutionId: this.school(),
          institutionName: chosenSchool?.name ?? '',
          classroomName: `${this.grade()} ${this.section()}`.trim(),
          programmeId: this.programme(),
          programmeName: chosenProgramme?.name ?? ''
        },
        // THE TWO FLAGS THE GUARDS READ. Both written only on a successful save, so
        // a failed one leaves the teacher on this form rather than through to a
        // dashboard with no profile behind it.
        //
        // profileComplete says the form is done. `ApprovedStatus` is FALSE, and an
        // administrator flips it in the Firestore console; until then the teacher
        // sits on /approval-page. Written explicitly rather than left absent so the
        // document shows the state plainly to whoever has to act on it.
        profileComplete: true,
        ApprovedStatus: false
      });

      // BEFORE navigating, so the topbar and the dashboard greeting read the real
      // name the moment they are constructed. Both take it from the auth record,
      // which a phone sign-in leaves empty; without this they say 'Teacher'.
      await this.auth.setDisplayName(this.firstName().trim(), this.lastName().trim());

      // The waiting page, not the dashboard: `ApprovedStatus` is false, and the shell's
      // guard would bounce them here anyway. Going straight there avoids a visible
      // redirect through a page they are not allowed to see.
      await this.router.navigate(['/approval-page']);
    } catch (error) {
      this.errorMessage.set(
        this.profileService.describeError(error, 'Could not save your profile. Please try again.')
      );
    } finally {
      this.pending.set(false);
    }
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigate(['/login']);
  }
}

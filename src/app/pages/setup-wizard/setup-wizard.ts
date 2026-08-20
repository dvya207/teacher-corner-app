import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

import { Icon } from '../../components/icon/icon';
import { FlowField, isFieldLocked } from '../../data/form-flow';
import { BOARDS, COUNTRIES, DEFAULT_COUNTRY, dialFor } from '../../data/institution-options';
import {
  FIRST_STEP,
  LAST_STEP,
  SETUP_WIZARD_STEPS,
  STEP_ONE_ERRORS,
  StepOneField,
  isCompletePincode,
  toPincodeDigits
} from '../../data/setup-wizard-options';
import {
  Institution,
  InstitutionDraft,
  Programme,
  Teacher,
  TeacherDraft
} from '../../models/teaching.model';
import { InstitutionService } from '../../services/institution.service';
import { ProgrammeService } from '../../services/programme.service';
import { TeacherService } from '../../services/teacher.service';
import { TeacherEntry } from '../../data/teacher-options';
import { AddInstitutionInline } from '../classrooms/add-institution-inline';
import { AddTeachers } from './add-teachers';
import { BulkUploadSchools } from './bulk-upload-schools';

/**
 * What the success toast says after a registration.
 *
 * NAMES THE TEACHER when there is a name to use, because "Santosh Kanta
 * registered successfully" is worth more than the generic line and this step is
 * run several times in a row — a confirmation that reads identically every time
 * cannot be told from the previous one still on screen.
 *
 * Falls back to the plain sentence when the name is empty, and counts instead
 * when more than one teacher came back at once.
 */
export function registeredMessage(saved: readonly { teacherName?: string }[]): string {
  if (saved.length > 1) {
    return `${saved.length} teachers registered successfully`;
  }

  const name = saved[0]?.teacherName?.trim();

  return name ? `${name} registered successfully` : 'Teacher registered successfully';
}

/**
 * Set Up Wizard — the guided path from an institution to its people.
 *
 * A PAGE, not a modal. It is five steps long and the later ones enrol whole
 * cohorts, which is not work that belongs inside a dialog the user can lose by
 * clicking beside it.
 *
 * TWO STEPS, BOTH BUILT. Production's stepper also shows Add STEM Club Teachers,
 * Add Students and Add STEM Club Students; all three were removed on instruction,
 * having only ever rendered a stub saying they were not finished. The wizard is
 * not hard-coded to a step count — see SETUP_WIZARD_STEPS — so adding one back is
 * a list entry and a branch in the template.
 *
 * STEP 2 WRITES. AddTeachers hands its rows up here and this page turns them
 * into teacher documents through TeacherService, against the institution chosen
 * in step 1. The page owns the write; the form only collects — the same split
 * every other form in this app uses.
 *
 * WHERE THE SCHOOL LIST COMES FROM. Production searches a schools directory this
 * app cannot reach, so the Select School control is filtered from the teacher's
 * OWN institutions — the ones /institutions already shows — matched on country,
 * pincode and board. That keeps the control honest: everything it offers is a
 * real document this user can actually set up, and picking one cannot dangle.
 *
 * WHEN THE SEARCH FINDS NOTHING, the dropdown offers "Add a New Institution",
 * exactly as production's does. It opens AddInstitutionInline — the SAME flat
 * form Add Classroom opens from its own School dropdown, reused rather than
 * reimplemented, so a school registered from here is identical to one registered
 * from there. Without it this step dead-ends: a teacher whose school is not yet
 * on file would have to abandon the wizard, go to Institutions, register it, and
 * start over.
 *
 * THIS PAGE OWNS THE WRITE. Add Classroom has to pass its draft up to the
 * Classrooms page because it is a modal; this is the page, so it calls
 * InstitutionService itself and patches its own list.
 *
 * ZONELESS. The institution list arrives after an `await`; a plain field written
 * in a promise continuation notifies the change detection scheduler of nothing,
 * so everything the template reads is a signal.
 */
@Component({
  selector: 'app-setup-wizard',
  imports: [Icon, NgTemplateOutlet, AddInstitutionInline, AddTeachers, BulkUploadSchools],
  templateUrl: './setup-wizard.html',
  styleUrl: './setup-wizard.css'
})
export class SetupWizard implements OnInit, OnDestroy {

  private institutionService = inject(InstitutionService);
  private teacherService = inject(TeacherService);
  private programmeService = inject(ProgrammeService);

  readonly steps = SETUP_WIZARD_STEPS;
  readonly countries = COUNTRIES;
  readonly boards = BOARDS;

  readonly step = signal<number>(FIRST_STEP);

  /**
   * Bulk Upload Schools.
   *
   * Off is the default and the state the single-school form belongs to, exactly
   * as production opens. Flipping it swaps the form for the bulk panel rather
   * than adding a second one below it, because the two are alternatives: a run
   * of the wizard either picks one existing school or imports a sheet of them.
   */
  readonly bulkUpload = signal(false);

  // ---- Step 1 fields ------------------------------------------------------
  //
  // Four signals rather than one draft object, because unlike the institution
  // forms these are not a document being built — they are a QUERY, and three of
  // the four are thrown away once a school is chosen.

  readonly country = signal(DEFAULT_COUNTRY);
  readonly pincode = signal('');
  readonly board = signal('');
  /** The chosen institution's docId, or '' — never its name, which is not unique. */
  readonly school = signal('');

  /** Institutions this teacher owns, the pool Select School is filtered from. */
  private readonly institutions = signal<Institution[]>([]);

  readonly loading = signal(true);
  readonly loadError = signal('');

  /**
   * Which controls the user has left, and whether Continue has been pressed.
   *
   * Errors are driven by these rather than by emptiness alone, because a required
   * field is empty before the user has typed anything and painting the form red
   * on first paint tells them off for nothing.
   */
  private readonly blurred = signal<ReadonlySet<string>>(new Set());
  private readonly submitted = signal(false);

  /**
   * The reserved Select School value that opens the inline form.
   *
   * A native <select> cannot hold a button, and production puts this entry
   * INSIDE the dropdown rather than beside it, so the way out of an empty search
   * is where the user is already looking. Double-underscored so it cannot
   * collide with a Firestore document id.
   */
  static readonly ADD_INSTITUTION = '__add_institution__';
  readonly addInstitutionValue = SetupWizard.ADD_INSTITUTION;

  /** Teachers registered so far in this run, as they came back from Firestore. */
  readonly teachers = signal<Teacher[]>([]);

  /**
   * Every teacher this admin already had, plus the ones added during this run.
   *
   * WHAT THE PHONE LOOKUP SEARCHES. Kept up to date as teachers are registered,
   * so typing the same number twice in one sitting recognises it the second time
   * rather than only after a reload.
   */
  readonly registered = signal<Teacher[]>([]);

  readonly savingTeachers = signal(false);
  readonly teacherError = signal('');

  /** The whole catalogue this admin owns; step 2's control narrows it. */
  private readonly programmes = signal<Programme[]>([]);

  /**
   * The programmes step 2 may assign, as {id, name} for the control.
   *
   * THREE FILTERS, each load-bearing:
   *   institutionId  a programme belongs to one school, and this run is for one
   *                  school — offering another school's would file a teacher
   *                  against a class that does not exist there.
   *   type REGULAR   Add Teachers is about classroom teachers, and a STEM-CLUB
   *                  programme is not something one of them takes.
   *                  programmeTypeFor() already encodes the pairing, and it is
   *                  what a STEM club step would filter on instead.
   *   status LIVE    production filters the same way; a programme still in
   *                  development is not something to assign a teacher to.
   */
  readonly assignableProgrammes = computed(() =>
    this.programmes()
      .filter(programme =>
        programme.institutionId === this.school() &&
        programme.type === 'REGULAR' &&
        programme.programmeStatus === 'LIVE'
      )
      .sort((a, b) => (a.displayName || a.programmeName).localeCompare(b.displayName || b.programmeName))
      .map(programme => ({ id: programme.docId, name: programme.displayName || programme.programmeName }))
  );

  /** The dial code step 2's phone prefix shows, from step 1's country. */
  readonly dialCode = computed(() => dialFor(this.country()));

  /** The nested Add a New Institution form. */
  readonly creatingInstitution = signal(false);
  readonly saving = signal(false);
  readonly saveError = signal('');
  /**
   * The success toast's message, or ''.
   *
   * A TOAST, not a line in the form. It confirms something that has already
   * happened and then gets out of the way, so it is fixed to the viewport rather
   * than in the flow — the same treatment Institutions, Classrooms and Learning
   * Units already give their confirmations, down to the four-second timeout.
   */
  readonly notice = signal('');
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  /**
   * The page's initial read, as its own awaitable method.
   *
   * Separated from ngOnInit so a test can await it directly. `whenStable()` does
   * not cover an async ngOnInit — the scheduler has nothing to track once the
   * hook returns its promise — so asserting on what the load produced was a race
   * that only showed up once this grew a second await.
   */
  async load(): Promise<void> {
    /**
     * allSettled, not all. The institutions are step 1 and the page is unusable
     * without them; the programme catalogue is step 2's and can fail without
     * blocking the institution choice — so a failing catalogue must not take the
     * whole page down with it. Step 2 says so itself when the list is empty.
     */
    const [institutions, programmes, teachers] = await Promise.allSettled([
      this.institutionService.list(),
      this.programmeService.list(),
      this.teacherService.list()
    ]);

    if (institutions.status === 'fulfilled') {
      this.institutions.set(institutions.value);
    } else {
      this.loadError.set(
        this.institutionService.describeError(
          institutions.reason, 'Could not load your institutions.'
        )
      );
    }

    if (programmes.status === 'fulfilled') {
      this.programmes.set(programmes.value);
    }

    /**
     * The pool step 2's phone lookup matches against. Failing to load it is not
     * fatal either: the lookup simply recognises nobody, and the step behaves as
     * it did before the feature existed.
     */
    if (teachers.status === 'fulfilled') {
      this.registered.set(teachers.value);
    }

    this.loading.set(false);
  }

  // ---- Progressive unlocking ----------------------------------------------

  /**
   * The unlock chain, rebuilt from current values on every read.
   *
   * `filled` for pincode is COMPLETENESS, not merely non-emptiness: Board must
   * not open on a third digit, because the school list it feeds cannot be
   * meaningful until the whole code is there.
   */
  private readonly chain = computed<FlowField[]>(() => {
    /**
     * BULK MODE HAS NO PINCODE, so it must not be in the chain.
     *
     * Leaving it there locked Board for ever: the pincode field is not rendered
     * in bulk mode, so nothing could fill it, and every control after it stayed
     * shut. The chain has to describe the controls actually on screen.
     */
    if (this.bulkUpload()) {
      return [
        { name: 'country', filled: !!this.country() },
        { name: 'board', filled: !!this.board() }
      ];
    }

    return [
      { name: 'country', filled: !!this.country() },
      { name: 'pincode', filled: isCompletePincode(this.pincode(), this.country()) },
      { name: 'board', filled: !!this.board() },
      { name: 'school', filled: !!this.school() }
    ];
  });

  locked(name: StepOneField): boolean {
    return isFieldLocked(this.chain(), name);
  }

  // ---- The school list ----------------------------------------------------

  /**
   * The institutions matching the country, pincode and board above.
   *
   * Empty until the pincode is complete, so the control does not flash a full
   * list and then narrow it as the user types the code that was meant to narrow it.
   */
  readonly matchingSchools = computed<Institution[]>(() => {
    if (!isCompletePincode(this.pincode(), this.country()) || !this.board()) {
      return [];
    }

    const pincode = this.pincode().trim();

    return this.institutions()
      .filter(institution =>
        institution.institutionAddress.country === this.country() &&
        institution.institutionAddress.pincode.trim() === pincode &&
        institution.board === this.board()
      )
      .sort((a, b) => a.institutionName.localeCompare(b.institutionName));
  });

  /**
   * The search ran and matched nothing.
   *
   * Distinguished from "not searched yet" so the control can say so. Without it
   * an empty list reads as a broken lookup, which is the complaint the pincode
   * completeness check above exists to prevent.
   */
  readonly noMatches = computed(() =>
    !this.loading() &&
    !this.locked('school') &&
    this.matchingSchools().length === 0
  );

  readonly selectedSchool = computed<Institution | undefined>(() =>
    this.matchingSchools().find(institution => institution.docId === this.school())
  );

  // ---- Validation ---------------------------------------------------------

  /** Whether this control should currently be drawn as an error. */
  isMissing(field: StepOneField): boolean {
    if (!this.blurred().has(field) && !this.submitted()) {
      return false;
    }

    return !this.chain().find(item => item.name === field)?.filled;
  }

  errorFor(field: StepOneField): string {
    return STEP_ONE_ERRORS[field];
  }

  readonly stepOneComplete = computed(() => this.chain().every(field => field.filled));

  /**
   * Continue is DEAD until step 1 is completely filled in.
   *
   * Reversed on instruction, and it is worth recording what changed with it. This
   * button used to stay clickable while the form was incomplete, because pressing
   * it was how the user asked what was left — `next()` marks the form submitted,
   * which paints the outstanding control red. Greying it out removes that route,
   * so the ONLY thing that now reveals a missing field is leaving it: every
   * control still calls markBlurred on blur, and that is what has to carry the
   * explaining. Production greys this button too.
   *
   * Also dead while the institution list is loading, and while Bulk Upload is on
   * — in both cases there is genuinely nothing to advance to.
   */
  readonly canPressContinue = computed(() =>
    !this.loading() && !this.bulkUpload() && this.stepOneComplete()
  );

  // ---- Actions ------------------------------------------------------------

  setCountry(value: string): void {
    this.country.set(value);
    // The pincode format and the school list are both country-dependent, so a
    // country change invalidates everything below it rather than leaving a
    // six-digit Indian code sitting under a newly-chosen Germany.
    this.pincode.set('');
    this.board.set('');
    this.school.set('');
  }

  setPincode(value: string): void {
    this.pincode.set(toPincodeDigits(value, this.country()));
    // Narrowing the search cannot leave a school selected that the new search
    // may not return.
    this.school.set('');
  }

  setBoard(value: string): void {
    this.board.set(value);
    this.school.set('');
  }

  setSchool(value: string): void {
    /**
     * The sentinel is not a school — it opens the form instead.
     *
     * The selection is left where it was rather than moved to the sentinel, so
     * cancelling the form returns to whatever was chosen before it opened
     * instead of a control reading "Add a New Institution" as its value.
     */
    if (value === SetupWizard.ADD_INSTITUTION) {
      this.saveError.set('');
      this.creatingInstitution.set(true);
      return;
    }

    this.school.set(value);
  }

  /**
   * The School select's change handler, and the reason it takes the EVENT rather
   * than the value.
   *
   * A native <select> moves itself to whatever option was clicked before any
   * handler runs, and `[selected]` bindings do not pull it back — Angular only
   * sets that attribute while building the option list. So choosing the sentinel
   * left the control READING "+ Add a New Institution" while `school` was
   * correctly empty: cancelling the form returned the user to a dropdown that
   * appeared to have a school chosen, and Continue then refused to advance with
   * no visible reason.
   *
   * Putting the element back is done here, on the element itself, because that
   * disagreement is between the DOM and the signal and nothing declarative can
   * see it.
   */
  onSchoolChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const value = select.value;

    this.setSchool(value);

    if (value === SetupWizard.ADD_INSTITUTION) {
      select.value = this.school();
    }
  }

  closeInstitutionForm(): void {
    this.creatingInstitution.set(false);
    this.saveError.set('');
  }

  /**
   * Registers the school the teacher just described, and selects it.
   *
   * SAME collection, same service, same InstitutionDraft the three-step Add
   * Institution wizard produces — nothing about the schema, the rules or the
   * trash changes to support this. The only difference is where the form opened.
   *
   * The search is then SYNCED TO THE NEW SCHOOL rather than the other way round.
   * The inline form deliberately leaves pincode editable — a mistyped pincode is
   * exactly why the search may have found nothing — so the school that comes back
   * need not match the pincode that was searched on. Moving the search to it is
   * what makes it appear in the list and stay selected; leaving the search alone
   * would file the school correctly and then hide it.
   */
  async createInstitution(draft: InstitutionDraft): Promise<void> {
    if (this.saving()) {
      return;
    }

    this.saving.set(true);
    this.saveError.set('');

    try {
      const created = await this.institutionService.create(draft);

      this.institutions.update(list => [created, ...list]);
      this.pincode.set(created.institutionAddress.pincode.trim());
      this.board.set(created.board);
      this.school.set(created.docId);
      this.creatingInstitution.set(false);
      this.flashNotice(`${created.institutionName} registered successfully`);
    } catch (error) {
      // Leave the form open, so nothing the user typed is lost.
      this.saveError.set(
        this.institutionService.describeError(error, 'Could not register the school.')
      );
    } finally {
      this.saving.set(false);
    }
  }

  toggleBulkUpload(): void {
    this.bulkUpload.update(on => !on);
  }

  markBlurred(field: StepOneField): void {
    this.blurred.update(current => new Set(current).add(field));
  }

  next(): void {
    this.submitted.set(true);

    if (!this.stepOneComplete()) {
      return;
    }

    this.submitted.set(false);
    this.step.update(current => Math.min(current + 1, LAST_STEP));
  }

  back(): void {
    this.step.update(current => Math.max(current - 1, FIRST_STEP));
  }

  /**
   * Jumps to an EARLIER step from the stepper.
   *
   * Backwards only. The reference draws a pencil on a completed step, which
   * invites a click, but letting that skip FORWARD would land the user on Add
   * Teachers with no institution chosen — the thing step 1's validation exists to
   * prevent. A step at or beyond the current one is ignored.
   */
  goToStep(index: number): void {
    if (index >= this.step() || index < FIRST_STEP) {
      return;
    }

    this.submitted.set(false);
    this.step.set(index);
  }

  /**
   * Registers step 2's rows against the institution chosen in step 1.
   *
   * institutionId comes from `school()`, NOT from the form: the wizard is the
   * only thing that knows which school this run is for, and a form-supplied one
   * would be a value the user could point anywhere.
   *
   * ON PARTIAL FAILURE the teachers that did land are kept. createMany writes
   * sequentially and attaches what it managed to `created`, so the count stays
   * truthful rather than resetting to zero and inviting a re-submit that would
   * duplicate them.
   */
  async addTeachers(entries: TeacherEntry[]): Promise<void> {
    if (this.savingTeachers()) {
      return;
    }

    this.savingTeachers.set(true);
    this.teacherError.set('');

    const byId = new Map(this.assignableProgrammes().map(option => [option.id, option.name]));

    const drafts: TeacherDraft[] = entries.map(entry => ({
      institutionId: this.school(),
      firstName: entry.firstName.trim(),
      lastName: entry.lastName.trim(),
      email: entry.email.trim(),
      countryCode: this.dialCode(),
      phoneNumber: entry.phone,
      role: entry.role,
      // Snapshot of each name at assignment time, resolved here because the form
      // only ever holds ids. A programme later renamed does not rewrite these.
      classes: entry.classes.map(row => ({
        grade: row.grade,
        section: row.section,
        programmeId: row.programmeId,
        programmeName: byId.get(row.programmeId) ?? ''
      })),
      active: true
    }));

    try {
      /**
       * SPLIT BY WHETHER THE PHONE WAS RECOGNISED.
       *
       * An entry carrying `existingId` is somebody who already has a document, so
       * its classes are appended to them; writing a second teacher with the same
       * phone number is exactly what the lookup exists to prevent. Everything
       * else is a new teacher.
       */
      const saved: Teacher[] = [];

      for (const [index, entry] of entries.entries()) {
        const existing = entry.existingId
          ? this.registered().find(teacher => teacher.docId === entry.existingId)
          : undefined;

        saved.push(
          existing
            ? await this.teacherService.appendClasses(existing, drafts[index].classes)
            : (await this.teacherService.createMany([drafts[index]]))[0]
        );
      }

      this.teachers.update(current => [...current, ...saved]);
      this.rememberRegistered(saved);
      this.flashNotice(registeredMessage(saved));
    } catch (error) {
      const partial = (error as { created?: Teacher[] }).created ?? [];

      this.teachers.update(current => [...current, ...partial]);
      this.rememberRegistered(partial);
      this.teacherError.set(
        this.teacherService.describeError(error, 'Could not register those teachers.')
      );
    } finally {
      this.savingTeachers.set(false);
    }
  }

  /**
   * Folds saved teachers into the lookup pool, replacing rather than appending
   * when the document is already there — otherwise a teacher who had classes
   * added would appear twice and the lookup could match the stale copy.
   */
  private rememberRegistered(saved: readonly Teacher[]): void {
    if (saved.length === 0) {
      return;
    }

    this.registered.update(current => {
      const byId = new Map(current.map(teacher => [teacher.docId, teacher]));

      for (const teacher of saved) {
        byId.set(teacher.docId, teacher);
      }

      return [...byId.values()];
    });
  }

  // ---- The success toast --------------------------------------------------

  /**
   * Shows a message and takes it away again after four seconds.
   *
   * Any outstanding timer is cleared first, so two registrations in quick
   * succession do not have the first one's timeout hiding the second one's
   * message early.
   */
  private flashNotice(message: string): void {
    if (this.noticeTimer !== null) {
      clearTimeout(this.noticeTimer);
    }

    this.notice.set(message);

    this.noticeTimer = setTimeout(() => {
      this.notice.set('');
      this.noticeTimer = null;
    }, 4000);
  }

  dismissNotice(): void {
    if (this.noticeTimer !== null) {
      clearTimeout(this.noticeTimer);
      this.noticeTimer = null;
    }

    this.notice.set('');
  }

  /**
   * Clears any pending timeout.
   *
   * Without this, leaving the wizard within four seconds of a registration
   * leaves a timer that fires into a destroyed component. Harmless today, but it
   * is the kind of thing that becomes a leak the moment the callback grows.
   */
  ngOnDestroy(): void {
    if (this.noticeTimer !== null) {
      clearTimeout(this.noticeTimer);
      this.noticeTimer = null;
    }
  }

  /** Reading a control's value in a template without casting the event inline. */
  valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }
}

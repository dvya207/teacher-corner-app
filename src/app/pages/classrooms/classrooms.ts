import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';

import { Icon } from '../../components/icon/icon';
import { classroomTitle, classroomTypeLabel } from '../../data/classroom-options';
import {
  Classroom,
  ClassroomDraft,
  Institution,
  InstitutionDraft,
  LearningUnit,
  Programme,
  ProgrammeDraft,
  TrashedClassroom
} from '../../models/teaching.model';
import { ClassroomService } from '../../services/classroom.service';
import { InstitutionService } from '../../services/institution.service';
import { LearningUnitService } from '../../services/learning-unit.service';
import { ProgrammeService } from '../../services/programme.service';
import { AddClassroom } from './add-classroom';
import { EditClassroom } from './edit-classroom';

export type ClassroomFilter = 'All' | 'Classrooms' | 'STEM Clubs';

/**
 * Classrooms — the classroom and STEM club table.
 *
 * Deliberately the same shape as the Institutions page: stat cards, filter
 * pills, one table, a full-screen Trash overlay, and modals owned here rather
 * than by the components that render them. Two admin tables that behave
 * differently for no reason are worse than two that behave identically.
 *
 * THIS PAGE OWNS EVERY WRITE. The modals collect and emit; the Firestore calls
 * all happen here. That is what lets a failed save leave a modal open with the
 * user's input intact, and it keeps one copy of each list rather than one per
 * component.
 *
 * ZONELESS. Lists arrive after an `await`, and a plain field assigned in a
 * promise continuation notifies the change detection scheduler of nothing — the
 * write would land on the component and never reach the DOM. Everything the
 * template reads that is mutated post-await is a signal.
 */
@Component({
  selector: 'app-classrooms',
  imports: [DatePipe, Icon, AddClassroom, EditClassroom],
  templateUrl: './classrooms.html',
  styleUrl: './classrooms.css'
})
export class Classrooms implements OnInit {

  private service = inject(ClassroomService);
  private institutionService = inject(InstitutionService);
  private programmeService = inject(ProgrammeService);
  private learningUnitService = inject(LearningUnitService);

  readonly classrooms = signal<Classroom[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');

  /**
   * The two lists the Add form needs, loaded alongside the classrooms.
   *
   * Held here rather than fetched by the modal, so opening Add Classroom is
   * instant and the same catalogue serves both modals.
   */
  readonly institutions = signal<Institution[]>([]);
  readonly programmes = signal<Programme[]>([]);

  /**
   * Why the programme catalogue is empty, when the read itself failed.
   *
   * load() uses allSettled and falls back to [], which is right — losing the
   * catalogue must not blank the classrooms table. But it also made a denied
   * read indistinguishable from an empty catalogue inside the picker, so the
   * reason is kept and handed to the modal.
   */
  readonly catalogueError = signal('');

  /**
   * The learning units catalogue, for the locking dialog's unit names.
   *
   * Loaded here with everything else rather than by the dialog, so opening it is
   * instant and one read serves every programme in the modal. A failure is
   * tolerated: the dialog falls back to showing unit ids, which is worse but not
   * broken, and nothing else on this page depends on it.
   */
  readonly learningUnits = signal<LearningUnit[]>([]);

  /**
   * Read from classrooms/trash/DeletedClassrooms, NOT derived from the list
   * above. Two independent queries against different collections: an empty
   * active list says nothing about the trash.
   */
  readonly trashed = signal<TrashedClassroom[]>([]);
  readonly trashLoading = signal(false);
  readonly trashError = signal('');

  readonly filters: ClassroomFilter[] = ['All', 'Classrooms', 'STEM Clubs'];
  readonly activeFilter = signal<ClassroomFilter>('All');

  /**
   * Page-local search.
   *
   * Not wired to the topbar field, which is decorative today — the Institutions
   * page has the same unconnected signal. Connecting the two is a shell change
   * that would alter both pages, so it is left alone here rather than done
   * halfway.
   */
  readonly searchQuery = signal('');

  /** The reference calls this "Hide Stats"; it hides the stat cards. */
  readonly statsHidden = signal(false);

  readonly showAdd = signal(false);
  readonly saving = signal(false);
  /** Save failures raised while a modal is open, rendered INSIDE it. */
  readonly modalError = signal('');

  /** The classroom whose programmes are open for editing, or null. */
  readonly editing = signal<Classroom | null>(null);

  /**
   * The school just created from inside Add Classroom, or null.
   *
   * Passed back DOWN so the modal can select it: the teacher asked for a school
   * mid-classroom, so they should land back on the classroom form with it
   * already chosen rather than having to search for it a second time.
   */
  readonly createdInstitution = signal<Institution | null>(null);

  readonly notice = signal('');
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  readonly trashOpen = signal(false);
  /** Emptying the Trash is irreversible and bulk, so it takes two clicks. */
  readonly confirmingEmpty = signal(false);

  /** The classroom the delete confirmation is open for, or null. */
  readonly confirmingDelete = signal<Classroom | null>(null);

  /** Row id currently being deleted, so only it shows a busy state. */
  readonly busyRow = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  /**
   * Loads the four lists in parallel.
   *
   * allSettled, not all: the classrooms are the page, and the other three only
   * feed the modals. A permissions failure on the catalogue should degrade Add
   * Classroom, not blank the table the teacher came to read.
   */
  async load(): Promise<void> {
    this.loading.set(true);

    const [classrooms, institutions, programmes, learningUnits] = await Promise.allSettled([
      this.service.list(),
      this.institutionService.list(),
      this.programmeService.list(),
      this.learningUnitService.list()
    ]);

    if (classrooms.status === 'fulfilled') {
      this.classrooms.set(classrooms.value);
      this.error.set('');
    } else {
      this.error.set(this.service.describeError(classrooms.reason, 'Could not load classrooms.'));
    }

    this.institutions.set(institutions.status === 'fulfilled' ? institutions.value : []);

    if (programmes.status === 'fulfilled') {
      this.programmes.set(programmes.value);
      this.catalogueError.set('');
    } else {
      this.programmes.set([]);
      this.catalogueError.set(
        this.service.describeError(programmes.reason, 'Could not load the programme catalogue.')
      );
    }

    this.learningUnits.set(learningUnits.status === 'fulfilled' ? learningUnits.value : []);

    this.loading.set(false);
  }

  // ---- Stats -------------------------------------------------------------

  /**
   * One pass, memoised, rather than three filters re-run on every change
   * detection cycle. Derived from the loaded array — no aggregation query is
   * issued for a count already in hand.
   *
   * "Anything not a classroom is a club" rather than an equality test on
   * 'STEM-CLUB', matching production, so the two counts always sum to the total
   * even for a row with a type this app does not recognise.
   */
  private readonly stats = computed(() => {
    const counts = { total: 0, regular: 0, club: 0 };

    for (const classroom of this.classrooms()) {
      counts.total++;

      if (classroom.type === 'CLASSROOM') {
        counts.regular++;
      } else {
        counts.club++;
      }
    }

    return counts;
  });

  readonly totalCount = computed(() => this.stats().total);
  readonly regularCount = computed(() => this.stats().regular);
  readonly clubCount = computed(() => this.stats().club);

  /**
   * A computed rather than a getter: the template reads it for the count, the
   * @if and the @for, and a getter would re-run the whole filter on each of
   * those, on every change detection pass.
   */
  readonly filtered = computed(() => {
    const needle = this.searchQuery().trim().toLowerCase();
    const filter = this.activeFilter();

    return this.classrooms().filter(classroom => {
      const matchesFilter =
        filter === 'All' ||
        (filter === 'Classrooms' && classroom.type === 'CLASSROOM') ||
        (filter === 'STEM Clubs' && classroom.type !== 'CLASSROOM');

      if (!matchesFilter) {
        return false;
      }

      return !needle ||
        this.title(classroom).toLowerCase().includes(needle) ||
        classroom.institutionName.toLowerCase().includes(needle) ||
        classroom.classroomId.toLowerCase().includes(needle) ||
        this.programmeNames(classroom).toLowerCase().includes(needle);
    });
  });

  // ---- Row helpers -------------------------------------------------------

  /** "8 B" for a classroom, the club's name for a club. */
  title(classroom: Classroom): string {
    return classroomTitle(classroom);
  }

  typeLabel(classroom: Classroom): string {
    return classroomTypeLabel(classroom.type);
  }

  /**
   * The Programmes cell: every attached programme's display name, joined.
   *
   * Production logs an error for a classroom with no programmes map. This
   * returns an empty string and lets the template show a dash — a classroom
   * whose programmes were all removed is a state the UI can produce, so it is
   * not an error condition.
   */
  programmeNames(classroom: Classroom): string {
    return Object.values(classroom.programmes ?? {})
      .map(programme => programme.displayName || programme.programmeName)
      .join(', ');
  }

  /** The id column shows a prefix; the full value is the title attribute. */
  shortId(classroom: Classroom): string {
    return classroom.classroomId.slice(0, 8);
  }

  /** Firestore Timestamps need converting before the DatePipe sees them. */
  toDate(value: { toDate?: () => Date } | null | undefined): Date | null {
    return value?.toDate ? value.toDate() : null;
  }

  setFilter(filter: ClassroomFilter): void {
    this.activeFilter.set(filter);
  }

  toggleStats(): void {
    this.statsHidden.update(hidden => !hidden);
  }

  // ---- Add ---------------------------------------------------------------

  openAdd(): void {
    this.modalError.set('');
    // Cleared on open, not on close: a stale value would make the modal select
    // last time's school the moment it renders.
    this.createdInstitution.set(null);
    this.showAdd.set(true);
  }

  closeAdd(): void {
    this.showAdd.set(false);
    this.modalError.set('');
  }

  /**
   * Creates a school on behalf of the Add Classroom modal.
   *
   * Writes to the SAME institutions collection, through the same service, with
   * the same InstitutionDraft the three-step wizard produces — so nothing about
   * the institution schema, rules or trash changes to support this. The only
   * difference is where the form was opened from.
   *
   * The new school is appended to the list this page already holds, so the
   * modal's School dropdown finds it without a reload, and handed back through
   * `createdInstitution` so the modal can select it.
   */
  async createInstitution(draft: InstitutionDraft): Promise<void> {
    if (this.saving()) {
      return;
    }

    this.saving.set(true);
    this.modalError.set('');

    try {
      const created = await this.institutionService.create(draft);

      this.institutions.update(list => [created, ...list]);
      this.createdInstitution.set(created);
      this.flashNotice(`${created.institutionName} registered`);
    } catch (error) {
      // Leave both forms open, so nothing the user typed is lost.
      this.modalError.set(
        this.institutionService.describeError(error, 'Could not register the school.')
      );
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * The write. Patches the local list rather than re-reading the collection:
   * create() resolves the complete document it just committed, so a reload
   * would be a second round trip to learn something already in hand.
   *
   * The current list is passed through, because that is what the next
   * per-institution classroomCode is computed from.
   */
  async saveClassroom(draft: ClassroomDraft): Promise<void> {
    if (this.saving()) {
      return;
    }

    this.saving.set(true);
    this.modalError.set('');

    try {
      const created = await this.service.create(draft, this.classrooms());

      this.classrooms.update(list => [created, ...list]);
      this.showAdd.set(false);
      this.error.set('');
      this.flashNotice(
        created.type === 'STEM-CLUB'
          ? `${created.stemClubName} STEM club created successfully`
          : `${created.classroomName} classroom created successfully`
      );

    } catch (error) {
      // Leave the modal open, so nothing the user entered is lost on a failure.
      this.modalError.set(this.service.describeError(error, 'Could not create the classroom.'));
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Creates a catalogue programme on behalf of the Add form.
   *
   * The form asks rather than writes, so the new programme lands in the list
   * this page already holds and flows straight back down as an input — the
   * picker shows it without a reload and without a second copy of the catalogue.
   */
  async createProgramme(draft: ProgrammeDraft): Promise<void> {
    if (this.saving()) {
      return;
    }

    this.saving.set(true);
    this.modalError.set('');

    try {
      // The catalogue is passed through because it seeds the code counter the
      // first time this teacher creates a programme.
      const created = await this.programmeService.create(draft, this.programmes());

      this.programmes.update(list =>
        [...list, created].sort((a, b) => a.programmeName.localeCompare(b.programmeName))
      );
      this.flashNotice(`Programme "${created.programmeName}" created as ${created.programmeCode}`);
    } catch (error) {
      this.modalError.set(this.service.describeError(error, 'Could not create the programme.'));
    } finally {
      this.saving.set(false);
    }
  }

  // ---- Manage programmes -------------------------------------------------

  openEdit(classroom: Classroom): void {
    this.modalError.set('');
    this.editing.set(classroom);
  }

  closeEdit(): void {
    this.editing.set(null);
    this.modalError.set('');
  }

  /**
   * Saves the tabbed editor.
   *
   * ONE write for both tabs. The modal emits whichever fields changed — grade
   * and section from Basic Info, the programmes map from the Programmes tab, or
   * both — and update() sends exactly those. An earlier version had a
   * programmes-only path (setProgrammes) because that was the only thing the
   * modal could change; a second method for one field would now be a narrower
   * duplicate of this one.
   */
  async saveEdit(patch: Partial<Classroom>): Promise<void> {
    const target = this.editing();

    if (!target || this.saving()) {
      return;
    }

    this.saving.set(true);
    this.modalError.set('');

    try {
      await this.service.update(target.docId, patch);

      // The table first, so the row behind the modal is already correct by the
      // time the modal closes and reveals it.
      this.classrooms.update(list =>
        list.map(row => (row.docId === target.docId ? { ...row, ...patch } : row))
      );

      this.editing.set(null);
      this.flashNotice(`${this.title({ ...target, ...patch } as Classroom)} updated`);
    } catch (error) {
      // Stays open, with the message inside it and the user's edits intact.
      this.modalError.set(this.service.describeError(error, 'Could not save the changes.'));
    } finally {
      this.saving.set(false);
    }
  }

  // ---- Notices -----------------------------------------------------------

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

  // ---- Trash -------------------------------------------------------------

  async openTrash(): Promise<void> {
    this.trashOpen.set(true);
    await this.loadTrash();
  }

  async loadTrash(): Promise<void> {
    this.trashLoading.set(true);

    try {
      this.trashed.set(await this.service.listTrash());
      this.trashError.set('');
    } catch (error) {
      this.trashError.set(this.service.describeError(error, 'Could not load the Trash.'));
    } finally {
      this.trashLoading.set(false);
    }
  }

  closeTrash(): void {
    this.trashOpen.set(false);
    this.confirmingEmpty.set(false);
  }

  /**
   * The table's delete button. The row MOVES to the trash collection.
   *
   * The local lists are updated from what the transaction actually returned,
   * not from an assumption about what it did — so if it aborted, nothing here
   * moved either.
   */
  askDelete(classroom: Classroom): void {
    this.confirmingDelete.set(classroom);
  }

  cancelDelete(): void {
    this.confirmingDelete.set(null);
  }

  /**
   * Moves the confirmed classroom to the Trash.
   *
   * The lists are updated from what the service RETURNS rather than from an
   * assumption about what it did, so an aborted transaction moves nothing here.
   */
  async confirmDelete(): Promise<void> {
    const target = this.confirmingDelete();

    if (!target) {
      return;
    }

    await this.rowAction(target.docId, 'Could not move the classroom to Trash.', async () => {
      const trashed = await this.service.moveToTrash(target.docId);

      this.classrooms.update(list => list.filter(row => row.docId !== target.docId));
      this.trashed.update(list => [trashed, ...list]);
      this.flashNotice(`${this.title(target)} moved to Trash`);

    });

    // Closed either way: on failure the message is on the page behind, and the
    // dialog would cover it.
    this.confirmingDelete.set(null);
  }

  async restore(classroom: TrashedClassroom): Promise<void> {
    await this.rowAction(classroom.docId, 'Could not restore the classroom.', async () => {
      const restored = await this.service.restore(classroom.docId);

      this.trashed.update(list => list.filter(row => row.docId !== classroom.docId));
      this.classrooms.update(list => [restored, ...list]);

      this.flashNotice(`${this.title(restored)} restored`);
    });
  }

  /** Permanent, single row. Only reachable from the Trash. */
  async purge(classroom: TrashedClassroom): Promise<void> {
    await this.rowAction(classroom.docId, 'Could not delete the classroom.', async () => {
      await this.service.purge(classroom.docId);
      this.trashed.update(list => list.filter(row => row.docId !== classroom.docId));
    });
  }

  /** Permanent, everything in the Trash. Guarded by the two-click confirm. */
  async emptyTrash(): Promise<void> {
    if (!this.confirmingEmpty()) {
      this.confirmingEmpty.set(true);
      return;
    }

    const ids = this.trashed().map(row => row.docId);

    if (ids.length === 0) {
      this.confirmingEmpty.set(false);
      return;
    }

    this.busyRow.set('__all__');

    try {
      await this.service.purgeAll(ids);
      this.trashed.set([]);
      this.confirmingEmpty.set(false);
    } catch (error) {
      this.trashError.set(this.service.describeError(error, 'Could not empty the Trash.'));
      // A partial failure leaves the local list untrustworthy, so re-read
      // rather than guessing which deletes landed.
      await this.loadTrash();
    } finally {
      this.busyRow.set(null);
    }
  }

  /**
   * Shared guard, busy-state and error handling for the per-row actions.
   *
   * Routes the message to whichever surface is actually VISIBLE. Restore and
   * per-row Delete are reachable only from the Trash overlay, which covers the
   * page banner `error` renders in — so writing there would leave a failed
   * restore completely silent. Same reasoning as the modals' separate error
   * signal.
   */
  private async rowAction(id: string, fallback: string, run: () => Promise<void>): Promise<void> {
    if (this.busyRow()) {
      return;
    }

    this.busyRow.set(id);

    try {
      await run();
    } catch (error) {
      const message = this.service.describeError(error, fallback);

      if (this.trashOpen()) {
        this.trashError.set(message);
      } else {
        this.error.set(message);
      }
    } finally {
      this.busyRow.set(null);
    }
  }
}

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';

import { Icon } from '../../components/icon/icon';
import {
  isActiveStatus,
  programmeTypeLabel,
  rangeLabel,
  scopeOf,
  statusLabel
} from '../../data/programme-options';
import {
  Classroom,
  Institution,
  Programme,
  ProgrammeDraft,
  TrashedProgramme
} from '../../models/teaching.model';
import { ClassroomService } from '../../services/classroom.service';
import { InstitutionService } from '../../services/institution.service';
import { ProgrammeService } from '../../services/programme.service';
import { AddProgramme } from './add-programme';
import { EditProgramme } from './edit-programme';

export type ProgrammeFilter = 'All' | 'Active' | 'Draft';

/**
 * Programme — the programme catalogue.
 *
 * The third table in this app built to the same pattern as Institutions and
 * Classrooms: stat cards, filter pills, one table, a full-screen Trash overlay,
 * and every Firestore write owned here rather than by the modals.
 *
 * ZONELESS. Everything the template reads that is mutated after an `await` is a
 * signal.
 */
@Component({
  selector: 'app-programme',
  imports: [DatePipe, Icon, AddProgramme, EditProgramme],
  templateUrl: './programme.html',
  styleUrl: './programme.css'
})
export class ProgrammePage implements OnInit {

  private service = inject(ProgrammeService);
  private institutionService = inject(InstitutionService);
  private classroomService = inject(ClassroomService);

  readonly programmes = signal<Programme[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');

  /** Feeds the wizard's school picker. */
  readonly institutions = signal<Institution[]>([]);

  /**
   * The teacher's classrooms, loaded for ONE reason: deleting a programme has to
   * detach it from every classroom carrying it, and that needs the list of which
   * classrooms those are.
   */
  readonly classrooms = signal<Classroom[]>([]);

  readonly trashed = signal<TrashedProgramme[]>([]);
  readonly trashLoading = signal(false);
  readonly trashError = signal('');

  readonly filters: ProgrammeFilter[] = ['All', 'Active', 'Draft'];
  readonly activeFilter = signal<ProgrammeFilter>('All');

  /** Page-local, as on the other two tables — the topbar field is not wired. */
  readonly searchQuery = signal('');
  readonly statsHidden = signal(false);

  readonly showAdd = signal(false);
  readonly saving = signal(false);
  readonly modalError = signal('');

  readonly notice = signal('');
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  readonly trashOpen = signal(false);
  readonly confirmingEmpty = signal(false);
  readonly busyRow = signal<string | null>(null);

  /**
   * The programme awaiting a delete confirmation, or null.
   *
   * Deleting a programme is not like deleting a classroom: it also strips the
   * programme from every classroom using it, and a restore does NOT put those
   * back. That is worth a sentence the user has to read, so this one opens a
   * confirmation rather than acting on the first click.
   */
  readonly confirmingDelete = signal<Programme | null>(null);

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  /**
   * allSettled, not all: the programmes are the page. A permissions failure on
   * the institutions or classrooms should degrade the wizard and the delete
   * cascade, not blank the table the teacher came to read.
   */
  async load(): Promise<void> {
    this.loading.set(true);

    const [programmes, institutions, classrooms] = await Promise.allSettled([
      this.service.list(),
      this.institutionService.list(),
      this.classroomService.list()
    ]);

    if (programmes.status === 'fulfilled') {
      this.programmes.set(programmes.value);
      this.error.set('');
    } else {
      this.error.set(this.service.describeError(programmes.reason, 'Could not load programmes.'));
    }

    this.institutions.set(institutions.status === 'fulfilled' ? institutions.value : []);
    this.classrooms.set(classrooms.status === 'fulfilled' ? classrooms.value : []);

    this.loading.set(false);
  }

  // ---- Stats -------------------------------------------------------------

  /**
   * One pass, memoised. Active counts LIVE and ACTIVE case-insensitively, and
   * everything else is a draft — so the two always sum to the total, even for a
   * status this app has never heard of.
   */
  private readonly stats = computed(() => {
    const counts = { total: 0, active: 0, draft: 0 };

    for (const programme of this.programmes()) {
      counts.total++;

      if (isActiveStatus(programme.programmeStatus)) {
        counts.active++;
      } else {
        counts.draft++;
      }
    }

    return counts;
  });

  readonly totalCount = computed(() => this.stats().total);
  readonly activeCount = computed(() => this.stats().active);
  readonly draftCount = computed(() => this.stats().draft);

  readonly filtered = computed(() => {
    const needle = this.searchQuery().trim().toLowerCase();
    const filter = this.activeFilter();

    return this.programmes().filter(programme => {
      const active = isActiveStatus(programme.programmeStatus);
      const matchesFilter =
        filter === 'All' ||
        (filter === 'Active' && active) ||
        (filter === 'Draft' && !active);

      if (!matchesFilter) {
        return false;
      }

      return !needle ||
        programme.programmeName.toLowerCase().includes(needle) ||
        programme.displayName.toLowerCase().includes(needle) ||
        programme.programmeCode.toLowerCase().includes(needle) ||
        programme.programmeId.toLowerCase().includes(needle) ||
        programme.institutionName.toLowerCase().includes(needle);
    });
  });

  // ---- Row helpers -------------------------------------------------------

  statusLabel(programme: Programme): string {
    return statusLabel(programme.programmeStatus);
  }

  isActive(programme: Programme): boolean {
    return isActiveStatus(programme.programmeStatus);
  }

  typeLabel(programme: Programme): string {
    return programmeTypeLabel(programme.type);
  }

  /**
   * The Grades column: "4 - 6" for a range, "8" for a single.
   *
   * Falls back to the age band for a programme scoped that way, prefixed so the
   * column cannot be misread as a grade. Production has no such prefix and its
   * column is genuinely ambiguous for age-scoped rows.
   */
  scopeLabel(programme: Programme): string {
    const label = scopeOf(programme) === 'age'
      ? rangeLabel(programme.age)
      : rangeLabel(programme.grades);

    if (!label) {
      return '—';
    }

    return scopeOf(programme) === 'age' ? `Age ${label}` : label;
  }

  /** The id column shows a prefix; the full value is the title attribute. */
  shortId(programme: Programme): string {
    return programme.programmeId.slice(0, 4);
  }

  toDate(value: { toDate?: () => Date } | null | undefined): Date | null {
    return value?.toDate ? value.toDate() : null;
  }

  /** How many classrooms would lose this programme if it were deleted. */
  classroomsUsing(programme: Programme): number {
    return this.classrooms().filter(classroom =>
      Object.prototype.hasOwnProperty.call(classroom.programmes ?? {}, programme.programmeId)
    ).length;
  }

  setFilter(filter: ProgrammeFilter): void {
    this.activeFilter.set(filter);
  }

  toggleStats(): void {
    this.statsHidden.update(hidden => !hidden);
  }

  // ---- Add ---------------------------------------------------------------

  openAdd(): void {
    this.modalError.set('');
    this.showAdd.set(true);
  }

  closeAdd(): void {
    this.showAdd.set(false);
    this.modalError.set('');
  }

  /**
   * The write. The current catalogue is passed through because it seeds the
   * code counter the first time a teacher creates a programme.
   */
  async saveProgramme(draft: ProgrammeDraft): Promise<void> {
    if (this.saving()) {
      return;
    }

    this.saving.set(true);
    this.modalError.set('');

    try {
      const created = await this.service.create(draft, this.programmes());

      this.programmes.update(list => [created, ...list]);
      this.showAdd.set(false);
      this.error.set('');
      this.flashNotice(`${created.displayName} created as ${created.programmeCode}`);

    } catch (error) {
      // Leave the modal open, so nothing the user entered is lost.
      this.modalError.set(this.service.describeError(error, 'Could not create the programme.'));
    } finally {
      this.saving.set(false);
    }
  }

  // ---- Edit --------------------------------------------------------------

  /** The programme open in the edit modal, or null. */
  readonly editing = signal<Programme | null>(null);

  openEdit(programme: Programme): void {
    this.modalError.set('');
    this.editing.set(programme);
  }

  closeEdit(): void {
    this.editing.set(null);
    this.modalError.set('');
  }

  /**
   * Saves the Basic Info edits.
   *
   * The row is patched from the SAME object that was written, not from a
   * re-read: update() strips the identity fields it will not send, so patching
   * from the emitted object would show the user fields the database does not
   * have. Everything in `patch` here is a field the write actually carried.
   *
   * A rename does NOT propagate to classrooms already carrying this programme —
   * they hold a denormalised copy taken at the moment it was attached.
   * Production cascades the rename across classrooms, teachers and students;
   * this app has no teachers or students collections and the cascade is
   * genuinely missing, so the notice says what did and did not change.
   */
  async saveEdit(patch: Partial<Programme>): Promise<void> {
    const target = this.editing();

    if (!target || this.saving()) {
      return;
    }

    this.saving.set(true);
    this.modalError.set('');

    try {
      await this.service.update(target.docId, patch);

      this.programmes.update(list =>
        list.map(row => (row.docId === target.docId ? { ...row, ...patch } : row))
      );

      this.editing.set(null);

      const renamed = patch.displayName !== undefined && patch.displayName !== target.displayName;
      const attached = this.classroomsUsing(target);

      this.flashNotice(
        renamed && attached > 0
          ? `Updated — ${attached} classroom(s) still show the old name`
          : 'Programme updated'
      );

    } catch (error) {
      this.modalError.set(this.service.describeError(error, 'Could not save the changes.'));
    } finally {
      this.saving.set(false);
    }
  }

  // ---- Delete ------------------------------------------------------------

  askDelete(programme: Programme): void {
    this.confirmingDelete.set(programme);
  }

  cancelDelete(): void {
    this.confirmingDelete.set(null);
  }

  /**
   * Detach from every classroom, THEN move to trash.
   *
   * That order is deliberate. The detach is a non-atomic sweep across many
   * documents and the trash move is one transaction; running the sweep first
   * means a failure leaves the programme live with some classrooms already
   * detached, which retrying fixes. The reverse order would leave classrooms
   * pointing at a programme that no longer exists, which nothing fixes.
   */
  async confirmDelete(): Promise<void> {
    const target = this.confirmingDelete();

    if (!target || this.busyRow()) {
      return;
    }

    this.busyRow.set(target.docId);

    try {
      const detached = await this.service.detachFromClassrooms(
        target.programmeId,
        this.classrooms()
      );

      const trashed = await this.service.moveToTrash(target.docId);

      // Patch the local classrooms too, so the count on any other row that
      // shares those classrooms is immediately right.
      if (detached.length > 0) {
        this.classrooms.update(list =>
          list.map(classroom => {
            if (!detached.includes(classroom.docId)) {
              return classroom;
            }

            const { [target.programmeId]: _removed, ...rest } = classroom.programmes ?? {};
            return { ...classroom, programmes: rest };
          })
        );
      }

      this.programmes.update(list => list.filter(row => row.docId !== target.docId));
      this.trashed.update(list => [trashed, ...list]);
      this.confirmingDelete.set(null);

      this.flashNotice(
        detached.length > 0
          ? `${target.displayName} deleted and removed from ${detached.length} classroom(s)`
          : `${target.displayName} deleted`
      );

    } catch (error) {
      this.error.set(this.service.describeError(error, 'Could not delete the programme.'));
      this.confirmingDelete.set(null);
    } finally {
      this.busyRow.set(null);
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
   * Restores the catalogue entry ONLY.
   *
   * The classrooms it was detached from are not re-attached and cannot be —
   * nothing recorded which they were. The delete confirmation says so before
   * the fact, and the notice repeats it here.
   */
  async restore(programme: TrashedProgramme): Promise<void> {
    await this.rowAction(programme.docId, 'Could not restore the programme.', async () => {
      const restored = await this.service.restore(programme.docId);

      this.trashed.update(list => list.filter(row => row.docId !== programme.docId));
      this.programmes.update(list => [restored, ...list]);

      this.flashNotice(`${restored.displayName} restored — reassign it to classrooms manually`);
    });
  }

  async purge(programme: TrashedProgramme): Promise<void> {
    await this.rowAction(programme.docId, 'Could not delete the programme.', async () => {
      await this.service.purge(programme.docId);
      this.trashed.update(list => list.filter(row => row.docId !== programme.docId));
    });
  }

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
      // A partial failure leaves the local list untrustworthy, so re-read.
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

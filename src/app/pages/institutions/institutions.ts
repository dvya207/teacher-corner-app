import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';

import { Icon } from '../../components/icon/icon';
import { schoolTypeShort } from '../../data/institution-options';
import { Institution, InstitutionDraft, TrashedInstitution } from '../../models/teaching.model';
import { InstitutionService } from '../../services/institution.service';
import { AddInstitution } from './add-institution';
import { EditInstitution } from './edit-institution';

export type InstitutionFilter = 'All' | 'Verified' | 'Unverified' | 'Government' | 'Private';

/**
 * Institutions — the registered-schools table.
 *
 * ZONELESS. The list arrives after an `await`, and a plain field assigned in a
 * promise continuation notifies the change detection scheduler of nothing, so
 * the write would land on the component and never reach the DOM. Everything the
 * template reads that is mutated post-await is a signal.
 */
@Component({
  selector: 'app-institutions',
  imports: [DatePipe, Icon, AddInstitution, EditInstitution],
  templateUrl: './institutions.html',
  styleUrl: './institutions.css'
})
export class Institutions implements OnInit {

  private service = inject(InstitutionService);
  /**
   * The teacher's own notification feed.
   *
   * Logged from HERE rather than from the service, for the same reason every
   * write lives here: the page is what knows the user-facing name of the thing
   * that changed, and what the change meant. The service knows a docId.
   */

  readonly institutions = signal<Institution[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');

  /**
   * Read from institutions/trash/DeletedInstitutes, NOT derived from the list
   * above. The two are independent queries against different collections, so an
   * empty active list says nothing about the trash: delete the only institution
   * and this still holds it.
   */
  readonly trashed = signal<TrashedInstitution[]>([]);
  readonly trashLoading = signal(false);
  readonly trashError = signal('');

  readonly filters: InstitutionFilter[] = [
    'All', 'Verified', 'Unverified', 'Government', 'Private'
  ];
  readonly activeFilter = signal<InstitutionFilter>('All');

  readonly searchQuery = signal('');
  readonly tableHidden = signal(false);

  readonly showAdd = signal(false);
  readonly saving = signal(false);

  /** The institution currently open in the edit modal, or null. */
  readonly editing = signal<Institution | null>(null);

  /**
   * Transient success message. Empty when nothing to say.
   *
   * A signal rather than a component-level toast service: there is one of these
   * in the app, and a service would be indirection for a single caller.
   */
  readonly notice = signal('');

  /**
   * Save failures raised while the edit modal is open.
   *
   * SEPARATE from `error`, which renders on the page behind the modal — a failed
   * save used to set that and the message was invisible under the overlay, so
   * Save Changes looked like it silently did nothing. This one is passed into the
   * modal and rendered inside it.
   */
  readonly editError = signal('');

  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  /** The Trash overlay. */
  readonly trashOpen = signal(false);

  /**
   * Emptying the Trash is irreversible and bulk, so it takes two clicks.
   * The button relabels itself rather than opening a second modal.
   */
  readonly confirmingEmpty = signal(false);

  /**
   * The institution the delete confirmation is open for, or null.
   *
   * Deleting is not a two-click relabel like Empty Trash: it names the row, so
   * the wrong trash icon cannot be confirmed by muscle memory.
   */
  readonly confirmingDelete = signal<Institution | null>(null);

  /** Row id currently being toggled or deleted, so only it shows a busy state. */
  readonly busyRow = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);

    try {
      this.institutions.set(await this.service.list());
      this.error.set('');
    } catch (error) {
      this.error.set(this.service.describeError(error, 'Could not load institutions.'));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Stats. One pass, memoised, rather than three filters re-run on every change
   * detection cycle. Derived from the loaded array — no aggregation query is
   * issued for a count that is already in hand.
   */
  /**
   * Live rows. No "not deleted" filter, because deleted institutions are in a
   * DIFFERENT COLLECTION — a query cannot forget to exclude what is not there.
   */
  readonly live = computed(() => this.institutions());

  private readonly stats = computed(() => {
    const counts = { total: 0, government: 0, private: 0 };

    for (const institution of this.live()) {
      counts.total++;

      if (institution.typeofSchool === 'Government School') {
        counts.government++;
      } else if (institution.typeofSchool === 'Private School') {
        counts.private++;
      }
    }

    return counts;
  });

  readonly totalCount = computed(() => this.stats().total);
  readonly governmentCount = computed(() => this.stats().government);
  readonly privateCount = computed(() => this.stats().private);

  /**
   * A computed rather than a getter: the template reads it for the count badge,
   * the @if and the @for, and a getter would re-run the whole filter on each of
   * those, on every change detection pass.
   */
  readonly filtered = computed(() => {
    const needle = this.searchQuery().trim().toLowerCase();
    const filter = this.activeFilter();

    return this.live().filter(institution => {
      const matchesSearch = !needle ||
        institution.institutionName.toLowerCase().includes(needle) ||
        institution.registrationNumber.toLowerCase().includes(needle) ||
        (institution.institutionAddress?.city ?? '').toLowerCase().includes(needle) ||
        this.representative(institution).toLowerCase().includes(needle);

      const matchesFilter =
        filter === 'All' ||
        (filter === 'Verified' && institution.verified) ||
        (filter === 'Unverified' && !institution.verified) ||
        (filter === 'Government' && institution.typeofSchool === 'Government School') ||
        (filter === 'Private' && institution.typeofSchool === 'Private School');

      return matchesSearch && matchesFilter;
    });
  });

  /**
   * Prefers the denormalised representativeName production stores, falling back
   * to composing it. A row imported from production has the field; one created
   * here has both, and they agree because the service maintains it on write.
   */
  representative(institution: Institution): string {
    return institution.representativeName?.trim() ||
      `${institution.representativeFirstName ?? ''} ${institution.representativeLastName ?? ''}`.trim();
  }

  /** "Pvt" / "Govt" for the TYPE badge, derived rather than stored. */
  typeBadge(institution: Institution): string {
    return schoolTypeShort(institution.typeofSchool);
  }

  /** Firestore Timestamps need converting before the DatePipe sees them. */
  toDate(value: { toDate?: () => Date } | null | undefined): Date | null {
    return value?.toDate ? value.toDate() : null;
  }

  /** Trash rows are full institutions, so the same helpers work on them. */
  trashRepresentative(institution: TrashedInstitution): string {
    return this.representative(institution);
  }

  setFilter(filter: InstitutionFilter): void {
    this.activeFilter.set(filter);
  }

  toggleTable(): void {
    this.tableHidden.update(hidden => !hidden);
  }

  openAdd(): void {
    this.showAdd.set(true);
  }

  closeAdd(): void {
    this.showAdd.set(false);
  }

  /**
   * The write. Patches the local list rather than re-reading the collection:
   * create() resolves the complete document it just committed, so a reload
   * would be a second round trip to learn something already in hand.
   */
  async saveInstitution(draft: InstitutionDraft): Promise<void> {
    if (this.saving()) {
      return;
    }

    this.saving.set(true);

    try {
      const created = await this.service.create(draft);
      this.institutions.update(list => [created, ...list]);
      this.showAdd.set(false);
      this.error.set('');

    } catch (error) {
      this.error.set(this.service.describeError(error, 'Could not save the institution.'));
      // Leave the modal open, so nothing the user typed is lost on a failure.
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * The table's toggle is the VERIFICATION toggle.
   *
   * Off/grey is verified:false and shows under Unverified; on/green is
   * verified:true and shows under Verified. It writes `verified` only — `active`
   * is a separate concern and is not touched here.
   */
  async toggleVerified(institution: Institution): Promise<void> {
    if (this.busyRow()) {
      return;
    }

    const next = !institution.verified;
    this.busyRow.set(institution.docId);

    try {
      await this.service.setVerified(institution.docId, next);

      this.institutions.update(list =>
        list.map(row => (row.docId === institution.docId ? { ...row, verified: next } : row))
      );

      // Confirmed both ways: turning verification OFF is as much a change as
      // turning it on, and silence after a click reads as nothing having happened.
      this.flashNotice(
        next
          ? 'Verification status updated successfully'
          : 'Moved back to Unverified'
      );

    } catch (error) {
      this.error.set(
        this.service.describeError(error, 'Could not update the verification status.')
      );
    } finally {
      this.busyRow.set(null);
    }
  }

  openEdit(institution: Institution): void {
    this.editing.set(institution);
  }

  closeEdit(): void {
    this.editing.set(null);
    this.editError.set('');
  }

  /**
   * Applies one tab's changes.
   *
   * The modal stays OPEN afterwards, matching the reference: each tab saves
   * independently, so closing on the first save would force a reopen to edit
   * the next tab.
   */
  async saveEdit(patch: Partial<Institution>): Promise<void> {
    const target = this.editing();

    if (!target || this.saving()) {
      return;
    }

    this.saving.set(true);
    this.editError.set('');

    try {
      await this.service.update(target.docId, patch);

      // The table first, so the row behind the modal is already correct by the
      // time the modal closes and reveals it.
      this.patchRow(target.docId, patch);

      this.editing.set(null);
      this.error.set('');
      this.flashNotice('Updated successfully');

      // Named with the name AFTER the edit, so a rename reads as the new name
      // rather than as the one the user has just replaced.
    } catch (error) {
      // Stays open, with the message inside it and the user's edits intact.
      this.editError.set(this.service.describeError(error, 'Could not save the changes.'));
    } finally {
      this.saving.set(false);
    }
  }

  /** Shows a success message and clears it again a few seconds later. */
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

  /** Opens the trash and loads it. The two collections are read separately. */
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
   * not from an assumption about what it did — so if the transaction aborted,
   * nothing here moved either.
   */
  askDelete(institution: Institution): void {
    this.confirmingDelete.set(institution);
  }

  cancelDelete(): void {
    this.confirmingDelete.set(null);
  }

  /**
   * Moves the confirmed institution to the Trash.
   *
   * The local lists are updated from what the service RETURNS, not from an
   * assumption about what it did, so if the transaction aborted nothing here
   * moved either.
   */
  async confirmDelete(): Promise<void> {
    const target = this.confirmingDelete();

    if (!target) {
      return;
    }

    await this.rowAction(target.docId, 'Could not move the institution to Trash.', async () => {
      const trashed = await this.service.moveToTrash(target.docId);

      this.institutions.update(list => list.filter(row => row.docId !== target.docId));
      this.trashed.update(list => [trashed, ...list]);
      this.flashNotice(`${target.institutionName} moved to Trash`);

    });

    // Closed whether it worked or not: on failure the message is on the page
    // behind, and leaving the dialog open over it would hide the reason.
    this.confirmingDelete.set(null);
  }

  async restore(institution: TrashedInstitution): Promise<void> {
    await this.rowAction(institution.docId, 'Could not restore the institution.', async () => {
      const restored = await this.service.restore(institution.docId);

      this.trashed.update(list => list.filter(row => row.docId !== institution.docId));
      this.institutions.update(list => [restored, ...list]);

    });
  }

  /** Permanent, single row. Only reachable from the Trash. */
  async purge(institution: TrashedInstitution): Promise<void> {
    await this.rowAction(institution.docId, 'Could not delete the institution.', async () => {
      await this.service.purge(institution.docId);
      this.trashed.update(list => list.filter(row => row.docId !== institution.docId));
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

  /** Shared guard, busy-state and error handling for the per-row actions. */
  private async rowAction(id: string, fallback: string, run: () => Promise<void>): Promise<void> {
    if (this.busyRow()) {
      return;
    }

    this.busyRow.set(id);

    try {
      await run();
    } catch (error) {
      this.error.set(this.service.describeError(error, fallback));
    } finally {
      this.busyRow.set(null);
    }
  }

  private patchRow(docId: string, patch: Partial<Institution>): void {
    this.institutions.update(list =>
      list.map(row => (row.docId === docId ? { ...row, ...patch } : row))
    );
  }
}

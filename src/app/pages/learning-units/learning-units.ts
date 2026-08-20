import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';

import { Icon } from '../../components/icon/icon';
import { Sheet, downloadWorkbook } from '../../core/xlsx';
import {
  languageLabel,
  learningUnitTitle,
  totalTimeLabel,
  versionNumberOf
} from '../../data/learning-unit-options';
import { isActiveStatus, statusLabel } from '../../data/programme-options';
import {
  LearningUnit,
  LearningUnitDraft,
  TrashedLearningUnit
} from '../../models/teaching.model';
import { LearningUnitService } from '../../services/learning-unit.service';
import { LearningUnitForm } from './learning-unit-form';

export type LearningUnitFilter = 'All' | 'Live' | 'Draft';

/** Card banner or table row. Production's toggle, and its default. */
export type LearningUnitView = 'card' | 'list';

/**
 * The eight card banners, verbatim from production.
 *
 * Not tokens from this app's palette: the first is ThinkTac's brand blue running
 * into its navy, and the other seven are the spread production picked around it.
 * A unit's banner is part of how it is recognised, so these are copied rather
 * than reinterpreted.
 */
const CARD_GRADIENTS: readonly string[] = [
  'linear-gradient(135deg, #169CD8, #272B66)',
  'linear-gradient(135deg, #10B981, #059669)',
  'linear-gradient(135deg, #F59E0B, #D97706)',
  'linear-gradient(135deg, #8B5CF6, #6D28D9)',
  'linear-gradient(135deg, #EC4899, #BE185D)',
  'linear-gradient(135deg, #0EA5E9, #0369A1)',
  'linear-gradient(135deg, #6366F1, #4338CA)',
  'linear-gradient(135deg, #14B8A6, #0F766E)'
] as const;

/**
 * Learning Units — the activity catalogue.
 *
 * The fourth table built to the Institutions pattern: stat cards, filter pills,
 * one table, a full-screen Trash overlay, and every Firestore write owned here
 * rather than by the modal.
 *
 * ZONELESS. Everything the template reads that is mutated after an `await` is a
 * signal.
 */
@Component({
  selector: 'app-learning-units',
  imports: [DatePipe, Icon, LearningUnitForm],
  templateUrl: './learning-units.html',
  styleUrl: './learning-units.css'
})
export class LearningUnits implements OnInit {

  private service = inject(LearningUnitService);

  readonly units = signal<LearningUnit[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');

  readonly trashed = signal<TrashedLearningUnit[]>([]);
  readonly trashLoading = signal(false);
  readonly trashError = signal('');

  readonly filters: LearningUnitFilter[] = ['All', 'Live', 'Draft'];
  readonly activeFilter = signal<LearningUnitFilter>('All');

  /** Page-local, as on the other three tables — the topbar field is not wired. */
  readonly searchQuery = signal('');
  readonly statsHidden = signal(false);

  /**
   * Cards or rows.
   *
   * CARDS BY DEFAULT, as production defaults. A learning unit is recognised by
   * its thumbnail and its code far faster than by a row of twelve columns, and
   * the list view is what the person auditing versions and owners switches to.
   */
  readonly view = signal<LearningUnitView>('card');

  readonly exporting = signal(false);

  /**
   * The modal's state, as ONE signal rather than two.
   *
   *   null       closed
   *   'create'   open with a blank form
   *   a unit     open editing that unit
   *
   * The alternative — a `showAdd` boolean plus an `editing` reference — has a
   * fourth state that means nothing (both set at once), and every reader would
   * have to know which wins.
   */
  readonly form = signal<LearningUnit | 'create' | null>(null);
  readonly editingUnit = computed(() => {
    const state = this.form();

    return state === 'create' || state === null ? null : state;
  });

  readonly saving = signal(false);
  readonly modalError = signal('');

  readonly notice = signal('');
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  readonly trashOpen = signal(false);
  readonly confirmingEmpty = signal(false);
  readonly busyRow = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);

    try {
      this.units.set(await this.service.list());
      this.error.set('');
    } catch (error) {
      this.error.set(this.service.describeError(error, 'Could not load learning units.'));
    } finally {
      this.loading.set(false);
    }
  }

  // ---- Stats -------------------------------------------------------------

  /**
   * One pass, memoised. Live counts LIVE and ACTIVE case-insensitively and
   * everything else is a draft, so the two always sum to the total — the same
   * defensive reading the Programme list uses, because production types this
   * field as a bare string.
   */
  private readonly stats = computed(() => {
    const counts = { total: 0, live: 0, draft: 0 };

    for (const unit of this.units()) {
      counts.total++;

      if (isActiveStatus(unit.status)) {
        counts.live++;
      } else {
        counts.draft++;
      }
    }

    return counts;
  });

  readonly totalCount = computed(() => this.stats().total);
  readonly liveCount = computed(() => this.stats().live);
  readonly draftCount = computed(() => this.stats().draft);

  readonly filtered = computed(() => {
    const needle = this.searchQuery().trim().toLowerCase();
    const filter = this.activeFilter();

    return this.units().filter(unit => {
      const live = isActiveStatus(unit.status);
      const matchesFilter =
        filter === 'All' ||
        (filter === 'Live' && live) ||
        (filter === 'Draft' && !live);

      if (!matchesFilter) {
        return false;
      }

      return !needle ||
        unit.learningUnitCode.toLowerCase().includes(needle) ||
        unit.learningUnitName.toLowerCase().includes(needle) ||
        unit.learningUnitDisplayName.toLowerCase().includes(needle) ||
        unit.domainName.toLowerCase().includes(needle) ||
        unit.subjectName.toLowerCase().includes(needle);
    });
  });

  // ---- Row helpers -------------------------------------------------------

  title(unit: LearningUnit): string {
    return learningUnitTitle(unit);
  }

  statusLabel(unit: LearningUnit): string {
    return statusLabel(unit.status);
  }

  isLive(unit: LearningUnit): boolean {
    return isActiveStatus(unit.status);
  }

  languageLabel(unit: LearningUnit): string {
    return unit.isoCode ? languageLabel(unit.isoCode) : '—';
  }

  timeLabel(unit: LearningUnit): string {
    return totalTimeLabel(unit.totalTime);
  }

  toDate(value: { toDate?: () => Date } | null | undefined): Date | null {
    return value?.toDate ? value.toDate() : null;
  }

  setFilter(filter: LearningUnitFilter): void {
    this.activeFilter.set(filter);
  }

  toggleStats(): void {
    this.statsHidden.update(hidden => !hidden);
  }

  setView(view: LearningUnitView): void {
    this.view.set(view);
  }

  /**
   * The card banner's colour, chosen from the code.
   *
   * Production's eight gradients and production's hash, kept identical on
   * purpose: the colour is how a returning user recognises a unit at a glance, so
   * PS07 being orange here and violet there would be worse than having no colour.
   * Hashed rather than indexed by position, so a unit does not change colour when
   * the filter above it changes.
   */
  cardGradient(unit: LearningUnit, index: number): string {
    const key = unit.learningUnitCode || unit.docId || '';

    if (!key) {
      return CARD_GRADIENTS[index % CARD_GRADIENTS.length];
    }

    let hash = 0;

    for (let i = 0; i < key.length; i++) {
      hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    }

    return CARD_GRADIENTS[hash % CARD_GRADIENTS.length];
  }

  // ---- Export ------------------------------------------------------------

  /**
   * The three-sheet workbook production exports, with production's headers.
   *
   * WHAT IT COVERS: every unit the teacher owns, not the filtered view.
   * Production re-reads the whole collection for this rather than exporting what
   * is on screen, because the file is used as a master sheet — an export that
   * silently honoured a Draft filter would be read as the full catalogue.
   *
   * 'TAC Ver' is the version divided by ten ('V22' → 2.2), which is where V10 as
   * a starting number comes from: it is version 1.0.
   *
   * The columns production leaves blank are kept, blank. They are the MUT
   * counterparts of the TAC columns and the sheet is pasted into a workbook that
   * expects the positions to line up.
   */
  async exportWorkbook(): Promise<void> {
    if (this.exporting()) {
      return;
    }

    this.exporting.set(true);

    try {
      const units = await this.service.list();

      const master: Sheet = {
        name: 'TAC Mastersheet',
        rows: units.map((unit, index) => ({
          'SL': index,
          'T Code': unit.learningUnitCode,
          'Internal Tactivity Name': unit.learningUnitName,
          'TAC Cat': unit.type,
          'MUT Cat': '',
          'TAC Level': unit.Maturity,
          'TAC Ver': unit.version ? versionNumberOf(unit.version) / 10 : '',
          'MUT Level': '',
          'MUT Ver': '',
          'Display Name': unit.learningUnitDisplayName
        }))
      };

      const descriptions: Sheet = {
        name: 'TAC Description',
        rows: units.map((unit, index) => ({
          'SL': index,
          'T Code': unit.learningUnitCode,
          'TACtivity Name': unit.learningUnitName,
          'TAC Short Description': unit.shortDescription,
          'TAC Description': '',
          'MUT Description': ''
        }))
      };

      const details: Sheet = {
        name: 'TAC Details',
        rows: units.map((unit, index) => ({
          'SL': index,
          'T Code': unit.learningUnitCode,
          'TACtivity Name': unit.learningUnitName,
          'Domain': unit.domainName,
          'Sub-Domain': unit.subDomainName,
          'Subject': unit.subjectName,
          'Composite Code': unit.compositeCode,
          'Language': unit.isoCode,
          'Version': unit.version,
          'Status': unit.status,
          'Total Time(Mts)': unit.totalTime,
          'Difficulty': unit.difficultyLevel,
          'TAC Owner': unit.tacOwnerName,
          'Learning Unit Id': unit.learningUnitId
        }))
      };

      downloadWorkbook('LearningUnitData.xlsx', [master, descriptions, details]);
      this.flashNotice(`Exported ${units.length} learning units`);
    } catch (error) {
      this.error.set(this.service.describeError(error, 'Could not build the export.'));
    } finally {
      this.exporting.set(false);
    }
  }

  // ---- Create / edit -----------------------------------------------------

  /**
   * Opens the Add dialog, and loads the trash behind it.
   *
   * The trash load is not decoration: the next version number for a code is one
   * past the HIGHEST that code has ever had, and a deleted V11 still counts —
   * handing out 11 again would collide the moment that unit was restored. The
   * await comes after the modal is shown so the dialog does not wait on a read;
   * the version field is blank until a language is picked anyway.
   */
  async openAdd(): Promise<void> {
    this.modalError.set('');
    this.form.set('create');

    if (this.trashed().length === 0) {
      await this.loadTrash();
    }
  }

  openEdit(unit: LearningUnit): void {
    this.modalError.set('');
    this.form.set(unit);
  }

  closeForm(): void {
    this.form.set(null);
    this.modalError.set('');
  }

  /**
   * One handler for both, because the modal is one component.
   *
   * Which operation runs is decided by whether a unit was being edited, not by
   * the payload — the draft is identical in both cases.
   */
  async submitForm(draft: LearningUnitDraft): Promise<void> {
    if (this.saving()) {
      return;
    }

    const editing = this.editingUnit();

    this.saving.set(true);
    this.modalError.set('');

    try {
      if (editing) {
        await this.service.update(editing.docId, draft);

        this.units.update(list =>
          list.map(row => (row.docId === editing.docId ? { ...row, ...draft } : row))
        );
        this.flashNotice(`${draft.learningUnitDisplayName} updated`);
      } else {
        const created = await this.service.create(draft);

        this.units.update(list => [created, ...list]);
        this.flashNotice(`${created.learningUnitDisplayName} created`);
      }

      this.form.set(null);
      this.error.set('');
    } catch (error) {
      // Leave the modal open, so nothing the user entered is lost.
      this.modalError.set(
        this.service.describeError(
          error,
          editing ? 'Could not save the changes.' : 'Could not create the learning unit.'
        )
      );
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

  async moveToTrash(unit: LearningUnit): Promise<void> {
    await this.rowAction(unit.docId, 'Could not move the learning unit to Trash.', async () => {
      const trashed = await this.service.moveToTrash(unit.docId);

      this.units.update(list => list.filter(row => row.docId !== unit.docId));
      this.trashed.update(list => [trashed, ...list]);
      this.flashNotice(`${this.title(unit)} moved to Trash`);
    });
  }

  async restore(unit: TrashedLearningUnit): Promise<void> {
    await this.rowAction(unit.docId, 'Could not restore the learning unit.', async () => {
      const restored = await this.service.restore(unit.docId);

      this.trashed.update(list => list.filter(row => row.docId !== unit.docId));
      this.units.update(list => [restored, ...list]);
      this.flashNotice(`${this.title(restored)} restored`);
    });
  }

  async purge(unit: TrashedLearningUnit): Promise<void> {
    await this.rowAction(unit.docId, 'Could not delete the learning unit.', async () => {
      await this.service.purge(unit.docId);
      this.trashed.update(list => list.filter(row => row.docId !== unit.docId));
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

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';

import { Router } from '@angular/router';

import { ConfirmDialog } from '../../components/confirm-dialog/confirm-dialog';
import { Icon } from '../../components/icon/icon';
import {
  WORKFLOW_MATURITIES,
  WORKFLOW_MATURITY_COLUMNS,
  WORKFLOW_TYPES
} from '../../data/workflow-template-options';
import { LEARNING_UNIT_TYPES } from '../../data/learning-unit-taxonomy';
import {
  TrashedWorkflowTemplate,
  WorkflowTemplate
} from '../../models/teaching.model';
import { WorkflowTemplateService } from '../../services/workflow-template.service';

/** 'All' plus one per maturity. A union so the template cannot ask for a fifth. */
type Filter = 'All' | (typeof WORKFLOW_MATURITIES)[number];

/**
 * Workflow Templates — reusable blueprints for a learning unit's steps.
 *
 * THE SIXTH TABLE BUILT TO THIS PAGE'S RULES, after institutions, classrooms,
 * programmes, learning units and assignments. Identical where the behaviour is
 * identical, on purpose: six admin tables that differ for no reason are six
 * things to learn instead of one.
 *
 * FILTERED BY MATURITY, not by type, which is production's own choice and worth
 * keeping: its stat cards and pills are Gold / Silver / Platinum / Diamond. A
 * template's maturity is the thing a reader is looking for it by.
 *
 * ZONELESS. Everything the template reads is a signal.
 */
@Component({
  selector: 'app-workflow-templates',
  imports: [DatePipe, Icon, ConfirmDialog],
  templateUrl: './workflow-templates.html',
  styleUrl: './workflow-templates.css'
})
export class WorkflowTemplates implements OnInit {

  private service = inject(WorkflowTemplateService);
  private router = inject(Router);

  /** In production's LIST order — Gold, Silver, Platinum, Diamond. */
  readonly maturities = WORKFLOW_MATURITY_COLUMNS;

  /**
   * The maturities SHOWN — three, not four: Diamond is off the UI on instruction.
   *
   * IT STAYS IN WORKFLOW_MATURITY_COLUMNS, which is deliberate. That constant is
   * production's list order and the table still has to LABEL a stored Diamond
   * template correctly; what is dropped is the counting — the stat card and the
   * filter pill — not the app's knowledge that the rung exists.
   *
   * Derived by excluding rather than listed, so the constant stays the single
   * place the ladder is written down.
   */
  readonly shownMaturities = WORKFLOW_MATURITY_COLUMNS.filter(
    maturity => maturity !== 'Diamond'
  );

  /** The stat cards. Same three. */
  readonly cardMaturities = this.shownMaturities;

  /** 'All' first, then one pill per shown maturity, in ladder order. */
  readonly filters: Filter[] = ['All', ...this.shownMaturities];

  readonly rows = signal<WorkflowTemplate[]>([]);
  readonly trashed = signal<TrashedWorkflowTemplate[]>([]);

  readonly loading = signal(true);
  readonly trashLoading = signal(false);

  readonly error = signal('');
  readonly trashError = signal('');
  readonly notice = signal('');

  readonly activeFilter = signal<Filter>('All');
  readonly statsHidden = signal(false);
  readonly trashOpen = signal(false);
  readonly confirmingEmpty = signal(false);

  /** The row being deleted, awaiting confirmation. */
  readonly confirming = signal<WorkflowTemplate | null>(null);
  readonly busyRow = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);

    try {
      this.rows.set(await this.service.list());
      this.error.set('');
    } catch (error) {
      this.error.set(this.service.describeError(error, 'Could not load workflow templates.'));
    } finally {
      this.loading.set(false);
    }
  }

  // ---- Counts ------------------------------------------------------------

  /**
   * One pass over the rows, memoised, rather than a filter per card and per pill
   * — nine passes over the same array on every change-detection cycle.
   */
  private readonly counts = computed(() => {
    const tally: Record<string, number> = { All: this.rows().length };

    for (const maturity of WORKFLOW_MATURITIES) {
      tally[maturity] = 0;
    }

    for (const row of this.rows()) {
      if (row.maturity in tally) {
        tally[row.maturity]++;
      }
    }

    return tally;
  });

  readonly totalCount = computed(() => this.rows().length);

  countFor(filter: string): number {
    return this.counts()[filter] ?? 0;
  }

  readonly filtered = computed(() => {
    const filter = this.activeFilter();

    return filter === 'All' ? this.rows() : this.rows().filter(row => row.maturity === filter);
  });

  setFilter(filter: Filter): void {
    this.activeFilter.set(filter);
  }

  toggleStats(): void {
    this.statsHidden.update(hidden => !hidden);
  }

  // ---- Labels ------------------------------------------------------------

  /**
   * The learning-unit type's NAME for its stored code.
   *
   * The document stores 'TA'; the table should say 'TACtivity'. Falls back to the
   * code, so a type this app's taxonomy does not know still reads as something
   * rather than as a blank cell.
   */
  learningUnitTypeLabel(code: string): string {
    return LEARNING_UNIT_TYPES.find(entry => entry.code === code)?.name || code || '—';
  }

  /** 'Stem Club' for 'STEM-CLUB'. The stored value keeps its hyphen. */
  workflowTypeLabel(code: string): string {
    return WORKFLOW_TYPES.find(entry => entry.code === code)?.label || code || '—';
  }

  /** The maturity's own lowercase word, for the pill's tint class. */
  maturityClass(maturity: string): string {
    return (maturity ?? '').toLowerCase();
  }

  /** Six characters and an ellipsis, as the other tables' ID lines show. */
  shortId(docId: string): string {
    return docId.length > 6 ? `${docId.slice(0, 6)}…` : docId;
  }

  /** A Firestore Timestamp to a Date, for the date columns. */
  toDate(value: { toDate?: () => Date } | null | undefined): Date | null {
    return value?.toDate ? value.toDate() : null;
  }

  // ---- Create and edit ---------------------------------------------------

  /**
   * BOTH NAVIGATE — the builder is a PAGE, not a dialog over this table.
   *
   * Production's create view fills the viewport with a Back button and no shell,
   * and the route sits outside the shell to match. A template is built over
   * several minutes across a rail and a step editor; a modal that size is a page
   * wearing a costume.
   */
  openCreate(): Promise<boolean> {
    return this.router.navigate(['/workflow-templates/new']);
  }

  openEdit(row: WorkflowTemplate): Promise<boolean> {
    return this.router.navigate(['/workflow-templates', row.docId, 'edit']);
  }

  // ---- Trash -------------------------------------------------------------

  askMoveToTrash(row: WorkflowTemplate): void {
    this.confirming.set(row);
  }

  cancelConfirm(): void {
    this.confirming.set(null);
  }

  async moveToTrash(): Promise<void> {
    const row = this.confirming();

    if (!row || this.busyRow()) {
      return;
    }

    this.busyRow.set(row.docId);

    try {
      await this.service.moveToTrash(row.docId);
      this.rows.update(list => list.filter(item => item.docId !== row.docId));
      this.flashNotice(`"${row.templateName}" moved to trash`);
      this.confirming.set(null);
    } catch (error) {
      this.error.set(this.service.describeError(error, 'Could not move it to the trash.'));
    } finally {
      this.busyRow.set(null);
    }
  }

  async openTrash(): Promise<void> {
    this.trashOpen.set(true);
    await this.loadTrash();
  }

  private async loadTrash(): Promise<void> {
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
    // Disarmed on the way out, so reopening does not present a primed
    // destructive button to somebody who has forgotten they clicked it once.
    this.confirmingEmpty.set(false);
    this.trashError.set('');
  }

  async restore(row: TrashedWorkflowTemplate): Promise<void> {
    await this.rowAction(row.docId, 'Could not restore it.', async () => {
      await this.service.restore(row.docId);
      this.trashed.update(list => list.filter(item => item.docId !== row.docId));
      // Reloaded rather than patched: the restored document may carry fields this
      // app does not model, and the authoritative row is the stored one.
      await this.load();
      this.flashNotice(`"${row.templateName}" restored`);
    });
  }

  async purge(row: TrashedWorkflowTemplate): Promise<void> {
    await this.rowAction(row.docId, 'Could not delete it.', async () => {
      await this.service.purge(row.docId);
      this.trashed.update(list => list.filter(item => item.docId !== row.docId));
      this.flashNotice(`"${row.templateName}" deleted permanently`);
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
      this.flashNotice(`${ids.length} template(s) deleted permanently`);
    } catch (error) {
      this.trashError.set(this.service.describeError(error, 'Could not empty the Trash.'));
      // A partial failure leaves the local list untrustworthy, so re-read rather
      // than guessing which deletes landed.
      await this.loadTrash();
    } finally {
      this.busyRow.set(null);
    }
  }

  /** One row action at a time, with the failure reported and the flag cleared. */
  private async rowAction(id: string, fallback: string, run: () => Promise<void>): Promise<void> {
    if (this.busyRow()) {
      return;
    }

    this.busyRow.set(id);

    try {
      await run();
    } catch (error) {
      this.trashError.set(this.service.describeError(error, fallback));
    } finally {
      this.busyRow.set(null);
    }
  }

  // ---- Notices -----------------------------------------------------------

  private flashNotice(message: string): void {
    this.notice.set(message);
    setTimeout(() => this.notice.set(''), 4000);
  }

  dismissNotice(): void {
    this.notice.set('');
  }
}

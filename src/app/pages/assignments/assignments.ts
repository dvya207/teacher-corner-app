import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';

import { ConfirmDialog } from '../../components/confirm-dialog/confirm-dialog';
import { Icon } from '../../components/icon/icon';
import {
  ASSIGNMENT_TYPES,
  Assignment,
  AssignmentDraft,
  AssignmentType,
  TrashedAssignment
} from '../../models/teaching.model';
import { AssignmentService } from '../../services/assignment.service';
import { ConfigurationService } from '../../services/configuration.service';
import { AssignmentReport } from './assignment-report';
import { FormWizard } from './form-wizard';
import { QuizWizard } from './quiz-wizard';
import { UploadWizard } from './upload-wizard';

/** 'All' plus one per type. A union so the template cannot ask for a fifth. */
type Filter = 'All' | AssignmentType;

/**
 * Assignments — quizzes, uploads and forms.
 *
 * THREE TYPES, NOT SIX, on instruction. Production's Create menu also offers
 * Textblock, Case Study and Multi-Category; this app implements Quiz, Upload and
 * Form only. The restriction lives in ASSIGNMENT_TYPES, which the Create menu,
 * the stat cards and the filter pills all read — so the three surfaces cannot
 * disagree about which types exist, and adding a fourth is one entry rather than
 * three edits.
 *
 * The fifth table built to this page's rules, after institutions, classrooms,
 * programmes and learning units. Identical where the behaviour is identical, on
 * purpose: five admin tables that differ for no reason are five things to learn
 * instead of one.
 *
 * ZONELESS. Everything the template reads is a signal.
 */
@Component({
  selector: 'app-assignments',
  imports: [
    DatePipe,
    Icon,
    ConfirmDialog,
    AssignmentReport,
    FormWizard,
    QuizWizard,
    UploadWizard
  ],
  templateUrl: './assignments.html',
  styleUrl: './assignments.css',
  /* Escape closes the Create menu, which is a popover with no focusable
     backdrop of its own — the same treatment the shell's user menu gets. */
  host: { '(document:keydown.escape)': 'closeCreateMenu()' }
})
export class Assignments implements OnInit {

  /**
   * The kinds the Create menu offers, FROM CONFIGURATION.
   *
   * The service filters the configured list against what this app implements, so a
   * document can turn a type OFF but not conjure an editor for one. See
   * applyCreatableTypes.
   */
  readonly types = computed(() => {
    const allowed = new Set<string>(this.config.creatableAssignmentTypes());

    return ASSIGNMENT_TYPES.filter(entry => allowed.has(entry.type));
  });

  /** 'All' first, then one pill per type, in the order the menu offers them. */
  readonly filters = computed<Filter[]>(
    () => ['All', ...this.types().map(entry => entry.type)]
  );

  private service = inject(AssignmentService);
  private config = inject(ConfigurationService);

  /**
   * Labels for a type, from Configuration/AssignmentTypes.
   *
   * READ FOR LABELLING, NOT FOR OFFERING. The document lists five kinds — Quiz,
   * Upload, Game, Form, Text Block — and this app creates three; the Create menu
   * and the pills read ASSIGNMENT_TYPES instead, which is where the restriction
   * lives. This map exists so a row already stored as GAME or TEXTBLOCK shows
   * 'Game' rather than the raw SCREAMING_SNAKE value, which is what the badge
   * rendered before.
   */
  private readonly typeLabels = computed(() => {
    const labels = new Map<string, string>();

    for (const entry of this.config.assignmentTypes()) {
      labels.set(entry.type.toUpperCase(), entry.displayName);
    }

    return labels;
  });

  /** The badge's text: the configured label, or the stored value if unknown. */
  typeLabel(type: string): string {
    return this.typeLabels().get((type ?? '').toUpperCase()) || type || '—';
  }

  readonly rows = signal<Assignment[]>([]);
  readonly trashed = signal<TrashedAssignment[]>([]);

  readonly loading = signal(true);
  readonly trashLoading = signal(false);
  readonly saving = signal(false);

  readonly error = signal('');
  readonly modalError = signal('');
  readonly notice = signal('');

  readonly activeFilter = signal<Filter>('All');
  readonly statsHidden = signal(false);
  readonly trashOpen = signal(false);

  /**
   * Trash failures, shown INSIDE the trash rather than behind it.
   *
   * Separate from `error`, which the page renders above the table — a message
   * about the trash placed there is hidden by the overlay showing it.
   */
  readonly trashError = signal('');

  /**
   * Whether Empty Trash is armed.
   *
   * A TWO-CLICK CONFIRM rather than a dialog on top of an overlay: the button
   * relabels itself to name the count it is about to destroy, which is the same
   * treatment the other four trashes get.
   */
  readonly confirmingEmpty = signal(false);
  readonly createMenuOpen = signal(false);

  /** The row being deleted, awaiting confirmation. */
  readonly confirming = signal<Assignment | null>(null);
  readonly busyRow = signal<string | null>(null);

  /** The type the create form is open for, or null. */
  readonly creating = signal<AssignmentType | null>(null);

  /** The row being edited, or null. */
  readonly editing = signal<Assignment | null>(null);

  /**
   * The row whose report panel is open, or null.
   *
   * SEPARATE FROM `editing`, because the report reads and the editor writes.
   * Sharing one signal would mean a panel that only looks at an assignment and a
   * dialog that rewrites it were the same state, and closing one would have to
   * know which had been open.
   */
  readonly reporting = signal<Assignment | null>(null);

  /**
   * The quiz being edited, narrowed, or null.
   *
   * The union's discriminant is what makes this safe: the wizard takes a
   * QuizAssignment and nothing else, so an UPLOAD row cannot reach it.
   */
  readonly editingQuiz = computed(() => {
    const row = this.editing();

    return row !== null && row.type === 'QUIZ' ? row : null;
  });

  /**
   * The UPLOAD being edited, narrowed, or null.
   *
   * Opens the three-step upload wizard, which emits a WHOLE document — the slots
   * are the point of editing an upload, so a patch would be the wrong shape.
   */
  readonly editingUpload = computed(() => {
    const row = this.editing();

    return row !== null && row.type === 'UPLOAD' ? row : null;
  });

  /**
   * The FORM being edited, narrowed, or null.
   *
   * Opens the three-step form wizard, which emits a WHOLE document. Until that
   * wizard existed this type went to a one-step form that emitted a PATCH,
   * because sending a full draft would have written `questions: []` over every
   * stored question. All three types now have their own editor, so that form and
   * its patch path are gone.
   */
  readonly editingForm = computed(() => {
    const row = this.editing();

    return row !== null && row.type === 'FORM' ? row : null;
  });

  /**
   * ONE WIZARD PER TYPE: a quiz gets four steps, an upload and a form three each.
   *
   * All three are production's own dialogs, and all three emit a WHOLE document
   * — the content is the point of every one of them. The step counts differ
   * because the content does: a quiz has five question types with options and
   * blanks, an upload has file slots, a form has typed fields.
   */
  readonly creatingQuiz = computed(() => this.creating() === 'QUIZ');
  readonly creatingUpload = computed(() => this.creating() === 'UPLOAD');
  readonly creatingForm = computed(() => this.creating() === 'FORM');

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);

    try {
      this.rows.set(await this.service.list());
      this.error.set('');
    } catch (error) {
      this.error.set(this.service.describeError(error, 'Could not load assignments.'));
    } finally {
      this.loading.set(false);
    }
  }

  // ---- Counts ------------------------------------------------------------

  /**
   * One pass over the rows, memoised, rather than a filter per card and per
   * pill — six passes over the same array on every change-detection cycle.
   */
  private readonly counts = computed(() => {
    const tally: Record<string, number> = { All: this.rows().length };

    for (const entry of ASSIGNMENT_TYPES) {
      tally[entry.type] = 0;
    }

    for (const row of this.rows()) {
      if (row.type in tally) {
        tally[row.type]++;
      }
    }

    return tally;
  });

  readonly totalCount = computed(() => this.rows().length);

  countFor(filter: Filter): number {
    return this.counts()[filter] ?? 0;
  }

  readonly filtered = computed(() => {
    const filter = this.activeFilter();

    return filter === 'All'
      ? this.rows()
      : this.rows().filter(row => row.type === filter);
  });

  /** The pill's label. 'All' is itself; a type shows its own word. */
  labelFor(filter: Filter): string {
    return filter === 'All'
      ? 'All'
      : (ASSIGNMENT_TYPES.find(entry => entry.type === filter)?.label ?? filter);
  }

  setFilter(filter: Filter): void {
    this.activeFilter.set(filter);
  }

  toggleStats(): void {
    this.statsHidden.update(hidden => !hidden);
  }

  // ---- Status ------------------------------------------------------------

  /**
   * Production's own reading, from its all-assignments-table:
   *
   *   'active' | 'live'      -> live
   *   'closed' | 'archived'  -> closed
   *   anything else          -> draft
   *
   * Case-insensitive, and DEFENSIVE about values the form never offers, because
   * the collection holds them: the fallback is 'draft' rather than the raw
   * string, so an unrecognised status renders as a badge rather than as noise.
   */
  statusKind(status: string): 'live' | 'closed' | 'draft' {
    const value = (status ?? '').toString().toLowerCase();

    if (this.config.liveStatusValues().includes(value)) {
      return 'live';
    }

    if (this.config.closedStatusValues().includes(value)) {
      return 'closed';
    }

    return 'draft';
  }

  /** The badge's text. Production shows the STORED value, not the kind. */
  statusLabel(status: string): string {
    return (status ?? '').trim() || 'DRAFT';
  }

  /** Six characters and an ellipsis, as production's ID line shows. */
  shortId(docId: string): string {
    return docId.length > 6 ? `${docId.slice(0, 6)}…` : docId;
  }

  // ---- Create ------------------------------------------------------------

  toggleCreateMenu(): void {
    this.createMenuOpen.update(open => !open);
  }

  closeCreateMenu(): void {
    this.createMenuOpen.set(false);
  }

  openCreate(type: AssignmentType): void {
    this.closeCreateMenu();
    this.modalError.set('');
    this.creating.set(type);
  }

  closeCreate(): void {
    this.creating.set(null);
    this.modalError.set('');
  }

  openReport(row: Assignment): void {
    this.reporting.set(row);
  }

  closeReport(): void {
    this.reporting.set(null);
  }

  openEdit(row: Assignment): void {
    this.modalError.set('');
    this.editing.set(row);
  }

  closeEdit(): void {
    this.editing.set(null);
    this.modalError.set('');
  }

  /**
   * Saves an edited quiz or upload — the WHOLE document, which is what those two
   * wizards produce.
   *
   * The content is the point of editing either one, so a partial write would be
   * the wrong shape: the wizard hands back every field, `questionsData` or
   * `assignments` included, and that is what should land.
   *
   * ONE METHOD FOR BOTH rather than one each. The two drafts are both members of
   * AssignmentDraft and the work is identical — update, patch the row in place,
   * notice, close — so a second copy would only be a second place to fix.
   */
  async saveContentEdit(draft: AssignmentDraft): Promise<void> {
    const row = this.editing();

    if (!row || this.saving()) {
      return;
    }

    this.saving.set(true);
    this.modalError.set('');

    try {
      await this.service.update(row.docId, draft as Partial<Assignment>);

      // Patched in place rather than reloaded: the row is already on screen and
      // the edit is known, so a round trip would only add a wait.
      this.rows.update(list =>
        list.map(item =>
          item.docId === row.docId ? ({ ...item, ...draft } as Assignment) : item
        )
      );
      this.flashNotice(`"${draft.displayName}" updated`);
      this.closeEdit();
    } catch (error) {
      this.modalError.set(this.service.describeError(error, 'Could not save the changes.'));
    } finally {
      this.saving.set(false);
    }
  }

  async saveNew(draft: AssignmentDraft): Promise<void> {
    if (this.saving()) {
      return;
    }

    this.saving.set(true);
    this.modalError.set('');

    try {
      const created = await this.service.create(draft);

      // Prepended rather than reloaded: the list is sorted newest-first, and a
      // round trip to see a row you just wrote is a wait for no new information.
      this.rows.update(list => [created, ...list]);
      this.flashNotice(`"${created.displayName}" created`);
      this.closeCreate();
    } catch (error) {
      this.modalError.set(this.service.describeError(error, 'Could not create the assignment.'));
    } finally {
      this.saving.set(false);
    }
  }

  // ---- Trash -------------------------------------------------------------

  askMoveToTrash(row: Assignment): void {
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
      this.flashNotice(`"${row.displayName}" moved to trash`);
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

  async restore(row: TrashedAssignment): Promise<void> {
    await this.rowAction(row.docId, 'Could not restore it.', async () => {
      await this.service.restore(row.docId);
      this.trashed.update(list => list.filter(item => item.docId !== row.docId));
      // Reloaded rather than patched: the restored document may carry fields
      // this app does not model, and the authoritative row is the stored one.
      await this.load();
      this.flashNotice(`"${row.displayName}" restored`);
    });
  }

  /** Permanent, single row. Only reachable from the Trash. */
  async purge(row: TrashedAssignment): Promise<void> {
    await this.rowAction(row.docId, 'Could not delete it.', async () => {
      await this.service.purge(row.docId);
      this.trashed.update(list => list.filter(item => item.docId !== row.docId));
      this.flashNotice(`"${row.displayName}" deleted permanently`);
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
      this.flashNotice(`${ids.length} assignment(s) deleted permanently`);
    } catch (error) {
      this.trashError.set(this.service.describeError(error, 'Could not empty the Trash.'));
      // A partial failure leaves the local list untrustworthy, so re-read rather
      // than guessing which deletes landed.
      await this.loadTrash();
    } finally {
      this.busyRow.set(null);
    }
  }

  /** A Firestore Timestamp to a Date, for the Deleted Date column. */
  toDate(value: { toDate?: () => Date } | null | undefined): Date | null {
    return value?.toDate ? value.toDate() : null;
  }

  /**
   * One row action at a time, with the failure reported and the flag cleared.
   *
   * The same helper the other four tables use. It exists so a row cannot be
   * restored and purged concurrently — the second would act on a document the
   * first had already moved.
   */
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

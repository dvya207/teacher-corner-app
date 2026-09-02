import { Component, computed, inject, input, output, signal } from '@angular/core';

import { Icon } from '../icon/icon';

import { localInputFromTimestamp, timestampFromLocalInput } from '../../core/local-datetime';
import { Assignment, ProgrammeAssignment } from '../../models/teaching.model';
import { ConfigurationService } from '../../services/configuration.service';

/** What the picker needs of an assignment, and all it needs. */
export interface PickableAssignment {
  docId: string;
  displayName: string;
  type: string;
}

/** Narrows a full assignment to what this panel renders. */
export function toPickableAssignments(rows: Assignment[]): PickableAssignment[] {
  return rows.map(row => ({
    docId: row.docId,
    displayName: row.displayName,
    type: row.type
  }));
}

/**
 * Choosing a programme's assignments — step 4 of Create Programme.
 *
 * THE SAME TWO-PANEL SHAPE as the learning-unit picker beside it, and it shares
 * that component's stylesheet rather than copying 430 lines of it: the panels,
 * the counts, the drag affordances and the empty state are the same furniture.
 * Only the filter, the card and the due date differ, and those live in this
 * component's own file.
 *
 * NO REORDER BUTTONS, WHICH IS THE REAL DIFFERENCE FROM THAT PICKER, and it
 * follows from the data rather than from taste. `learningUnitsIds` is an ARRAY and
 * positional — a classroom's per-unit locking lines up against it index for index
 * — so its picker has to expose the order. `assignmentIds` is a MAP keyed by doc
 * id, so there is no order to preserve and buttons that moved rows would imply a
 * sequence the document cannot hold.
 *
 * THE DUE DATE IS ASKED FOR IN A DIALOG, on the drop, as production asks for it:
 * "Set a due date for this Assignment", with Save disabled until a value is
 * chosen. A pencil on each selected row reopens it. This was an inline field on
 * the card; the dialog is what production does and what was asked for.
 *
 * CANCELLING AN ADD DOES NOT ADD, which is one deliberate difference. Production
 * moves the row into Selected as the drop lands and only then opens the dialog, so
 * dismissing it leaves a row on screen that was never recorded — the next save
 * writes nothing for it. Here the assignment is added only when Save is pressed,
 * so what is on screen is what will be stored.
 *
 * THE PICKER INSIDE THE DIALOG IS THE PLATFORM'S. Production's is Angular
 * Material's: a year grid, then a month, then days, then hour/minute/AM-PM
 * spinners. `datetime-local` gives the browser's own equivalent, which is
 * keyboard-accessible and localised for free — hand-building that grid would be
 * several hundred lines to arrive at the same value.
 *
 * PRESENTATIONAL. It takes the catalogue and the current selection and emits a
 * new one; it reads nothing and writes nothing.
 *
 * DRAG AND DROP IS NATIVE HTML5, for the reasons the learning-unit picker gives:
 * this project's dependencies are Angular, Firebase and a font, and the CDK would
 * be the first addition for one panel. The ✕ button stays because HTML5 drag
 * events do not fire on a touchscreen at all.
 */
@Component({
  selector: 'app-assignment-picker',
  imports: [Icon],
  templateUrl: './assignment-picker.html',
  styleUrls: [
    // The shared two-panel furniture. See the class note.
    '../learning-unit-picker/learning-unit-picker.css',
    './assignment-picker.css'
  ]
})
export class AssignmentPicker {

  private config = inject(ConfigurationService);

  /** The catalogue to choose from. */
  readonly assignments = input<PickableAssignment[]>([]);

  /** The current selection, keyed by doc id, as the document stores it. */
  readonly selected = input<Record<string, ProgrammeAssignment>>({});

  readonly selectedChange = output<Record<string, ProgrammeAssignment>>();

  /** '' is ALL. Production's filter opens on it. */
  readonly typeFilter = signal('');
  readonly query = signal('');

  /**
   * The working copy, edited here and emitted after every change.
   *
   * Rather than emitting and waiting for the parent to hand it back — that round
   * trip makes a drag feel laggy and, if the parent debounces, briefly wrong.
   */
  private readonly working = signal<Record<string, ProgrammeAssignment> | null>(null);

  readonly chosen = computed(() => this.working() ?? this.selected());

  /**
   * The filter's options: ALL, then the CREATABLE types.
   *
   * Production offers all five — UPLOAD, QUIZ, GAME, FORM, TEXTBLOCK — and GAME
   * and TEXTBLOCK are excluded here on instruction. Read from the configuration
   * service rather than listed, so this filter cannot drift from the Create menu:
   * both answer to Configuration/AssignmentTypes.creatableTypes.
   */
  readonly typeOptions = computed(() => [
    { value: '', label: 'ALL' },
    ...this.config.creatableAssignmentTypes().map(type => ({ value: type, label: type }))
  ]);

  /** The left column: everything not already chosen, filtered. */
  readonly available = computed(() => {
    const taken = this.chosen();
    const type = this.typeFilter();
    const query = this.query().trim().toLowerCase();

    return this.assignments().filter(row => {
      if (row.docId in taken) {
        return false;
      }

      if (type !== '' && row.type !== type) {
        return false;
      }

      if (query === '') {
        return true;
      }

      // Name and type, which is what the two lines of the card show.
      return (
        row.displayName.toLowerCase().includes(query) ||
        row.type.toLowerCase().includes(query)
      );
    });
  });

  /**
   * The right column.
   *
   * SORTED BY NAME, not by when it was added. The stored shape is a map, so there
   * is no insertion order to honour and an object's key order is not something to
   * rely on; a stable alphabetical list is what makes a selection of fifteen
   * readable and keeps the Review step's order matching this one.
   */
  readonly picked = computed(() => {
    const byId = new Map(this.assignments().map(row => [row.docId, row]));

    return Object.keys(this.chosen())
      .map(id => byId.get(id))
      .filter((row): row is PickableAssignment => row !== undefined)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  });

  readonly availableCount = computed(() => this.available().length);
  readonly selectedCount = computed(() => Object.keys(this.chosen()).length);

  /* ---- The due-date dialog ---------------------------------------------- */

  /**
   * Which assignment the dialog is open for, and whether it is an add or an edit.
   *
   * ONE SIGNAL FOR BOTH, because the dialog is the same either way; only what
   * happens on Save differs, and on Cancel. `null` means closed.
   */
  readonly dueDialog = signal<{ docId: string; mode: 'add' | 'edit' } | null>(null);

  /** The value being edited, as `datetime-local` holds it. */
  readonly dueDialogValue = signal('');

  /** The assignment the dialog is about, for its heading. */
  readonly dueDialogRow = computed(() => {
    const open = this.dueDialog();

    return open
      ? (this.assignments().find(row => row.docId === open.docId) ?? null)
      : null;
  });

  /** Save is refused without a value, as production's is. */
  readonly dueDialogValid = computed(() => this.dueDialogValue() !== '');

  /**
   * Opens the dialog for an assignment being ADDED.
   *
   * Nothing is added yet — see the note on the class. The row joins the selection
   * only when Save is pressed.
   */
  openDueDialogForAdd(docId: string): void {
    if (docId in this.chosen()) {
      return;
    }

    this.dueDialogValue.set('');
    this.dueDialog.set({ docId, mode: 'add' });
  }

  /** Reopens it for something already chosen, seeded with its current value. */
  openDueDialogForEdit(docId: string): void {
    if (!(docId in this.chosen())) {
      return;
    }

    this.dueDialogValue.set(this.dueDateFor(docId));
    this.dueDialog.set({ docId, mode: 'edit' });
  }

  /**
   * Save.
   *
   * An ADD writes the entry for the first time; an EDIT replaces the date and
   * keeps the id. Refused without a value, so the dialog cannot store null.
   */
  saveDueDialog(): void {
    const open = this.dueDialog();

    if (!open || !this.dueDialogValid()) {
      return;
    }

    this.commit({
      ...this.chosen(),
      [open.docId]: {
        assignmentId: open.docId,
        assignmentDueDate: timestampFromLocalInput(this.dueDialogValue())
      }
    });

    this.dueDialog.set(null);
    this.dueDialogValue.set('');
  }

  /**
   * Cancel.
   *
   * An ADD is abandoned entirely — nothing was added, so there is nothing to undo.
   * An EDIT leaves the stored date alone.
   */
  closeDueDialog(): void {
    this.dueDialog.set(null);
    this.dueDialogValue.set('');
  }

  /**
   * The due date as a sentence, for the selected card.
   *
   * `toLocaleString` rather than the date pipe, because the card composes it
   * inside a span this component already fills; the Review step uses the pipe
   * where it has a template row to itself.
   */
  dueLabelFor(docId: string): string {
    const stamp = this.chosen()[docId]?.assignmentDueDate;

    if (!stamp?.toDate) {
      return '';
    }

    return stamp.toDate().toLocaleString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  /** The due date as an `<input type="datetime-local">` wants it. */
  dueDateFor(docId: string): string {
    return localInputFromTimestamp(this.chosen()[docId]?.assignmentDueDate);
  }

  /**
   * Sets or clears the due date on an already-chosen assignment.
   *
   * NOT WIRED TO THE CARD ANY MORE — the dialog owns that now. It stays because it
   * is the one place that turns a `datetime-local` string into the stored
   * Timestamp, and `saveDueDialog` is a caller of the same conversion; a second
   * copy of that logic is how the two would drift.
   *
   * Built from the LOCAL parts rather than by parsing the string, for the reason
   * timestampFromLocalInput gives.
   */
  setDueDate(docId: string, value: string): void {
    const entry = this.chosen()[docId];

    if (!entry) {
      return;
    }

    this.commit({
      ...this.chosen(),
      [docId]: { ...entry, assignmentDueDate: value === '' ? null : timestampFromLocalInput(value) }
    });
  }

  add(docId: string): void {
    if (docId in this.chosen()) {
      return;
    }

    this.commit({
      ...this.chosen(),
      // The id is stored inside the entry as well as being the key, which is
      // production's own redundancy.
      [docId]: { assignmentId: docId, assignmentDueDate: null }
    });
  }

  remove(docId: string): void {
    const next = { ...this.chosen() };

    delete next[docId];
    this.commit(next);
  }

  private commit(next: Record<string, ProgrammeAssignment>): void {
    this.working.set(next);
    this.selectedChange.emit(next);
  }

  // ---- Drag and drop -----------------------------------------------------

  readonly draggingId = signal('');
  readonly draggingFrom = signal<'available' | 'selected' | ''>('');
  readonly dropOnSelected = signal(false);
  readonly dropOnAvailable = signal(false);

  onDragStart(event: DragEvent, docId: string, from: 'available' | 'selected'): void {
    this.draggingId.set(docId);
    this.draggingFrom.set(from);

    // REQUIRED by Firefox: a drag with an empty DataTransfer is cancelled there
    // before any dragover fires. The value is unused.
    event.dataTransfer?.setData('text/plain', docId);

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onDragEnd(): void {
    this.draggingId.set('');
    this.draggingFrom.set('');
    this.dropOnSelected.set(false);
    this.dropOnAvailable.set(false);
  }

  /**
   * preventDefault is what makes an element a drop target — without it the
   * browser's default handling wins and `drop` never fires at all.
   */
  onDragOverSelected(event: DragEvent): void {
    if (this.draggingFrom() !== 'available') {
      return;
    }

    event.preventDefault();
    this.dropOnSelected.set(true);
    this.dropOnAvailable.set(false);
  }

  onDragOverAvailable(event: DragEvent): void {
    // Only meaningful coming FROM Selected: highlighting the left column for a
    // row that already lives there would promise something that does nothing.
    if (this.draggingFrom() !== 'selected') {
      return;
    }

    event.preventDefault();
    this.dropOnAvailable.set(true);
    this.dropOnSelected.set(false);
  }

  onDropSelected(event: DragEvent): void {
    event.preventDefault();

    const docId = this.draggingId();

    // THE DIALOG, not a bare add: production asks for the due date on the drop.
    // onDragEnd first, so the drag state is clear before the modal takes focus.
    this.onDragEnd();

    if (docId !== '') {
      this.openDueDialogForAdd(docId);
    }
  }

  onDropAvailable(event: DragEvent): void {
    event.preventDefault();

    if (this.draggingFrom() === 'selected') {
      this.remove(this.draggingId());
    }

    this.onDragEnd();
  }

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }
}

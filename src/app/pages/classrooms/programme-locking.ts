import { Component, computed, input, output, signal } from '@angular/core';

import { Timestamp } from 'firebase/firestore';

import { Icon } from '../../components/icon/icon';
import { ClassroomProgramme, ClassroomProgrammeWorkflow } from '../../models/teaching.model';

/** One learning unit of the programme, in the order the programme lists them. */
export interface LockableUnit {
  learningUnitId: string;
  name: string;
}

/** The editable form of one unit's row, with the dates as input strings. */
interface UnitLockDraft {
  learningUnitId: string;
  workflowId: string;
  openAt: string;
  closeAt: string;
  workflowLocked: boolean;
}

/** `2026-08-17T15:30`, which is what a datetime-local input reads and writes. */
function toInputValue(value: unknown): string {
  if (!value || value === '' || value === 'Invalid date') {
    return '';
  }

  const date = typeof value === 'object' && value !== null && 'toDate' in value
    ? (value as Timestamp).toDate()
    : new Date(value as string);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  // Local, NOT toISOString: a datetime-local input has no timezone, so an ISO
  // string would shift every stored time by the viewer's offset.
  const pad = (part: number) => String(part).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
         `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toStored(value: string): Timestamp | '' {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? '' : Timestamp.fromDate(date);
}

/**
 * Edit locking details for this programme's learning units.
 *
 * Production's dialog, rebuilt: one programme-wide sequential lock, then per
 * learning unit an Open At date, a Close At date and a workflow lock. The unit
 * list is a strip of tabs because a classroom's programme can carry twenty of
 * them and production shows one at a time.
 *
 * WHAT IT DOES NOT DO: write to Firestore. It emits the changed programme entry
 * and the classroom modal folds it into its pending edits, so the classroom's
 * own Save Changes is what writes — the same rule every other modal in this app
 * follows, and what lets a failed save keep the user's input.
 *
 * ZONELESS: every value the template reads is a signal.
 */
@Component({
  selector: 'app-programme-locking',
  imports: [Icon],
  templateUrl: './programme-locking.html',
  styleUrl: './programme-locking.css',
  host: { '(document:keydown.escape)': 'close()' }
})
export class ProgrammeLocking {

  /** The classroom's entry for this programme, holding any existing locks. */
  readonly programme = input.required<ClassroomProgramme>();

  /** The programme's learning units, in the programme's own order. */
  readonly units = input.required<LockableUnit[]>();

  readonly saved = output<Partial<ClassroomProgramme>>();
  readonly closed = output<void>();

  // ---- Working copy ------------------------------------------------------

  /**
   * Seeded on first read rather than in a constructor, because an input is not
   * readable until after construction.
   */
  private readonly edited = signal<{
    sequentiallyLocked: boolean;
    rows: UnitLockDraft[];
  } | null>(null);

  /** The stored state, as the form sees it. Also the baseline for `dirty`. */
  private readonly initial = computed(() => {
    const entry = this.programme();
    const stored = entry.workflowIds ?? [];

    return {
      sequentiallyLocked: entry.sequentiallyLocked ?? false,
      rows: this.units().map((unit, index) => {
        // Positional, as production stores it, but the id is checked: a
        // mismatched row means the programme's unit list changed since the
        // locks were written, and adopting those dates would attach them to the
        // wrong unit.
        const row: ClassroomProgrammeWorkflow | undefined = stored[index];
        const aligned = row && (!row.learningUnitId || row.learningUnitId === unit.learningUnitId)
          ? row
          : undefined;

        return {
          learningUnitId: unit.learningUnitId,
          workflowId: aligned?.workflowId ?? '',
          // `||`, not `??`. Production writes '' for "no date", so a document
          // half-migrated from the old names carries openAt: '' NEXT TO a real
          // lockAt, and `??` would read the empty string and drop the date.
          openAt: toInputValue(aligned?.openAt || aligned?.lockAt || ''),
          closeAt: toInputValue(aligned?.closeAt || aligned?.unlockAt || ''),
          workflowLocked: aligned?.workflowLocked ?? false
        };
      })
    };
  });

  private readonly form = computed(() => this.edited() ?? this.initial());

  readonly sequentiallyLocked = computed(() => this.form().sequentiallyLocked);
  readonly rows = computed(() => this.form().rows);

  /** Which unit's tab is open. Index, because the storage is positional. */
  readonly activeIndex = signal(0);

  readonly activeRow = computed<UnitLockDraft | null>(
    () => this.rows()[this.activeIndex()] ?? null
  );

  readonly hasUnits = computed(() => this.units().length > 0);

  select(index: number): void {
    this.activeIndex.set(index);
  }

  // ---- Editing -----------------------------------------------------------

  /**
   * Sequential unlocking and date unlocking are mutually exclusive, so turning
   * this on CLEARS every date, exactly as production does. Clearing rather than
   * only disabling matters: a date left behind would come back into force the
   * moment the toggle went off again, without anyone having typed it.
   */
  toggleSequential(): void {
    const form = this.form();
    const next = !form.sequentiallyLocked;

    this.edited.set({
      sequentiallyLocked: next,
      rows: next
        ? form.rows.map(row => ({ ...row, openAt: '', closeAt: '' }))
        : form.rows.map(row => ({ ...row }))
    });
  }

  setOpenAt(value: string): void {
    this.patchActive({ openAt: value });
  }

  setCloseAt(value: string): void {
    this.patchActive({ closeAt: value });
  }

  toggleWorkflowLocked(): void {
    const row = this.activeRow();

    if (row) {
      this.patchActive({ workflowLocked: !row.workflowLocked });
    }
  }

  private patchActive(patch: Partial<UnitLockDraft>): void {
    const form = this.form();
    const index = this.activeIndex();

    this.edited.set({
      sequentiallyLocked: form.sequentiallyLocked,
      rows: form.rows.map((row, at) => (at === index ? { ...row, ...patch } : { ...row }))
    });
  }

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  // ---- Save --------------------------------------------------------------

  /**
   * Save is shut until something actually changes, and shuts again if the value
   * is put back. Compared as a whole rather than field by field, because the
   * sequential toggle rewrites every row's dates in one go.
   */
  readonly dirty = computed(() =>
    JSON.stringify(this.form()) !== JSON.stringify(this.initial())
  );

  save(): void {
    if (!this.dirty()) {
      return;
    }

    const form = this.form();

    this.saved.emit({
      sequentiallyLocked: form.sequentiallyLocked,
      workflowIds: form.rows.map(row => ({
        learningUnitId: row.learningUnitId,
        workflowId: row.workflowId,
        // Emptied deliberately when the sequence is in charge of unlocking.
        openAt: form.sequentiallyLocked ? '' : toStored(row.openAt),
        closeAt: form.sequentiallyLocked ? '' : toStored(row.closeAt),
        workflowLocked: row.workflowLocked
      }))
    });
  }

  close(): void {
    this.closed.emit();
  }
}

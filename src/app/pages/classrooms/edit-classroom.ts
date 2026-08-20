import { Component, computed, input, output, signal } from '@angular/core';

import { Timestamp } from 'firebase/firestore';

import { Icon } from '../../components/icon/icon';
import { LockableUnit, ProgrammeLocking } from './programme-locking';
import {
  classroomTitle,
  classroomTypeLabel,
  programmeTypeFor
} from '../../data/classroom-options';
import {
  Classroom,
  ClassroomProgramme,
  ClassroomProgrammeWorkflow,
  LearningUnit,
  Programme
} from '../../models/teaching.model';
import { programmesFor } from '../../services/programme.service';
import { isActiveStatus } from '../../data/programme-options';
import { toClassroomProgramme } from '../../services/classroom.service';

/** The two halves of the Manage Programmes picker, and its two drop zones. */
export type PickerPane = 'available' | 'selected';

/** Two dates are the same when they mean the same instant, or both mean none. */
function sameLockDate(a: Timestamp | '' | undefined, b: Timestamp | '' | undefined): boolean {
  const left = a || '';
  const right = b || '';

  if (left === '' || right === '') {
    return left === right;
  }

  // toMillis, not ===: a Timestamp read back from Firestore is a different
  // object from the one that was written.
  return left.toMillis() === right.toMillis();
}

function sameWorkflow(
  a: ClassroomProgrammeWorkflow,
  b: ClassroomProgrammeWorkflow | undefined
): boolean {
  return b !== undefined &&
    a.learningUnitId === b.learningUnitId &&
    a.workflowLocked === b.workflowLocked &&
    sameLockDate(a.openAt || a.lockAt, b.openAt || b.lockAt) &&
    sameLockDate(a.closeAt || a.unlockAt, b.closeAt || b.unlockAt);
}

function sameProgrammeEntry(
  a: ClassroomProgramme | undefined,
  b: ClassroomProgramme | undefined
): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }

  if (a.displayName !== b.displayName ||
      a.programmeName !== b.programmeName ||
      a.programmeCode !== b.programmeCode) {
    return false;
  }

  // Absent means false: production deletes the key rather than storing false.
  if ((a.sequentiallyLocked ?? false) !== (b.sequentiallyLocked ?? false)) {
    return false;
  }

  const left = a.workflowIds ?? [];
  const right = b.workflowIds ?? [];

  return left.length === right.length &&
    left.every((row, index) => sameWorkflow(row, right[index]));
}

/**
 * Whether two programme selections are the same, entries and all.
 *
 * Compared over the UNION of the ids, so a programme present on one side only
 * counts as a difference rather than being skipped.
 */
function sameProgrammeMaps(
  a: Record<string, ClassroomProgramme>,
  b: Record<string, ClassroomProgramme>
): boolean {
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);

  return [...ids].every(id => sameProgrammeEntry(a[id], b[id]));
}

/**
 * Edit Classroom — the tabbed detail modal, mirroring Edit Institution.
 *
 *   Basic Info   the classroom's own fields
 *   Programmes   the Available / Selected picker
 *
 * WHY THIS EXISTS. Until now the classroom table's edit button opened Manage
 * Programmes and nothing else, so a classroom's SECTION could be chosen at
 * creation and never corrected — a typo meant deleting the row and rebuilding
 * it, which also lost its programmes. Institutions has had a tabbed editor since
 * it was built; this brings classrooms to the same level, which is the whole of
 * the classroom half of Day 8.
 *
 * WHAT IS NOT EDITABLE, and why:
 *
 *   type          A classroom and a STEM club carry different fields. Flipping
 *                 the type would leave the other variant's fields populated and
 *                 meaningless, and production has no such control either.
 *   school        Moving a classroom between schools would orphan it from the
 *                 institution whose classroomCode sequence it belongs to.
 *   classroomCode Allocated per school at creation; reassigning it could collide
 *                 with a sibling.
 *
 * Grade is editable but section is what usually needs fixing, so both are here
 * with the same "already taken at this school" filtering the Add form applies.
 *
 * ZONELESS. Every field the template reads is a signal.
 */
@Component({
  selector: 'app-edit-classroom',
  imports: [Icon, ProgrammeLocking],
  templateUrl: './edit-classroom.html',
  styleUrl: './edit-classroom.css',
  /**
   * Escape dismisses the modal. On the DOCUMENT, not the template: the backdrop
   * is a div that never takes focus, so a keydown bound to it would never fire.
   */
  host: { '(document:keydown.escape)': 'close()' }
})
export class EditClassroom {

  readonly classroom = input.required<Classroom>();
  /** The catalogue, unfiltered. Narrowed here, not by the caller. */
  readonly programmes = input.required<Programme[]>();
  /**
   * Set when the catalogue read itself failed.
   *
   * The page loads programmes with allSettled and falls back to [], so a
   * permissions failure and an empty catalogue arrive here looking identical.
   * Without this the picker would report "no programmes created yet" for a read
   * that was actually denied.
   */
  readonly catalogueError = input('');

  /**
   * The learning units catalogue, for the locking dialog's tab strip.
   *
   * Names only ever come from here. A classroom's programme entry stores unit
   * IDS and nothing else, so without this the tabs would read as raw ids.
   */
  readonly learningUnits = input<LearningUnit[]>([]);

  readonly saving = input(false);
  readonly error = input('');

  readonly saved = output<Partial<Classroom>>();
  readonly closed = output<void>();

  readonly title = computed(() => classroomTitle(this.classroom()));
  readonly typeLabel = computed(() => classroomTypeLabel(this.classroom().type));

  /**
   * The working copy. `null` means untouched, so every getter falls through to
   * the stored value. Seeded by computeds rather than an ngOnInit assignment,
   * because the input arrives before the first render.
   */
  private readonly edits = signal<Partial<Classroom> | null>(null);

  private field<K extends keyof Classroom>(key: K): Classroom[K] {
    const edited = this.edits();

    return (edited && key in edited ? edited[key] : this.classroom()[key]) as Classroom[K];
  }

  private patch<K extends keyof Classroom>(key: K, value: Classroom[K]): void {
    this.edits.update(current => ({ ...(current ?? {}), [key]: value }));
  }

  // ---- The classroom's own fields ----------------------------------------

  /**
   * READ ONLY now. Basic Info was removed from this dialog on instruction, and
   * production's classroom dialog is likewise only Manage Programmes, so nothing
   * here is editable — but the grade and the type still decide which programmes
   * the picker may offer, so they are still read.
   */
  readonly grade = computed(() => this.field('grade'));

  // ---- Programmes tab ----------------------------------------------------

  readonly searchTerm = signal('');
  readonly showAll = signal(false);

  setSearch(value: string): void {
    this.searchTerm.set(value);
  }

  toggleShowAll(): void {
    this.showAll.update(current => !current);
  }

  readonly selectedProgrammes = computed<ClassroomProgramme[]>(
    () => Object.values(this.field('programmes') ?? {})
  );

  private readonly selectedIds = computed(
    () => new Set(this.selectedProgrammes().map(programme => programme.programmeId))
  );

  /**
   * The left pane, BEFORE the search box narrows it.
   *
   * Two modes:
   *
   *   default    this classroom's school, its type, and its grade
   *   show all   every school, still only live programmes of the right type
   *
   * "Show all" WIDENS THE SCHOOL AND THE GRADE, nothing else. Its purpose is
   * finding a programme filed under the wrong institution or scoped to a grade
   * this classroom is not, which is exactly the case where the default list
   * comes back empty. It deliberately does NOT drop the type or the live check:
   * offering a STEM club a REGULAR programme, or a half-finished one, produces a
   * classroom no other screen in the app would have let you build.
   *
   * It used to return nothing at all until a search term was typed — copied from
   * production, which guards a ten-thousand-row catalogue that way. This app's
   * catalogue is one teacher's, so the gate bought nothing and made the checkbox
   * do the opposite of what it says.
   */
  private readonly candidates = computed(() => {
    const current = this.classroom();
    const wanted = programmeTypeFor(current.type);

    if (this.showAll()) {
      return this.programmes().filter(programme =>
        isActiveStatus(programme.programmeStatus) && programme.type === wanted
      );
    }

    return programmesFor(this.programmes(), {
      institutionId: current.institutionId,
      type: wanted,
      grade: this.grade()
    });
  });

  readonly available = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const chosen = this.selectedIds();

    return this.candidates()
      .filter(programme => !chosen.has(programme.programmeId))
      .filter(programme =>
        !term ||
        programme.programmeName.toLowerCase().includes(term) ||
        programme.displayName.toLowerCase().includes(term) ||
        programme.programmeCode.toLowerCase().includes(term)
      );
  });

  /**
   * Why the Available pane is empty, in the user's terms.
   *
   * WHY THIS EXISTS. Three of the filters above can legitimately empty the pane —
   * wrong school, wrong grade, wrong type — and a fourth (not live) can too. All
   * of them used to fail silently, so "AVAILABLE 0" was the only signal and it
   * could mean any of six different things. Each branch names the count it found
   * and, where the fix is a click away, points at it.
   *
   * Tested in order of how far the candidate got: a programme rejected for its
   * type is a different problem from one rejected for its grade, and reporting
   * the first failing gate is what makes the message actionable.
   */
  readonly emptyReason = computed(() => {
    if (this.available().length > 0) {
      return '';
    }

    if (this.catalogueError()) {
      return this.catalogueError();
    }

    const all = this.programmes();

    if (all.length === 0) {
      return 'No programmes exist yet. Create one on the Programme page, then reopen this.';
    }

    const current = this.classroom();
    const wanted = programmeTypeFor(current.type);
    const term = this.searchTerm().trim();

    // Already-chosen programmes are filtered out of Available by design.
    if (this.candidates().length > 0 && !term) {
      return 'Every matching programme is already selected.';
    }

    if (term && this.candidates().length > 0) {
      return `Nothing matches “${term}”.`;
    }

    const live = all.filter(programme => isActiveStatus(programme.programmeStatus));

    if (live.length === 0) {
      return `All ${all.length} programme(s) are still in development. ` +
             'Set one to Live on the Programme page.';
    }

    const rightType = live.filter(programme => programme.type === wanted);

    if (rightType.length === 0) {
      return `None of the ${live.length} live programme(s) are ${wanted} — ` +
             `this is a ${current.type === 'STEM-CLUB' ? 'STEM club' : 'classroom'}.`;
    }

    // Past this point the only gates left are school and grade, and "show all"
    // drops both — so if it is already on, the type filter is what is biting.
    if (this.showAll()) {
      return `No ${wanted} programme is available to add.`;
    }

    const sameSchool = rightType.filter(
      programme => programme.institutionId === current.institutionId
    );

    if (sameSchool.length === 0) {
      return `${rightType.length} programme(s) exist, but none belong to ` +
             `${current.institutionName}. Tick “Show all programmes” to use one anyway.`;
    }

    return `${sameSchool.length} programme(s) exist for this school, but none cover ` +
           `grade ${this.grade() || '—'}. Tick “Show all programmes” to use one anyway.`;
  });

  addProgramme(programme: Programme): void {
    this.patch('programmes', {
      ...(this.field('programmes') ?? {}),
      [programme.programmeId]: toClassroomProgramme(programme)
    });
  }

  removeProgramme(programmeId: string): void {
    const { [programmeId]: _removed, ...rest } = this.field('programmes') ?? {};

    this.patch('programmes', rest);
  }

  /** Enter and Space act on a focused row, so the panes work without a mouse. */
  onRowKey(event: Event, programme: Programme): void {
    // Space scrolls the pane otherwise, which moves the row out from under the
    // cursor at the exact moment it is being acted on.
    event.preventDefault();
    this.addProgramme(programme);
  }

  // ---- Locking details ---------------------------------------------------

  /**
   * The selected programme whose locking dialog is open, or null.
   *
   * Held by programmeId rather than by object, so it keeps pointing at the right
   * entry after an edit replaces the map.
   */
  readonly lockingId = signal<string | null>(null);

  readonly lockingProgramme = computed<ClassroomProgramme | null>(() => {
    const id = this.lockingId();

    return id === null ? null : (this.field('programmes') ?? {})[id] ?? null;
  });

  /**
   * The learning units of the programme being locked, in the PROGRAMME's order.
   *
   * That order is the contract: the locks are stored positionally against
   * `learningUnitsIds`, so listing them any other way would attach a date to the
   * wrong unit. A unit whose document is missing from the catalogue still gets a
   * tab, labelled with its id, rather than silently shifting the rest up.
   */
  readonly lockingUnits = computed<LockableUnit[]>(() => {
    const id = this.lockingId();

    if (id === null) {
      return [];
    }

    const catalogue = this.programmes().find(row => row.programmeId === id);
    const byId = new Map(this.learningUnits().map(unit => [unit.learningUnitId, unit]));

    return (catalogue?.learningUnitsIds ?? []).map(unitId => {
      const unit = byId.get(unitId);

      return {
        learningUnitId: unitId,
        name: unit
          ? (unit.learningUnitDisplayName || unit.learningUnitName || unitId)
          : unitId
      };
    });
  });

  openLocking(programmeId: string): void {
    this.lockingId.set(programmeId);
  }

  closeLocking(): void {
    this.lockingId.set(null);
  }

  /**
   * Folds the dialog's locks into this classroom's pending edits.
   *
   * NOT a Firestore write: the classroom's own Save Changes stays the single
   * point that writes, so locking details and a changed selection go together in
   * one update rather than as two writes that could half-succeed.
   */
  applyLocking(patch: Partial<ClassroomProgramme>): void {
    const id = this.lockingId();
    const current = this.field('programmes') ?? {};
    const entry = id === null ? undefined : current[id];

    if (!id || !entry) {
      this.closeLocking();
      return;
    }

    this.patch('programmes', { ...current, [id]: { ...entry, ...patch } });
    this.closeLocking();
  }

  /** Whether a selected programme carries any locking at all, for its row. */
  hasLocking(programme: ClassroomProgramme): boolean {
    return programme.sequentiallyLocked === true ||
      (programme.workflowIds ?? []).some(
        row => row.workflowLocked || row.openAt !== '' || row.closeAt !== ''
      );
  }

  // ---- Drag and drop -----------------------------------------------------

  /**
   * Dragging between the panes, as an alternative to the row buttons.
   *
   * NATIVE HTML5 drag, not a library: the two panes are unordered sets, so the
   * only gesture to support is "move this row to that pane". No CDK dependency
   * buys anything here.
   *
   * WHAT DRAGGING CANNOT DO: reorder within Selected. A classroom stores its
   * programmes as a MAP keyed by programmeId, and a map has no order, so a
   * dragged position could not survive the save. Rather than animate a
   * reordering that silently reverts on reload, dropping inside the pane a row
   * came from is a no-op.
   *
   * The drag state lives in signals rather than only on the dataTransfer,
   * because dataTransfer.getData is unreadable during dragover in every browser
   * — the drop target has to decide whether to accept the drop before it is
   * allowed to look at the payload.
   */
  readonly dragging = signal<{ programmeId: string; from: PickerPane } | null>(null);

  /** The pane currently under the pointer, for the drop highlight. */
  readonly dropTarget = signal<PickerPane | null>(null);

  onDragStart(event: DragEvent, programmeId: string, from: PickerPane): void {
    this.dragging.set({ programmeId, from });

    // The id goes on the dataTransfer as well, so a drop is still resolvable if
    // the drag somehow outlives the component's state.
    event.dataTransfer?.setData('text/plain', programmeId);

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onDragEnd(): void {
    this.dragging.set(null);
    this.dropTarget.set(null);
  }

  /**
   * preventDefault is what MAKES a element a drop target: without it the browser
   * rejects the drop. Calling it only for a drag this pane accepts is therefore
   * how "no entry" is expressed on the pane a row came from.
   */
  onDragOver(event: DragEvent, pane: PickerPane): void {
    if (!this.accepts(pane)) {
      return;
    }

    event.preventDefault();

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }

    this.dropTarget.set(pane);
  }

  onDragLeave(pane: PickerPane): void {
    if (this.dropTarget() === pane) {
      this.dropTarget.set(null);
    }
  }

  onDrop(event: DragEvent, pane: PickerPane): void {
    event.preventDefault();

    // Read the drag state BEFORE clearing it. Deciding whether to accept the
    // drop from a signal this method had already reset is what made every drop a
    // silent no-op the first time round.
    const active = this.dragging();
    const programmeId = active?.programmeId ?? event.dataTransfer?.getData('text/plain') ?? '';
    const accepted = active !== null && active.from !== pane;

    this.dropTarget.set(null);
    this.dragging.set(null);

    if (!programmeId || !accepted) {
      return;
    }

    if (pane === 'available') {
      this.removeProgramme(programmeId);
      return;
    }

    // Resolved from candidates(), not from available(): candidates is the set
    // that has already passed the type and live guards, so a drop can never add
    // a programme the buttons would have refused.
    const programme = this.candidates().find(row => row.programmeId === programmeId);

    if (programme) {
      this.addProgramme(programme);
    }
  }

  /** A pane accepts a drag only from the other pane. */
  private accepts(pane: PickerPane): boolean {
    const active = this.dragging();

    return active !== null && active.from !== pane;
  }

  // ---- Save --------------------------------------------------------------

  readonly dirty = computed(() => {
    const edited = this.edits();

    if (!edited) {
      return false;
    }

    return Object.entries(edited).some(([key, value]) => {
      const original = this.classroom()[key as keyof Classroom];

      // The programmes map is compared BY VALUE, not by its key set.
      //
      // It used to compare only the ids, on the reasoning that the entries are
      // copies of the same four catalogue fields. Locking details broke that:
      // they change an entry without changing which programmes are selected, so
      // an id-only comparison left Save Changes shut over an edit that existed
      // and could never be written.
      if (key === 'programmes') {
        return !sameProgrammeMaps(
          value as Record<string, ClassroomProgramme>,
          (original ?? {}) as Record<string, ClassroomProgramme>
        );
      }

      return value !== original;
    });
  });

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  /**
   * Emits the pending edits, which can now only be the programmes map.
   *
   * classroomName used to be recomposed here, because a grade or section edit
   * had to rewrite it. Neither is editable in this dialog any more, so there is
   * nothing to recompose and nothing to validate: the only gate is that
   * something actually changed.
   */
  save(): void {
    if (this.saving() || !this.dirty()) {
      return;
    }

    this.saved.emit({ ...(this.edits() ?? {}) });
  }

  close(): void {
    this.closed.emit();
  }
}

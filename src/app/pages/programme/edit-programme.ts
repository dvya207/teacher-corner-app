import { Component, computed, input, output, signal, inject } from '@angular/core';
import { ConfigurationService } from '../../services/configuration.service';

import {
  AssignmentPicker,
  PickableAssignment
} from '../../components/assignment-picker/assignment-picker';
import { Icon } from '../../components/icon/icon';
import { LearningUnitPicker } from '../../components/learning-unit-picker/learning-unit-picker';
import {
  isActiveStatus,
  rangeLabel,
  scopeOf,
  statusLabel
} from '../../data/programme-options';
import {
  PickableUnit,
  Programme,
  ProgrammeAssignment
} from '../../models/teaching.model';

/**
 * Edit Programme — the Basic Info form.
 *
 * THREE PANES, production's own: Basic Info, Manage Learning Units and Manage
 * Assignments. The last two were each removed at one point and each came back;
 * without them a programme's units and assignments could only be set at creation,
 * so changing either meant recreating the programme. Nothing about the
 * learningUnits collection, its rules or its trash changed with them — only this
 * dialog's tabs and the reads that fed them, so a programme's stored
 * `learningUnitsIds` is left exactly as it is, written by
 * nothing and read by nothing here.
 *
 * WHAT BASIC INFO SHOWS, AND WHAT IT DOES NOT. The field set is production's
 * add-new-programme form as it renders in EDIT mode, which is not the same as
 * how it renders when creating:
 *
 *   programmeCode   shown, READ-ONLY. Production marks it [readonly]="true" —
 *                   it comes from the sequence and is never retyped.
 *   Institution     shown, READ-ONLY, and only here: production guards it with
 *                   *ngIf="!addNewProgramFlag", because when creating, the
 *                   school was already chosen in step one.
 *   grade / age     NOT SHOWN. Production guards the whole block with
 *                   *ngIf="showAgeGrade", and showAgeGrade is only ever set
 *                   inside the create-mode unlock chain. So a programme's grade
 *                   range is fixed at creation there, and is fixed here too.
 *
 * An earlier version of this modal offered grade and age here. That was a
 * control production does not have, and it has been removed rather than left as
 * a quiet divergence.
 *
 * ZONELESS. Every field the template reads is a signal.
 */
@Component({
  selector: 'app-edit-programme',
  imports: [AssignmentPicker, Icon, LearningUnitPicker],
  templateUrl: './edit-programme.html',
  styleUrl: './edit-programme.css',
  /**
   * Escape dismisses the modal. On the DOCUMENT, not the template: the backdrop
   * is a div that never takes focus, so a keydown bound to it would never fire.
   */
  host: { '(document:keydown.escape)': 'close()' }
})
export class EditProgramme {

  /**
   * Option lists, read from the Configuration collection in Firestore.
   *
   * The properties below are its SIGNALS, so a list edited in the console reaches
   * this form without a deploy. Each falls back to the constant it replaced, so a
   * refused read renders the options the app shipped with rather than empty selects.
   */
  private config = inject(ConfigurationService);

  readonly programme = input.required<Programme>();

  /**
   * The learning-unit catalogue, for the Manage Learning Units tab.
   *
   * Supplied by the parent, like the wizard's is: this dialog reads nothing, and
   * toPickableUnits is where the live filter and the row shape live.
   */
  readonly units = input<PickableUnit[]>([]);

  readonly saving = input(false);
  readonly error = input('');

  /**
   * The assignments to choose from, for the Manage Assignments tab.
   *
   * Defaulted to empty so the tab renders its own "No assignments available"
   * rather than the caller needing to know whether there are any.
   */
  readonly assignments = input<PickableAssignment[]>([]);

  readonly saved = output<Partial<Programme>>();
  readonly closed = output<void>();

  readonly statuses = this.config.programmeStatuses;
  readonly types = this.config.programmeTypes;

  /**
   * The working copy. `null` means untouched, so every getter below falls
   * through to the stored value until the user actually edits that field.
   *
   * Seeded by computeds rather than an ngOnInit assignment — the input arrives
   * before the first render, and a signal set in a lifecycle hook renders one
   * frame of empty fields first.
   */
  private readonly edits = signal<Partial<Programme> | null>(null);

  /* ======================================================================
     TABS — Basic Info, Manage Learning Units, Manage Assignments

     ALL THREE EDIT THROUGH THE SAME MECHANISM, which is the point worth stating
     because it is what makes "whatever is edited lands in the right field" true
     rather than hopeful: every tab calls `patch(field, value)`, `save()` emits
     the accumulated `Partial<Programme>`, and ProgrammeService.update writes it.
     That update strips only the identity fields — docId, programmeId, ownerId,
     programmeCode, createdAt — and passes everything else through, so
     `learningUnitsIds` and `assignmentIds` persist by the same route as
     `programmeName`.

     TWO FIELDS, TWO SHAPES. `learningUnitsIds` is an ARRAY and positional;
     `assignmentIds` is a MAP keyed by doc id. Each tab's picker matches its own
     shape, which is why they are two components rather than one parameterised
     one — see the note on AssignmentPicker.
     ====================================================================== */

  readonly tabs = ['Basic Info', 'Learning Units', 'Assignments'] as const;
  readonly tab = signal<(typeof this.tabs)[number]>('Basic Info');

  /**
   * The units currently attached, in order.
   *
   * The EDIT if one has been made, otherwise what is stored — the same rule
   * every other field here follows, so an untouched tab reports the stored list
   * and a touched one reports the pending change.
   */
  readonly selectedIds = computed(
    () => this.edits()?.learningUnitsIds ?? this.programme().learningUnitsIds ?? []
  );

  setUnits(ids: string[]): void {
    this.patch('learningUnitsIds', ids);
  }

  /**
   * The assignments currently attached, keyed by doc id.
   *
   * The EDIT if one has been made, otherwise what is stored — the same rule every
   * other field here follows. `?? {}` rather than leaving it undefined: most
   * programmes have no such key, and the picker needs a map to read.
   */
  readonly selectedAssignments = computed(
    () => this.edits()?.assignmentIds ?? this.programme().assignmentIds ?? {}
  );

  setAssignments(map: Record<string, ProgrammeAssignment>): void {
    this.patch('assignmentIds', map);
  }

  private field<K extends keyof Programme>(key: K): Programme[K] {
    const edited = this.edits();

    return (edited && key in edited ? edited[key] : this.programme()[key]) as Programme[K];
  }

  private patch<K extends keyof Programme>(key: K, value: Programme[K]): void {
    this.edits.update(current => ({ ...(current ?? {}), [key]: value }));
  }

  // ---- Basic Info --------------------------------------------------------

  readonly programmeName = computed(() => this.field('programmeName'));
  readonly displayName = computed(() => this.field('displayName'));
  readonly description = computed(() => this.field('programmeDescription'));
  readonly status = computed(() => this.field('programmeStatus'));
  readonly type = computed(() => this.field('type'));

  readonly statusLabel = computed(() => statusLabel(this.status()));
  readonly isLive = computed(() => isActiveStatus(this.status()));

  /**
   * The grade or age band, rendered read-only.
   *
   * Not editable here for the reason above, but shown rather than hidden: it is
   * what decides which classrooms this programme can be attached to, and a
   * dialog that silently omits it invites the assumption that it is unset.
   */
  readonly scopeLabel = computed(() => {
    const programme = this.programme();
    const label = scopeOf(programme) === 'age'
      ? rangeLabel(programme.age)
      : rangeLabel(programme.grades);

    if (!label) {
      return 'Not set';
    }

    return scopeOf(programme) === 'age' ? `Age ${label}` : `Grade ${label}`;
  });

  setName(value: string): void {
    this.patch('programmeName', value);
  }

  setDisplayName(value: string): void {
    this.patch('displayName', value);
  }

  setDescription(value: string): void {
    this.patch('programmeDescription', value);
  }

  setStatus(value: string): void {
    this.patch('programmeStatus', value as Programme['programmeStatus']);
  }

  setType(value: string): void {
    this.patch('type', value as Programme['type']);
  }

  // ---- Save --------------------------------------------------------------

  /**
   * Name and description are production's two required fields on this form.
   * Nothing else is required: a programme with no learning units is a state
   * production allows and the create wizard produces.
   */
  readonly valid = computed(() =>
    String(this.programmeName()).trim() !== '' &&
    String(this.description()).trim() !== ''
  );

  /** Nothing to write. Gates Save so a no-op costs no round trip. */
  readonly dirty = computed(() => {
    const edited = this.edits();

    if (!edited) {
      return false;
    }

    return Object.entries(edited).some(([key, value]) => {
      const original = this.programme()[key as keyof Programme];

      if (Array.isArray(value) || Array.isArray(original)) {
        return !sameArray(value, original);
      }

      /*
       * BY VALUE, NOT BY IDENTITY, for the assignments map.
       *
       * `value !== original` is object identity, and every edit produces a fresh
       * object — so a map ticked and then unticked back to what it was would
       * leave Save enabled and write an identical document. The arrays above had
       * the same problem, which is why they were already compared by content.
       */
      if (isPlainObject(value) || isPlainObject(original)) {
        return !sameMap(value, original);
      }

      return value !== original;
    });
  });

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  save(): void {
    if (this.saving() || !this.valid() || !this.dirty()) {
      return;
    }

    const edited = this.edits() ?? {};

    // displayName falls back to the name rather than being allowed to go empty,
    // because it is what every table and picker in the app renders.
    const name = String(edited.programmeName ?? this.programme().programmeName).trim();
    const display = String(edited.displayName ?? this.programme().displayName).trim();

    this.saved.emit({ ...edited, displayName: display || name });
  }

  close(): void {
    this.closed.emit();
  }
}

/** Whether a value is a plain object — a map field rather than a scalar. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Two arrays with the same members in the same order. */
function sameArray(a: unknown, b: unknown): boolean {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];

  return left.length === right.length && left.every((entry, i) => entry === right[i]);
}

/**
 * Two maps with the same keys and equivalent entries.
 *
 * COMPARES `assignmentDueDate` BY ITS MILLISECONDS, not by reference: a
 * Timestamp rebuilt from the same instant is a different object, and comparing
 * references would report a change that is not one. `isEqual` exists on
 * Firestore's Timestamp but not on a plain `{seconds, nanoseconds}` read back
 * from an export, so the millis are the safer common ground.
 */
function sameMap(a: unknown, b: unknown): boolean {
  const left = isPlainObject(a) ? a : {};
  const right = isPlainObject(b) ? b : {};
  const keys = Object.keys(left);

  if (keys.length !== Object.keys(right).length) {
    return false;
  }

  return keys.every(key => {
    const one = left[key];
    const two = right[key];

    if (!isPlainObject(one) || !isPlainObject(two)) {
      return one === two;
    }

    return (
      one['assignmentId'] === two['assignmentId'] &&
      millisOf(one['assignmentDueDate']) === millisOf(two['assignmentDueDate'])
    );
  });
}

/** A Timestamp's millis, however it was stored. null and absent are the same. */
function millisOf(value: unknown): number | null {
  const stamp = value as { toMillis?: () => number; seconds?: number } | null | undefined;

  if (stamp?.toMillis) {
    return stamp.toMillis();
  }

  if (typeof stamp?.seconds === 'number') {
    return stamp.seconds * 1000;
  }

  return null;
}

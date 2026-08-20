import { Component, computed, input, output, signal, inject } from '@angular/core';
import { ConfigurationService } from '../../services/configuration.service';

import { Icon } from '../../components/icon/icon';
import {
  isActiveStatus,
  rangeLabel,
  scopeOf,
  statusLabel
} from '../../data/programme-options';
import { Programme } from '../../models/teaching.model';

/**
 * Edit Programme — the Basic Info form.
 *
 * ONE PANE, NOT THREE. It briefly carried production's Manage Learning Units and
 * Manage Assignments tabs; both were removed on instruction. Nothing about the
 * learningUnits collection, its rules or its trash changed with them — only this
 * dialog's tabs and the reads that fed them, so a programme's stored
 * `learningUnitsIds` and `assignmentIds` are left exactly as they are, written by
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
  imports: [Icon],
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

  readonly saving = input(false);
  readonly error = input('');

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

      return Array.isArray(value) && Array.isArray(original)
        ? value.join(' ') !== original.join(' ')
        : value !== original;
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

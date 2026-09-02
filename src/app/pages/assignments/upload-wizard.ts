import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';

import { Icon } from '../../components/icon/icon';
import { RichText } from '../../components/rich-text/rich-text';
import {
  UploadAssignment,
  UploadSlot,
  emptyUploadPayload,
  emptyUploadSlot
} from '../../models/teaching.model';
import { AuthService } from '../../services/auth.service';
import { ConfigurationService } from '../../services/configuration.service';

/** The three steps, in production's order. Labels are the stepper's tooltips. */
export const UPLOAD_STEPS = [
  { index: 1, label: 'Basic Info' },
  { index: 2, label: 'Upload Slots' },
  { index: 3, label: 'Review' }
] as const;

/** What the wizard emits: a whole upload, minus what the service supplies. */
export type UploadDraft = Omit<
  UploadAssignment,
  'docId' | 'ownerId' | 'createdAt' | 'updatedAt'
>;

/**
 * Create Upload Assignment — production's three-step dialog.
 *
 *   1  Basic Info      name, submissions, creator, author, status, total duration
 *   2  Upload Slots    a tab per slot, each with a title, a file type, rich-text
 *                      instructions, its own duration, a size cap and a count
 *   3  Review          the fields and the slots, then save
 *
 * WHAT THE STORED DOCUMENT LOOKS LIKE was read off thinktac-india-production
 * rather than inferred from the dialog, and the two disagree in ways that matter:
 *
 *   - The base carries `totalDurationInHours/Minutes/Seconds` AS NUMBERS, and a
 *     separate legacy `duration` string that every recent document leaves empty.
 *     Both are written, because dropping `duration` changes the document's shape
 *     for a reader that expects the field to exist.
 *
 *   - A slot carries EXACTLY TEN KEYS: title, instructions, uploadFileType,
 *     maxFileSize, maxNoOfUploads, submissionId, resourcePath and the three
 *     duration numbers. The oldest documents also have `sizeType: 'MB'`,
 *     `dueDate` and `resourceUrl`; the current dialog writes none of them, so
 *     neither does this.
 *
 *   - `uploadFileType` stores the CODE, uppercase — 'IMAGE', not 'Image'. The
 *     legacy `--default_assignments--` row uses lowercase, which is exactly why
 *     the select's value is the code and its text is the label.
 *
 * ZONELESS. Every field the template reads is a signal, and the slot list is
 * replaced rather than mutated so the template sees each change.
 */
@Component({
  selector: 'app-upload-wizard',
  imports: [Icon, RichText],
  templateUrl: './upload-wizard.html',
  styleUrl: './upload-wizard.css',
  host: { '(document:keydown.escape)': 'close()' }
})
export class UploadWizard implements OnInit {

  /** The row being edited, or null to create one. */
  readonly assignment = input<UploadAssignment | null>(null);

  readonly saving = input(false);
  readonly error = input('');

  readonly submitted = output<UploadDraft>();
  readonly closed = output<void>();

  /* Injections first: the option lists below read from the configuration
     service, and a field cannot use one declared after it. */
  private auth = inject(AuthService);
  private config = inject(ConfigurationService);

  readonly steps = UPLOAD_STEPS;
  /* From Configuration/AssignmentStatuses; the constant is now the fallback. */
  readonly statuses = this.config.assignmentStatuses;

  /**
   * The upload types offered, from Configuration/acceptedUploadFormats.
   *
   * A signal read through the service rather than the constant directly, so a
   * format added to that document appears here without a release.
   */
  readonly fileTypes = this.config.uploadFileTypes;

  readonly step = signal(1);

  readonly displayName = signal('');
  readonly author = signal('');

  /** Unselected on open, as production's does. Status is not ours to assume. */
  readonly status = signal('');

  readonly numberOfAllowedSubmissions = signal(1);

  /*
   * ZERO, ON INSTRUCTION — not production's prefill.
   *
   * Every recent upload document in the collection carries 23 / 59 / 59, which is
   * what that dialog opens with rather than anything a teacher chose. Starting at
   * zero matches the quiz wizard beside it and means a duration in the document is
   * one somebody actually set.
   */
  readonly totalDurationInHours = signal(0);
  readonly totalDurationInMinutes = signal(0);
  readonly totalDurationInSeconds = signal(0);

  /**
   * One slot to begin with: an upload with no slots asks for nothing.
   *
   * The slot's own opening values come from emptyUploadSlot; its upload count is
   * then taken from Configuration/AssignmentDefaults, which is the one field there
   * an editor might want to change.
   */
  readonly slots = signal<UploadSlot[]>([this.newSlot(1)]);

  /** Which slot's tab is open. An index, so removing renumbers by itself. */
  readonly activeSlot = signal(0);

  readonly isEdit = computed(() => this.assignment() !== null);

  readonly heading = computed(() =>
    this.isEdit() ? 'Edit Upload Assignment' : 'Create Upload Assignment'
  );

  /**
   * PRODUCTION'S OWN BUTTON SAYS 'Save Quiz' HERE, on an upload assignment.
   *
   * Not copied. It is a mislabel in its final step rather than a naming
   * convention — the dialog is headed "Create Upload Assignment" and saves an
   * UPLOAD — and reproducing it would put a visible defect in this app in the
   * name of matching. Everything the button DOES matches.
   */
  readonly saveLabel = computed(() =>
    this.isEdit() ? 'Update Assignment' : 'Save Assignment'
  );

  /**
   * The signed-in teacher's name, shown disabled.
   *
   * A snapshot, as production takes one: `creator` records who made the
   * assignment, so an edit by somebody else keeps the original name.
   */
  readonly creator = computed(() => this.assignment()?.creator || this.auth.displayName());

  /**
   * Loads the stored assignment.
   *
   * ngOnInit, NOT the constructor: a signal input is not bound until after
   * construction, so reading `assignment()` there would see null on an edit and
   * open an empty dialog over a real document — which the first save would then
   * overwrite with nothing.
   *
   * The slots are COPIED. They are nested objects on an input, and editing them
   * in place would mutate the row the table is rendering, so the list would show
   * unsaved edits and cancelling would not undo them.
   */
  ngOnInit(): void {
    const existing = this.assignment();

    if (!existing) {
      return;
    }

    this.displayName.set(existing.displayName);
    this.author.set(existing.author);
    this.status.set(existing.status);
    this.numberOfAllowedSubmissions.set(Number(existing.numberOfAllowedSubmissions) || 1);
    this.totalDurationInHours.set(Number(existing.totalDurationInHours) || 0);
    this.totalDurationInMinutes.set(Number(existing.totalDurationInMinutes) || 0);
    this.totalDurationInSeconds.set(Number(existing.totalDurationInSeconds) || 0);

    const stored = (existing.assignments ?? []).map((slot, index) => this.clone(slot, index));

    // Never zero slots: an upload with none has nothing for step 2 to show, and
    // the editor would open on an empty tab strip with no way to add to it.
    this.slots.set(stored.length > 0 ? stored : [this.newSlot(1)]);
    this.activeSlot.set(0);
  }

  /**
   * A copy of one stored slot, with the ten fields the dialog owns normalised.
   *
   * WITHOUT INVENTING KEYS IT DOES NOT HAVE, and without dropping the ones this
   * app does not model: a legacy slot's `sizeType` and `dueDate` are spread
   * through, so editing an old document does not quietly strip them. The same
   * reasoning as the quiz wizard's clone — except there the bug was the opposite
   * direction, writing `options: undefined` onto a type that has none, which
   * Firestore rejects and which failed the whole save.
   *
   * `submissionId` is RE-DERIVED from the position rather than trusted. The
   * collection has documents whose slots number 1, 2, 3 and the field is what
   * production reads to order them, so a gap left by an old removal would put the
   * slots out of order on the next save.
   */
  private clone(slot: UploadSlot, index: number): UploadSlot {
    return {
      ...slot,
      title: slot.title ?? '',
      instructions: slot.instructions ?? '',
      /* An UNSET size stays unset rather than becoming 10: a stored slot always
         has one, so a blank here means the document genuinely lacks it, and
         inventing a cap would hide that behind a plausible number. */
      maxFileSize: slot.maxFileSize === '' || slot.maxFileSize === undefined
        ? ''
        : Number(slot.maxFileSize) || '',
      maxNoOfUploads: Number(slot.maxNoOfUploads) || 1,
      uploadFileType: (slot.uploadFileType ?? '').toUpperCase(),
      submissionId: index + 1,
      resourcePath: slot.resourcePath ?? '',
      durationInHours: Number(slot.durationInHours) || 0,
      durationInMinutes: Number(slot.durationInMinutes) || 0,
      durationInSeconds: Number(slot.durationInSeconds) || 0
    };
  }

  // ---- Validation --------------------------------------------------------

  readonly stepOneValid = computed(() =>
    this.displayName().trim() !== '' &&
    this.author().trim() !== '' &&
    this.status() !== '' &&
    this.numberOfAllowedSubmissions() >= 1
  );

  /**
   * Every slot needs a title, A FILE TYPE, and a size.
   *
   * The type especially, and it is the reason a new slot opens unselected:
   * production's select shows 'Select Upload File Type' in red and blocks Next
   * until it is chosen. A slot saved without one accepts nothing.
   *
   * Instructions are NOT required — they are what the student reads, not a key,
   * and production does not require them either.
   */
  readonly stepTwoValid = computed(() =>
    this.slots().length > 0 &&
    this.slots().every(
      slot =>
        slot.title.trim() !== '' &&
        slot.uploadFileType !== '' &&
        Number(slot.maxFileSize) >= 1
    )
  );

  readonly continueBlocked = computed(() => {
    if (this.step() === 1) {
      return !this.stepOneValid();
    }

    if (this.step() === 2) {
      return !this.stepTwoValid();
    }

    return false;
  });

  /**
   * What one slot is still missing, in the order its fields appear.
   *
   * THE REASON A DISABLED BUTTON NEEDS, and the whole point of this block. Step
   * two shows ONE slot at a time, so an empty third slot disables Next while
   * everything on screen looks filled in — the user is looking at a complete slot
   * and a dead button, with nothing connecting the two. A greyed-out control that
   * cannot say why is indistinguishable from a broken one.
   */
  missingFor(slot: UploadSlot): string[] {
    const missing: string[] = [];

    if (slot.title.trim() === '') {
      missing.push('a title');
    }

    if (slot.uploadFileType === '') {
      missing.push('a file type');
    }

    if (!(Number(slot.maxFileSize) >= 1)) {
      missing.push('a max size');
    }

    return missing;
  }

  /** Whether this slot is why Next is refusing, for the strip's marker. */
  isIncomplete(slot: UploadSlot): boolean {
    return this.missingFor(slot).length > 0;
  }

  /** Every unfinished slot, with its position, nearest first. */
  private readonly incomplete = computed(() =>
    this.slots()
      .map((slot, index) => ({ index, slot, missing: this.missingFor(slot) }))
      .filter(entry => entry.missing.length > 0)
  );

  /**
   * The sentence shown above the footer while Next is refusing.
   *
   * Names the FIRST unfinished slot and lists what it wants, so the fix is one
   * click away rather than a hunt through four tabs.
   */
  readonly blockedReason = computed(() => {
    const first = this.incomplete()[0];

    if (!first || this.step() !== 2) {
      return '';
    }

    return `${this.slotCaption(first.slot, first.index)} needs ${this.listOf(first.missing)}.`;
  });

  /** How many more are unfinished after the one named, or 0. */
  readonly alsoIncomplete = computed(() => Math.max(this.incomplete().length - 1, 0));

  /** Opens the first unfinished slot, so the message is a shortcut and not a scold. */
  goToBlocking(): void {
    const first = this.incomplete()[0];

    if (first) {
      this.activeSlot.set(first.index);
    }
  }

  /** 'a title, a file type and a size' — an Oxford-less list, as English reads. */
  private listOf(items: string[]): string {
    if (items.length <= 1) {
      return items[0] ?? '';
    }

    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
  }

  /** 'Hh Mm Ss', as the review step prints it. */
  readonly durationLabel = computed(
    () =>
      `${this.totalDurationInHours()}h ` +
      `${this.totalDurationInMinutes()}m ` +
      `${this.totalDurationInSeconds()}s`
  );

  /** The label for a stored code, falling back to the code itself. */
  fileTypeLabel(code: string): string {
    const match = this.fileTypes().find(
      option => option.code.toUpperCase() === (code ?? '').toUpperCase()
    );

    return match?.label ?? code ?? '';
  }

  // ---- Navigation --------------------------------------------------------

  next(): void {
    if (this.continueBlocked()) {
      return;
    }

    this.step.update(current => Math.min(current + 1, this.steps.length));
  }

  back(): void {
    this.step.update(current => Math.max(current - 1, 1));
  }

  isDone(index: number): boolean {
    return this.step() > index;
  }

  // ---- Slots -------------------------------------------------------------

  selectSlot(index: number): void {
    this.activeSlot.set(index);
  }

  /** Production's `+` at the right of the tab strip. Opens the new slot. */
  addSlot(): void {
    this.slots.update(list => [...list, this.newSlot(list.length + 1)]);
    this.activeSlot.set(this.slots().length - 1);
  }

  /** An empty slot with the configured upload count applied. */
  private newSlot(submissionId: number): UploadSlot {
    return {
      ...emptyUploadSlot(submissionId),
      maxNoOfUploads: this.config.assignmentDefaults().slotMaxUploads ?? 1
    };
  }

  /**
   * Removes a slot, PAST THE FIRST ONLY — production's own rule.
   *
   * RENUMBERS the rest, because `submissionId` is positional and production reads
   * it to order the slots, so leaving a gap would send them out of order.
   *
   * AND REWRITES THE DEPENDENCIES, which is the part that is easy to miss:
   * `dependentOnStepNumbers` holds positions, so removing slot 2 leaves every
   * later slot pointing one place too high — a slot would wait for the wrong
   * predecessor, or for one that no longer exists.
   */
  removeSlot(index: number): void {
    if (!this.canRemove(index)) {
      return;
    }

    this.slots.update(list =>
      list
        .filter((_, position) => position !== index)
        .map((slot, position) => {
          const stored = slot.dependentOnStepNumbers;
          const kept = Array.isArray(stored)
            ? stored
                .filter(entry => entry !== index)
                .map(entry => (entry > index ? entry - 1 : entry))
            : stored;

          return {
            ...slot,
            submissionId: position + 1,
            ...(kept === undefined ? {} : { dependentOnStepNumbers: kept })
          };
        })
    );

    this.activeSlot.update(current => Math.min(current, this.slots().length - 1));
  }

  /**
   * Writes one field of one slot.
   *
   * REPLACES THE ARRAY AND THE SLOT rather than assigning into them. The template
   * reads `slots()`, and a mutation in place is a change the signal never
   * announces — under zoneless change detection the edit would simply not appear.
   */
  private patchSlot(index: number, patch: Partial<UploadSlot>): void {
    this.slots.update(list =>
      list.map((slot, position) => (position === index ? { ...slot, ...patch } : slot))
    );
  }

  setSlotTitle(index: number, value: string): void {
    this.patchSlot(index, { title: value });
  }

  /**
   * Sets the type, AND RE-CAPS A SIZE THAT NO LONGER FITS.
   *
   * Choosing Video, typing 200, then switching to Image would otherwise leave
   * 200mb on a slot whose ceiling is 20 — past the field's own max, so nothing
   * on screen would say so, and the saved slot would promise a size the player
   * will refuse.
   */
  setSlotFileType(index: number, value: string): void {
    const slot = this.slots()[index];
    const cap = this.capFor(value);
    const size = Number(slot.maxFileSize);

    this.patchSlot(index, {
      uploadFileType: value,
      maxFileSize: slot.maxFileSize === '' ? '' : Math.min(size, cap)
    });
  }

  setSlotInstructions(index: number, value: string): void {
    this.patchSlot(index, { instructions: value });
  }

  setSlotHours(index: number, value: string): void {
    this.patchSlot(index, { durationInHours: this.clampNumber(value, 0, 999) });
  }

  setSlotMinutes(index: number, value: string): void {
    this.patchSlot(index, { durationInMinutes: this.clampNumber(value, 0, 59) });
  }

  setSlotSeconds(index: number, value: string): void {
    this.patchSlot(index, { durationInSeconds: this.clampNumber(value, 0, 59) });
  }

  /**
   * The size, capped BY THE CHOSEN TYPE — 200mb for a video, 20 for an image, 40
   * otherwise, which are production's own limits.
   *
   * An EMPTY FIELD STAYS EMPTY rather than snapping to the minimum. Clearing it
   * to retype used to jump the value to 1 on the first keystroke, which is the
   * kind of input that fights whoever is using it.
   */
  setSlotMaxSize(index: number, value: string): void {
    if (value.trim() === '') {
      this.patchSlot(index, { maxFileSize: '' });
      return;
    }

    const cap = this.capFor(this.slots()[index].uploadFileType);

    this.patchSlot(index, { maxFileSize: this.clampNumber(value, 1, cap) });
  }

  /**
   * The ceiling for the slot's chosen type, for the input's `max` and the hint.
   *
   * FROM CONFIGURATION, so an editor can raise the video cap without a release.
   * Production expresses these as three ternaries inside a template binding.
   */
  sizeCap(slot: UploadSlot): number {
    return this.capFor(slot.uploadFileType);
  }

  private capFor(uploadFileType: string): number {
    const caps = this.config.uploadSizeCaps();

    return caps[(uploadFileType ?? '').toUpperCase()] ?? this.config.uploadSizeCapDefault();
  }

  setSlotMaxUploads(index: number, value: string): void {
    this.patchSlot(index, { maxNoOfUploads: this.clampNumber(value, 1, 99) });
  }

  /**
   * The earlier slots this one can wait for, as {value, label} pairs.
   *
   * ZERO-BASED VALUES with one-based labels, which is what production's select
   * binds: its options read 1, 2, 3 and carry 0, 1, 2. Only slots BEFORE this one
   * are offered — a slot cannot depend on itself or on one that comes later.
   */
  dependencyOptions(index: number): { value: number; label: string }[] {
    return this.slots()
      .slice(0, index)
      .map((_, position) => ({ value: position, label: String(position + 1) }));
  }

  /** Whether this slot already waits for that one. */
  dependsOn(slot: UploadSlot, value: number): boolean {
    const stored = slot.dependentOnStepNumbers;

    return Array.isArray(stored) ? stored.includes(value) : false;
  }

  /** Toggles one dependency, kept sorted so the stored order is stable. */
  toggleDependency(index: number, value: number, on: boolean): void {
    const stored = this.slots()[index].dependentOnStepNumbers;
    const current = Array.isArray(stored) ? [...stored] : [];
    const next = on
      ? [...new Set([...current, value])].sort((a, b) => a - b)
      : current.filter(entry => entry !== value);

    this.patchSlot(index, { dependentOnStepNumbers: next });
  }

  /**
   * Whether this slot offers a Remove.
   *
   * PAST THE FIRST ONLY, which is production's rule (`*ngIf="i > 0"`) rather than
   * this app's earlier "more than one slot". The two differ in one case that
   * matters: with two slots, mine let the FIRST be removed, and every later
   * slot's `dependentOnStepNumbers` points at positions that then shift.
   */
  canRemove(index: number): boolean {
    return index > 0;
  }

  /** The tab's caption: production shows the number and the title beneath it. */
  slotCaption(slot: UploadSlot, index: number): string {
    return slot.title.trim() || `Slot ${index + 1}`;
  }

  // ---- Saving ------------------------------------------------------------

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  checkedOf(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  /**
   * NAVIGATES TO THE PROBLEM rather than returning silently — the same fix the
   * quiz wizard needed. A refused save on the last step with the offending field
   * two steps back reads as a button that does nothing.
   */
  save(): void {
    if (this.saving()) {
      return;
    }

    if (!this.stepOneValid()) {
      this.step.set(1);
      return;
    }

    if (!this.stepTwoValid()) {
      this.step.set(2);
      return;
    }

    this.submitted.emit({
      ...emptyUploadPayload(),
      type: 'UPLOAD',
      displayName: this.displayName().trim(),
      author: this.author().trim(),
      creator: this.creator(),
      status: this.status(),
      numberOfAllowedSubmissions: this.numberOfAllowedSubmissions(),
      totalDurationInHours: this.totalDurationInHours(),
      totalDurationInMinutes: this.totalDurationInMinutes(),
      totalDurationInSeconds: this.totalDurationInSeconds(),
      /*
       * Trimmed and renumbered on the way out. `submissionId` is positional and
       * the strip may have been added to and removed from since it was set.
       */
      assignments: this.slots().map((slot, index) => ({
        ...slot,
        title: slot.title.trim(),
        submissionId: index + 1,
        /* A NUMBER, always. The editor holds '' while untouched, and step two
           will not pass until it holds a value, so this only ever narrows the
           type rather than inventing one. */
        maxFileSize: Number(slot.maxFileSize)
      }))
    });
  }

  close(): void {
    this.closed.emit();
  }

  /** The review step shows instructions as text, so the HTML has to come off. */
  plainText(html: string): string {
    return (html ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** A number input still yields '' and 'e', and NaN in a slot fails the write. */
  private clampNumber(value: string, min: number, max: number): number {
    const parsed = Math.floor(Number(value));

    if (!Number.isFinite(parsed)) {
      return min;
    }

    return Math.min(Math.max(parsed, min), max);
  }
}

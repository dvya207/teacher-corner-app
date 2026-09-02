import { Component, OnInit, computed, input, output, signal, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ConfigurationService } from '../../services/configuration.service';

import {
  AssignmentPicker,
  PickableAssignment
} from '../../components/assignment-picker/assignment-picker';
import { Icon } from '../../components/icon/icon';
import { LearningUnitPicker } from '../../components/learning-unit-picker/learning-unit-picker';
import { FlowField, isFieldLocked } from '../../data/form-flow';
import { COUNTRIES, DEFAULT_COUNTRY } from '../../data/institution-options';
import {
  ProgrammeScope,
  expandRange,
  highestProgrammeNumber,
  isActiveStatus
} from '../../data/programme-options';
import {
  Institution,
  PickableUnit,
  Programme,
  ProgrammeAssignment,
  ProgrammeDraft
} from '../../models/teaching.model';
import {
  ProgrammeService,
  suggestedProgrammeName
} from '../../services/programme.service';
import { ResourceUploadService } from '../../services/resource-upload.service';

/** The wizard's steps, and its labels, verbatim from production's stepper. */
export const PROGRAMME_STEPS = [
  { index: 1, label: 'Institution' },
  { index: 2, label: 'Create Programme' },
  { index: 3, label: 'Select Learning Units' },
  { index: 4, label: 'Select Assignments' },
  { index: 5, label: 'Review' }
] as const;

/**
 * Which step renders the summary.
 *
 * DERIVED, not typed: the review is always last, and hardcoding 4 here is how
 * the markup ended up checking `step() === 3` after the stepper grew — a review
 * that rendered on the learning-units step and two blank steps after it.
 */
export const REVIEW_STEP = PROGRAMME_STEPS.length;

/**
 * Create Programme — a modal wizard.
 *
 * FIVE STEPS, PRODUCTION'S OWN, and now all five are real. It was three, then
 * four: Select Assignments was left out because this app had no assignments
 * collection, path or service, so the step could only ever have said "nothing
 * here". The note here used to read "the day assignments exist, the field comes
 * back with them" — that day arrived, and it has.
 *
 * `assignmentIds` IS A MAP, NOT AN ARRAY, which is why step 4's picker differs
 * from step 3's in more than its contents. See ProgrammeAssignment on the model:
 * 2715 of production's 14240 programmes carry it keyed by doc id, so there is no
 * order to preserve and the picker exposes none.
 *
 * Step 1 is the SAME institution picker the Add Classroom modal uses —
 * country, pincode, board, search, school, unlocking in sequence. Production
 * shares that component between the two wizards; this app has two copies,
 * because the classroom one also drives grade and section availability off the
 * chosen school and the shared version would have to carry that unused.
 *
 * Presentational: it collects and emits, the parent writes. ZONELESS — every
 * field the template reads is a signal.
 */
@Component({
  selector: 'app-add-programme',
  imports: [DatePipe, AssignmentPicker, Icon, LearningUnitPicker],
  templateUrl: './add-programme.html',
  styleUrl: './add-programme.css',
  /**
   * Escape dismisses the modal. On the DOCUMENT, not the template: the backdrop
   * is a div that never takes focus, so a keydown bound to it would never fire.
   */
  host: { '(document:keydown.escape)': 'close()' }
})
export class AddProgramme implements OnInit {

  /**
   * Option lists, read from the Configuration collection in Firestore.
   *
   * The properties below are its SIGNALS, so a list edited in the console reaches
   * this form without a deploy. Each falls back to the constant it replaced, so a
   * refused read renders the options the app shipped with rather than empty selects.
   */
  private config = inject(ConfigurationService);
  private programmes = inject(ProgrammeService);
  private uploads = inject(ResourceUploadService);

  readonly institutions = input.required<Institution[]>();
  /**
   * The caller's already-loaded catalogue, used ONLY to floor the code preview.
   *
   * The same list `create` is passed, and for the same reason: the counter can
   * lag behind an import, so the highest code already present is part of the
   * answer. Defaulted, so a caller that does not have it still gets a preview
   * from the counter alone.
   */
  readonly existing = input<Programme[]>([]);

  /**
   * The learning units offered by step 3, already collapsed to one row per code.
   *
   * Supplied by the parent, like `institutions`: this component reads nothing
   * from Firestore, and toPickableUnits is where the LIVE filter and the
   * language grouping live.
   */
  readonly units = input<PickableUnit[]>([]);

  /**
   * Opens the wizard already scoped to one school, skipping step 1.
   *
   * WHY THIS EXISTS. Add Classroom offers "New programme for this grade" when the
   * picker has nothing to show for the chosen school and grade. That used to open
   * a name-only inline form, which created a programme with no description, no
   * type, no status choice, no image and no learning units — a different and
   * poorer thing than the wizard makes. It opens this component now, and the
   * school and grade are already known, so asking for them again would be asking
   * the user to re-enter what they just filled in.
   *
   * '' means the ordinary four-step flow, which is what the Programme page uses.
   */
  /**
   * The assignments to choose from on step 4.
   *
   * Defaulted to empty, so the step renders its own "No assignments available"
   * rather than the wizard needing to know whether the caller has any.
   */
  readonly assignments = input<PickableAssignment[]>([]);

  readonly lockedInstitutionId = input('');

  /**
   * Grades the programme is scoped to, when the caller already knows them.
   *
   * Only consulted while `lockedInstitutionId` is set — outside that case step 1
   * is where scope is chosen, and seeding it would silently override the user.
   */
  readonly presetGrades = input<string[]>([]);

  readonly saving = input(false);
  readonly error = input('');

  readonly submitted = output<ProgrammeDraft>();
  readonly closed = output<void>();

  readonly steps = PROGRAMME_STEPS;
  /** Exposed so the template stops hardcoding which step is the summary. */
  readonly reviewStep = REVIEW_STEP;
  readonly countries = COUNTRIES;
  readonly boards = this.config.boards;
  readonly statuses = this.config.programmeStatuses;
  readonly types = this.config.programmeTypes;
  readonly grades = this.config.programmeGrades;
  readonly ages = this.config.programmeAges;

  readonly step = signal(1);

  /**
   * ngOnInit, NOT THE CONSTRUCTOR, and that is a bug fix rather than a style
   * preference.
   *
   * Both things below read an INPUT, and a signal input is not bound until after
   * construction — an optional one returns its DEFAULT in a constructor body.
   * `previewCode(highestProgrammeNumber(this.existing()))` therefore always ran
   * against `[]`, so the floor from the caller's catalogue was never applied and
   * the preview fell back to the per-uid counter alone.
   *
   * The visible symptom: a teacher whose own counter document does not exist yet
   * was shown "P10001" as the next code while the catalogue already held P10024.
   * The counter is per uid, so a teacher who has never created a programme
   * legitimately has none — the catalogue floor is exactly what is supposed to
   * cover that case, and it was being read as empty.
   *
   * Still read ONCE rather than on entering step 2: the number does not change
   * while the wizard is open, since nothing here reserves it, so re-reading would
   * only differ if someone else saved meanwhile — which the hint under the field
   * already warns about.
   */
  ngOnInit(): void {
    void this.programmes
      .previewCode(highestProgrammeNumber(this.existing()))
      .then(code => this.programmeCode.set(code))
      .catch(() => this.programmeCode.set(''));

    this.applyLockedScope();
  }

  /**
   * Opens on step 2 with the school already chosen, when the caller supplied one.
   *
   * Only the FIRST preset grade is used, seeded as the range's `from` with `to`
   * left empty — `isRange()` is then false and `scopeValuesChosen` resolves to
   * that single grade. Add Classroom knows exactly one grade, so a range would be
   * inventing scope the user did not ask for.
   */
  private applyLockedScope(): void {
    const locked = this.lockedInstitutionId();

    if (!locked) {
      return;
    }

    this.institutionId.set(locked);

    const [firstGrade] = this.presetGrades();

    if (firstGrade) {
      this.gradeFrom.set(firstGrade);
    }

    // Step 1's question is already answered, so asking it would be asking the
    // user to re-enter what they just filled in on the classroom form.
    this.step.set(2);
  }

  /** True while the school was supplied by the caller and cannot be changed. */
  readonly institutionLocked = computed(() => this.lockedInstitutionId() !== '');

  // ---- Step 1: institution ----------------------------------------------

  readonly country = signal(DEFAULT_COUNTRY);
  readonly pincode = signal('');
  readonly board = signal('');
  readonly institutionId = signal('');
  readonly searched = signal(false);

  // ---- Step 2: the programme --------------------------------------------

  readonly programmeName = signal('');
  readonly displayName = signal('');
  readonly description = signal('');
  /**
   * UNSELECTED ON OPEN, both of them.
   *
   * These defaulted to 'LIVE' and 'REGULAR'. Production's step 2 opens with
   * "Select programme status" and "Select programme type" showing and Continue
   * greyed out, and the difference is not cosmetic: `locked('scope')` is keyed
   * on Type being set, so a pre-filled Type revealed the Grade/Age section the
   * moment the step opened. Production only shows that section once Type is
   * chosen.
   *
   * A default also decides for the user on the one field that says whether
   * anyone can see the programme.
   */
  readonly status = signal<string>('');
  readonly type = signal<string>('');

  /**
   * Grade or age, never both — production's toggle, which clears the other side
   * when it flips. Storing both would make `scopeOf` ambiguous and the list
   * column show the wrong one.
   */
  readonly scope = signal<ProgrammeScope>('grade');
  /** A range toggle, as production has: off means a single value. */
  readonly isRange = signal(false);

  readonly gradeFrom = signal('');
  readonly gradeTo = signal('');
  readonly ageFrom = signal('');
  readonly ageTo = signal('');

  /**
   * The code this programme will most likely get, shown read-only.
   *
   * A PREDICTION, NOT A RESERVATION — see ProgrammeService.previewCode. Nothing
   * is held until Save, so two people opening the wizard together see the same
   * number and one of them gets it. The field's hint says so; claiming otherwise
   * would be the kind of lie a user only discovers afterwards.
   *
   * Empty until the read lands, and empty if it fails: an unknown code is
   * better shown as blank than as a number that might be wrong.
   */
  readonly programmeCode = signal('');

  /** The uploaded image's Storage path, and the upload's progress. */
  readonly imagePath = signal('');
  readonly imageName = signal('');
  readonly uploadingImage = signal(false);
  readonly uploadPercent = signal(0);
  readonly uploadError = signal('');

  // ---- Step 3: learning units --------------------------------------------

  /**
   * The chosen units, IN ORDER.
   *
   * The picker component owns the filtering, the drag arithmetic and the
   * reordering; this holds only the result, because it is what `save` emits.
   * See LearningUnitPicker for why the order is stored rather than a set.
   */
  readonly selectedIds = signal<string[]>([]);

  /**
   * The chosen units resolved, in order — what the Review card lists.
   *
   * Walks the id list rather than filtering the catalogue: filtering returns
   * catalogue order, and the Review must show the sequence that is about to be
   * written.
   */
  readonly selectedUnits = computed(() => {
    const byId = new Map(this.units().map(unit => [unit.docId, unit]));

    return this.selectedIds()
      .map(id => byId.get(id))
      .filter((unit): unit is PickableUnit => unit !== undefined);
  });

  /**
   * Whether a status reads as live, for the review pill's colour.
   *
   * isActiveStatus, not `=== 'LIVE'`: production data carries both 'LIVE' and
   * 'ACTIVE' in mixed case, which is the whole reason that helper exists.
   */
  isLiveStatus(status: string): boolean {
    return isActiveStatus(status);
  }

  // ---- Step 1 derivations ------------------------------------------------

  /** See the note on AddClassroom.pincodeValid — deliberately loose. */
  readonly pincodeValid = computed(() => /^[A-Za-z0-9][A-Za-z0-9 -]{2,9}$/.test(this.pincode().trim()));

  readonly pincodeUnlocked = computed(() => this.country() !== '');
  readonly boardUnlocked = computed(() => this.pincodeUnlocked() && this.pincodeValid());
  readonly searchUnlocked = computed(() => this.boardUnlocked() && this.board() !== '');
  readonly schoolUnlocked = computed(() => this.searched());

  /**
   * Schools matching the board and pincode, filtered IN MEMORY from the
   * teacher's own institutions — the rules require an ownerId equality on every
   * query, and adding board and pincode on top would need a composite index for
   * a result set small enough to scan.
   */
  readonly matchingSchools = computed(() => {
    if (!this.searched()) {
      return [];
    }

    const board = this.board();
    const pincode = this.pincode().trim().toLowerCase();

    return this.institutions()
      .filter(institution =>
        institution.board === board &&
        (institution.institutionAddress?.pincode ?? '').trim().toLowerCase() === pincode
      )
      .sort((a, b) => a.institutionName.localeCompare(b.institutionName));
  });

  readonly selectedSchool = computed(() =>
    this.institutions().find(institution => institution.docId === this.institutionId()) ?? null
  );

  // ---- Step 4: assignments -----------------------------------------------

  /**
   * The chosen assignments, KEYED BY DOC ID, as the document stores them.
   *
   * A map rather than a list of ids because that IS the stored shape, and holding
   * it in the shape it will be written in means the picker, the review and the
   * save all read the same object. Each entry also carries the due date.
   */
  readonly selectedAssignments = signal<Record<string, ProgrammeAssignment>>({});

  /**
   * The chosen assignments resolved for the Review card, by name.
   *
   * Sorted rather than in key order: an object's key order is not something to
   * rely on, and this has to match the order the picker showed.
   */
  readonly selectedAssignmentRows = computed(() => {
    const byId = new Map(this.assignments().map(row => [row.docId, row]));

    return Object.keys(this.selectedAssignments())
      .map(id => byId.get(id))
      .filter((row): row is PickableAssignment => row !== undefined)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  });

  /** The due date of a chosen assignment, for the Review card. */
  dueDateOf(docId: string): Date | null {
    const stamp = this.selectedAssignments()[docId]?.assignmentDueDate;

    return stamp?.toDate ? stamp.toDate() : null;
  }

  /**
   * Whether the footer's forward button should read Skip.
   *
   * ONLY ON THE ASSIGNMENTS STEP, AND ONLY WITH NOTHING CHOSEN. Production labels
   * it Skip there; once something is selected the word would be wrong, because
   * pressing it keeps the selection rather than discarding it.
   */
  readonly showSkip = computed(
    () => this.step() === 4 && Object.keys(this.selectedAssignments()).length === 0
  );

  readonly stepOneValid = computed(() => this.institutionId() !== '');

  // ---- Step 2 derivations ------------------------------------------------

  readonly isGradeScoped = computed(() => this.scope() === 'grade');

  /** The values the chosen scope offers. One list, so the template has one loop. */
  readonly scopeValues = computed(() =>
    this.isGradeScoped() ? this.grades() : this.ages()
  );

  readonly scopeFrom = computed(() => (this.isGradeScoped() ? this.gradeFrom() : this.ageFrom()));
  readonly scopeTo = computed(() => (this.isGradeScoped() ? this.gradeTo() : this.ageTo()));

  /**
   * The expanded list that will be stored.
   *
   * Expanded here rather than at save so the Review step can show exactly what
   * is going to be written, rather than a range the reader has to expand
   * themselves.
   */
  readonly scopeValuesChosen = computed(() => {
    const from = this.scopeFrom();

    if (!from) {
      return [];
    }

    return this.isRange() ? expandRange(from, this.scopeTo()) : [from];
  });

  readonly stepTwoValid = computed(() =>
    this.programmeName().trim() !== '' &&
    this.description().trim() !== '' &&
    this.status() !== '' &&
    this.type() !== '' &&
    this.scopeValuesChosen().length > 0
  );

  /* ---- Progressive unlocking, step 2 -------------------------------------
     Step 1 already unlocks one control at a time — pincode after country, board
     after pincode, search after board, school after the search — through the
     four *Unlocked computeds above. This is the same rule for step 2's fields.

     Display Name is optional: it falls back to the programme name, so an empty
     one must not hold Description shut. --------------------------------------- */

  private readonly flow = computed<FlowField[]>(() => {
    const has = (value: unknown) => String(value ?? '').trim() !== '';

    return [
      { name: 'name',    filled: has(this.programmeName()) },
      { name: 'display', filled: has(this.displayName()), optional: true },
      { name: 'desc',    filled: has(this.description()) },
      { name: 'status',  filled: has(this.status()) },
      { name: 'type',    filled: has(this.type()) },
      // The scope pair is one decision, so both open together once Type is set.
      { name: 'scope',   filled: this.scopeValuesChosen().length > 0 }
    ];
  });

  /**
   * Whether Continue is refused on the step being shown.
   *
   * Explicit per step, rather than the ternary this replaced — that read
   * `step() === 1 ? !stepOneValid() : !stepTwoValid()`, which silently applied
   * step 2's rule to every later step, so the learning-units step would have
   * demanded a valid step 2 form it was no longer showing.
   *
   * Each step's rule is stated where it belongs, below.
   */
  readonly continueBlocked = computed(() => {
    if (this.step() === 1) {
      return !this.stepOneValid();
    }

    if (this.step() === 2) {
      return !this.stepTwoValid();
    }

    /*
     * AT LEAST ONE UNIT, as production requires: its Continue is greyed on this
     * step until something is in the Selected column.
     *
     * The earlier note here said choosing units was optional. It is not, on the
     * evidence of production's own disabled button — and a programme with no
     * units is one a classroom cannot run.
     */
    if (this.step() === 3) {
      return this.selectedIds().length === 0;
    }

    return false;
  });

  locked(name: string): boolean {
    return isFieldLocked(this.flow(), name);
  }

  /** Placeholder for the name field, in production's naming style. */
  readonly suggestedName = computed(() =>
    suggestedProgrammeName(
      this.selectedSchool()?.institutionName ?? '',
      this.isGradeScoped() ? this.scopeFrom() : '',
      'Subject'
    )
  );

  /**
   * What the Review step lists, in PRODUCTION'S ORDER and with its set of rows.
   *
   * Name, Display Name, Code, Description, Type, Status, Image, Institution,
   * then Grades — which is not the order the form collects them in, and is
   * production's all the same: the identity first, then how it behaves, then
   * where it applies.
   *
   * NOTHING IS DROPPED. This filtered empty values out, so a programme with no
   * description showed a review with one fewer row and the reader had no way to
   * tell an omitted field from one that does not exist. Every row renders, and
   * an empty one says so.
   *
   * `kind` is how the template knows Status is a pill and Image is neither a
   * value nor blank but the words "No image".
   */
  readonly reviewRows = computed<
    { label: string; value: string; kind: 'text' | 'status' | 'image' }[]
  >(() => [
    { label: 'Programme Name', value: this.programmeName().trim(), kind: 'text' },
    {
      label: 'Display Name',
      value: this.displayName().trim() || this.programmeName().trim(),
      kind: 'text'
    },
    { label: 'Programme Code', value: this.programmeCode(), kind: 'text' },
    { label: 'Description', value: this.description().trim(), kind: 'text' },
    { label: 'Type', value: this.type(), kind: 'text' },
    { label: 'Status', value: this.status(), kind: 'status' },
    { label: 'Image', value: this.imageName(), kind: 'image' },
    {
      label: 'Institution',
      value: this.selectedSchool()?.institutionName ?? '',
      kind: 'text'
    },
    {
      label: this.isGradeScoped() ? 'Grades' : 'Ages',
      value: this.scopeValuesChosen().join(', '),
      kind: 'text'
    }
  ]);

  // ---- Handlers ----------------------------------------------------------

  setCountry(value: string): void {
    this.country.set(value);
    this.board.set('');
    this.resetSchool();
  }

  setPincode(value: string): void {
    this.pincode.set(value);
    this.board.set('');
    this.resetSchool();
  }

  setBoard(value: string): void {
    this.board.set(value);
    this.resetSchool();
  }

  search(): void {
    this.searched.set(true);
  }

  setInstitution(value: string): void {
    this.institutionId.set(value);
  }

  private resetSchool(): void {
    this.searched.set(false);
    this.institutionId.set('');
  }

  /**
   * Flipping the scope CLEARS the other side.
   *
   * Production does the same (`ageGradeSelection` nulls whichever is not
   * chosen). Keeping both would leave a stale age band on a grade-scoped
   * programme, and scopeOf() would then have to guess which one was meant.
   */
  setScope(scope: ProgrammeScope): void {
    this.scope.set(scope);
    this.gradeFrom.set('');
    this.gradeTo.set('');
    this.ageFrom.set('');
    this.ageTo.set('');
  }

  toggleRange(): void {
    this.isRange.update(current => !current);
    // The upper bound is meaningless outside a range, and leaving it set would
    // silently widen a single-value programme if the toggle came back on.
    this.gradeTo.set('');
    this.ageTo.set('');
  }

  setScopeFrom(value: string): void {
    if (this.isGradeScoped()) {
      this.gradeFrom.set(value);
    } else {
      this.ageFrom.set(value);
    }
  }

  setScopeTo(value: string): void {
    if (this.isGradeScoped()) {
      this.gradeTo.set(value);
    } else {
      this.ageTo.set(value);
    }
  }

  /**
   * Uploads the programme's image.
   *
   * FILED UNDER THE INSTITUTION, not under a programme: the programme has no
   * document id yet — it does not exist until Save — so there is nothing to key
   * a path on. `pathFor` takes the institution's id and the file keeps its own
   * name, which is the same shape a learning unit's files use.
   *
   * The path is held on the component and written with the draft. A programme
   * abandoned after uploading leaves an orphan file in the bucket; that is the
   * trade for letting the image be chosen before the document exists, and it is
   * the same trade production makes.
   */
  async uploadImage(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const institutionId = this.institutionId();

    input.value = '';

    if (!file || !institutionId) {
      return;
    }

    this.uploadError.set('');
    this.uploadingImage.set(true);
    this.uploadPercent.set(0);

    const result = await this.uploads.upload(
      institutionId,
      file,
      'ProgrammeImages',
      percent => this.uploadPercent.set(percent)
    );

    this.uploadingImage.set(false);

    if (!result.path) {
      this.uploadError.set(
        result.error === 'denied'
          ? 'That file was refused — check its type and size.'
          : 'Could not upload that image.'
      );

      return;
    }

    this.imagePath.set(result.path);
    this.imageName.set(file.name);
  }

  clearImage(): void {
    this.imagePath.set('');
    this.imageName.set('');
    this.uploadError.set('');
  }

  /**
   * Moves one handle of the range slider.
   *
   * THE HANDLES CANNOT CROSS. Production's slider does not let them, and a
   * `from` above `to` would make expandRange produce nothing — a silently empty
   * scope on an otherwise valid form. Each handle is clamped to the other.
   */
  setRangeFrom(value: string): void {
    const to = this.scopeTo();
    const next = to !== '' && Number(value) > Number(to) ? to : value;

    if (this.isGradeScoped()) {
      this.gradeFrom.set(next);
    } else {
      this.ageFrom.set(next);
    }
  }

  setRangeTo(value: string): void {
    const from = this.scopeFrom();
    const next = from !== '' && Number(value) < Number(from) ? from : value;

    if (this.isGradeScoped()) {
      this.gradeTo.set(next);
    } else {
      this.ageTo.set(next);
    }
  }

  /** Where a handle sits along the track, as a percentage. */
  handleAt(value: string): number {
    const values = this.scopeValues();
    const index = values.indexOf(value);

    if (index < 0 || values.length < 2) {
      return 0;
    }

    return (index / (values.length - 1)) * 100;
  }

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  next(): void {
    if (this.step() === 1 && !this.stepOneValid()) {
      return;
    }

    if (this.step() === 2 && !this.stepTwoValid()) {
      return;
    }

    this.step.update(current => Math.min(current + 1, this.steps.length));
  }

  /**
   * FLOORS AT STEP 2 WHEN THE SCHOOL IS LOCKED.
   *
   * Without this, Back from step 2 lands on a step 1 the caller has already
   * answered — and worse, one whose Search flow could be used to change the
   * school out from under the classroom the programme is being created for.
   */
  back(): void {
    const floor = this.institutionLocked() ? 2 : 1;

    this.step.update(current => Math.max(current - 1, floor));
  }

  save(): void {
    const school = this.selectedSchool();

    if (this.saving() || !school || !this.stepOneValid() || !this.stepTwoValid()) {
      return;
    }

    const name = this.programmeName().trim();
    const chosen = this.scopeValuesChosen();

    this.submitted.emit({
      programmeName: name,
      displayName: this.displayName().trim() || name,
      programmeDescription: this.description().trim(),
      institutionId: school.docId,
      institutionName: school.institutionName,
      // Exactly one of the two carries values — see setScope.
      grades: this.isGradeScoped() ? chosen : [],
      age: this.isGradeScoped() ? [] : chosen,
      type: this.type() as ProgrammeDraft['type'],
      programmeStatus: this.status() as ProgrammeDraft['programmeStatus'],
      // Written empty rather than omitted, so the document matches production's
      // shape and the steps that fill these can be added later.
      programmeImagePath: this.imagePath(),
      learningUnitsIds: this.selectedIds(),
      /*
       * ALWAYS WRITTEN, EMPTY WHEN NOTHING WAS CHOSEN, because step 4 is skippable
       * and 2715 of production's programmes carry the key with an empty map. An
       * omitted field and an empty one read differently to whoever looks next:
       * absent says nobody has been through this step.
       */
      assignmentIds: this.selectedAssignments()
    });
  }

  close(): void {
    this.closed.emit();
  }
}

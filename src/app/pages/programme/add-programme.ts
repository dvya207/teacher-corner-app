import { Component, computed, input, output, signal, inject } from '@angular/core';
import { ConfigurationService } from '../../services/configuration.service';

import { Icon } from '../../components/icon/icon';
import { FlowField, isFieldLocked } from '../../data/form-flow';
import { COUNTRIES, DEFAULT_COUNTRY } from '../../data/institution-options';
import {
  ProgrammeScope,
  expandRange
} from '../../data/programme-options';
import { Institution, ProgrammeDraft } from '../../models/teaching.model';
import { suggestedProgrammeName } from '../../services/programme.service';

/** The wizard's steps, in production's order minus the two it cannot serve. */
export const PROGRAMME_STEPS = [
  { index: 1, label: 'Institution' },
  { index: 2, label: 'Create Programme' },
  { index: 3, label: 'Review' }
] as const;

/**
 * Create Programme — a modal wizard.
 *
 * THREE STEPS, WHERE PRODUCTION HAS FIVE. Production's steps 3 and 4 select
 * Learning Units and Assignments; neither collection exists in this app, so a
 * step for each would be a page that could only ever say "nothing here". The
 * document is still written with `learningUnitsIds: []` and `assignmentIds: []`,
 * so both steps can be inserted between Create Programme and Review later
 * without a migration and without touching anything else.
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
  imports: [Icon],
  templateUrl: './add-programme.html',
  styleUrl: './add-programme.css',
  /**
   * Escape dismisses the modal. On the DOCUMENT, not the template: the backdrop
   * is a div that never takes focus, so a keydown bound to it would never fire.
   */
  host: { '(document:keydown.escape)': 'close()' }
})
export class AddProgramme {

  /**
   * Option lists, read from the Configuration collection in Firestore.
   *
   * The properties below are its SIGNALS, so a list edited in the console reaches
   * this form without a deploy. Each falls back to the constant it replaced, so a
   * refused read renders the options the app shipped with rather than empty selects.
   */
  private config = inject(ConfigurationService);

  readonly institutions = input.required<Institution[]>();
  readonly saving = input(false);
  readonly error = input('');

  readonly submitted = output<ProgrammeDraft>();
  readonly closed = output<void>();

  readonly steps = PROGRAMME_STEPS;
  readonly countries = COUNTRIES;
  readonly boards = this.config.boards;
  readonly statuses = this.config.programmeStatuses;
  readonly types = this.config.programmeTypes;
  readonly grades = this.config.programmeGrades;
  readonly ages = this.config.programmeAges;

  readonly step = signal(1);

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
  readonly status = signal<string>('LIVE');
  readonly type = signal<string>('REGULAR');

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

  /** What the Review step lists. Empty values are dropped, as in Add Institution. */
  readonly reviewRows = computed(() => {
    const rows: { label: string; value: string }[] = [
      { label: 'School', value: this.selectedSchool()?.institutionName ?? '' },
      { label: 'Board', value: this.board() },
      { label: 'Programme Name', value: this.programmeName().trim() },
      { label: 'Display Name', value: this.displayName().trim() || this.programmeName().trim() },
      { label: 'Description', value: this.description().trim() },
      { label: 'Status', value: this.status() },
      { label: 'Type', value: this.type() },
      {
        label: this.isGradeScoped() ? 'Grades' : 'Ages',
        value: this.scopeValuesChosen().join(', ')
      }
    ];

    return rows.filter(row => row.value !== '');
  });

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

  back(): void {
    this.step.update(current => Math.max(current - 1, 1));
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
      programmeImagePath: '',
      learningUnitsIds: [],
      assignmentIds: []
    });
  }

  close(): void {
    this.closed.emit();
  }
}

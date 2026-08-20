import { Component, computed, effect, input, output, signal, inject } from '@angular/core';
import { ConfigurationService } from '../../services/configuration.service';

import { Icon } from '../../components/icon/icon';
import { FlowField, isFieldLocked } from '../../data/form-flow';
import {
  CLASSROOM_TYPES,
  DEFAULT_CLASSROOM_COUNTRY,
  GRADES,
  SECTIONS,
  programmeTypeFor,
  takenSections
} from '../../data/classroom-options';
import {
  Classroom,
  ClassroomDraft,
  ClassroomType,
  Institution,
  InstitutionDraft,
  Programme,
  ProgrammeDraft
} from '../../models/teaching.model';
import { programmesFor, suggestedProgrammeName } from '../../services/programme.service';
import { AddInstitutionInline } from './add-institution-inline';

/**
 * Add Classroom — a modal form that UNLOCKS ITS FIELDS IN SEQUENCE.
 *
 * Every control below the one being filled stays disabled until the answer
 * above it exists. That is production's behaviour (`unlockFormSequentially`)
 * and it is not decoration: the School list cannot be queried before a board
 * and a pincode exist to query it with, and the Programme list cannot be
 * narrowed before a school and a grade are known. Enabling those controls early
 * would offer a choice the form cannot honour yet.
 *
 * Presentational: it collects and validates, then emits a draft; the parent
 * owns the Firestore write. A failed save can therefore leave the modal open
 * with everything the user typed intact.
 *
 * ZONELESS. Every field the template reads is a signal.
 */
@Component({
  selector: 'app-add-classroom',
  imports: [Icon, AddInstitutionInline],
  templateUrl: './add-classroom.html',
  styleUrl: './add-classroom.css',
  /**
   * Escape dismisses the modal. On the DOCUMENT, not the template: the backdrop
   * is a div that never takes focus, so a keydown bound to it would never fire.
   */
  host: { '(document:keydown.escape)': 'close()' }
})
export class AddClassroom {

  /**
   * Option lists, read from the Configuration collection in Firestore.
   *
   * The properties below are its SIGNALS, so a list edited in the console reaches
   * this form without a deploy. Each falls back to the constant it replaced, so a
   * refused read renders the options the app shipped with rather than empty selects.
   */
  private config = inject(ConfigurationService);

  /** The teacher's own schools. The School select is filtered from these. */
  readonly institutions = input.required<Institution[]>();
  /**
   * The classrooms already loaded by the page.
   *
   * Used only to work out which grade/section pairs are taken at the chosen
   * school, so the form cannot offer a duplicate "8 B".
   */
  readonly classrooms = input.required<Classroom[]>();
  /** The programme catalogue, unfiltered. Narrowed here, not by the caller. */
  readonly programmes = input.required<Programme[]>();

  readonly saving = input(false);
  /** Save failures, rendered INSIDE the modal rather than behind it. */
  readonly error = input('');

  readonly submitted = output<ClassroomDraft>();
  readonly programmeRequested = output<ProgrammeDraft>();
  /**
   * Asks the PARENT to create a school. This component never writes, for the
   * same reason it never writes a programme: the page owns every Firestore call,
   * so a failed create can leave both forms open with their input intact.
   */
  readonly institutionRequested = output<InstitutionDraft>();
  readonly closed = output<void>();

  /**
   * The school the parent just created, or null.
   *
   * How the round trip closes: this component asks, the page writes, and the
   * created institution comes back down here to be selected — so the teacher
   * lands back on the classroom form with the new school already chosen rather
   * than having to search for it again.
   */
  readonly createdInstitution = input<Institution | null>(null);

  /**
   * The School dropdown's "add a new one" entry.
   *
   * A native <select> cannot contain a button, so the affordance is an OPTION
   * with a reserved value, handled in setInstitution below. That is also where
   * the reference puts it — inside the dropdown, under the school list — so the
   * teacher finds it at the moment the list disappoints them rather than having
   * to know it exists somewhere else.
   *
   * Double-underscored so it cannot collide with a Firestore document id.
   */
  static readonly ADD_INSTITUTION = '__add_institution__';
  readonly addInstitutionValue = AddClassroom.ADD_INSTITUTION;

  readonly types = CLASSROOM_TYPES;
  readonly countries = this.config.countryNamesSignal;
  readonly boards = this.config.boards;

  // ---- Form state --------------------------------------------------------
  //
  // `type` starts EMPTY rather than at 'CLASSROOM', because it is the first
  // question and a pre-picked answer would let the whole form unlock without
  // the user having chosen anything.
  readonly type = signal<ClassroomType | ''>('');
  readonly country = signal(DEFAULT_CLASSROOM_COUNTRY);
  readonly pincode = signal('');
  readonly board = signal('');
  readonly institutionId = signal('');
  readonly grade = signal('');
  readonly section = signal('');
  readonly stemClubName = signal('');
  readonly selectedProgrammeIds = signal<ReadonlySet<string>>(new Set());

  /**
   * Whether Search has been pressed.
   *
   * The School list stays closed until it has, matching production. Filtering
   * as the pincode is typed would repopulate the list on every keystroke and
   * make a half-typed pincode look like "no schools here".
   */
  readonly searched = signal(false);


  /**
   * The inline "new programme" form, shown only when asked for.
   *
   * It asks for a NAME and nothing else. The code used to be a free-text field
   * here, which was wrong: production allocates programme codes from a sequence
   * (P11697, P11698) and a hand-typed one could never join it. The service
   * allocates the code now, so there is nothing left for this form to ask.
   */
  readonly creatingProgramme = signal(false);
  readonly newProgrammeName = signal('');

  /** The nested Add a New Institution form. */
  readonly creatingInstitution = signal(false);

  constructor() {
    /**
     * Selects the school the parent just created.
     *
     * An effect rather than a computed: this WRITES signals in response to an
     * input changing, which a computed must never do. It also reopens the school
     * list, because `searched` was reset when the form opened and the new school
     * has to be visible for the selection to mean anything.
     */
    effect(() => {
      const created = this.createdInstitution();

      if (!created) {
        return;
      }

      this.creatingInstitution.set(false);
      this.searched.set(true);
      this.institutionId.set(created.docId);
    });
  }

  readonly isClub = computed(() => this.type() === 'STEM-CLUB');

  /* ---- Progressive unlocking ---------------------------------------------
     Each control waits on the one above it. The chain already existed here in
     spirit — the school list needs a board and a pincode to search with — and
     this states it once instead of spreading it across five conditions.

     Grade and section belong to a classroom, the club name to a club, so only
     one of the two branches is in the chain at a time. ---------------------- */

  private readonly flow = computed<FlowField[]>(() => {
    const has = (value: unknown) => String(value ?? '').trim() !== '';

    return [
      { name: 'type',     filled: has(this.type()) },
      { name: 'country',  filled: has(this.country()) },
      { name: 'pincode',  filled: has(this.pincode()) },
      { name: 'board',    filled: has(this.board()) },
      { name: 'school',   filled: has(this.institutionId()) },
      ...(this.isClub()
        ? [{ name: 'club', filled: has(this.stemClubName()) }]
        : [
            { name: 'grade',   filled: has(this.grade()) },
            { name: 'section', filled: has(this.section()) }
          ])
    ];
  });

  locked(name: string): boolean {
    return isFieldLocked(this.flow(), name);
  }

  // ---- Sequential unlocking ---------------------------------------------

  readonly countryUnlocked = computed(() => this.type() !== '');
  readonly pincodeUnlocked = computed(() => this.countryUnlocked() && this.country() !== '');
  readonly boardUnlocked = computed(() => this.pincodeUnlocked() && this.pincodeValid());
  readonly searchUnlocked = computed(() => this.boardUnlocked() && this.board() !== '');
  readonly schoolUnlocked = computed(() => this.searched());
  readonly detailsUnlocked = computed(() => this.schoolUnlocked() && this.institutionId() !== '');
  readonly sectionUnlocked = computed(() => this.detailsUnlocked() && this.grade() !== '');

  /**
   * Programmes open once the classroom is fully identified — after a section
   * for a classroom, after a name for a club.
   */
  readonly programmesUnlocked = computed(() =>
    this.isClub()
      ? this.detailsUnlocked() && this.stemClubName().trim() !== ''
      : this.sectionUnlocked() && this.section() !== ''
  );

  /**
   * Pincode shape.
   *
   * Deliberately loose: India's six digits are the common case, but the Country
   * select offers the whole world and a UK postcode is neither six nor purely
   * numeric. This only gates when the Board control opens, so being generous
   * costs nothing — the field is stored on the institution, never on the
   * classroom, and is not validated again downstream.
   */
  readonly pincodeValid = computed(() => /^[A-Za-z0-9][A-Za-z0-9 -]{2,9}$/.test(this.pincode().trim()));

  // ---- Derived lists -----------------------------------------------------

  /**
   * Schools matching the board and pincode, filtered IN MEMORY from the
   * teacher's own institutions.
   *
   * Production issues a Firestore query with two where() clauses. This filters
   * the already-loaded, already-owner-scoped list instead: the rules require an
   * ownerId equality on every query, and adding board and pincode on top of it
   * would need a composite index for a result set that is small enough to scan.
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

  /**
   * Grades that still have a free section at the chosen school.
   *
   * A grade whose every section is taken is dropped entirely rather than shown
   * with an empty Section list, which is what production does and is the more
   * honest of the two: there is nothing left to create there.
   */
  readonly availableGrades = computed(() => {
    const institutionId = this.institutionId();

    if (!institutionId) {
      return GRADES;
    }

    return GRADES.filter(grade => {
      // A pre-primary grade carries no section, so it is taken outright once a
      // classroom exists for it rather than section by section.
      if (grade.startsWith('Pre-primary')) {
        return !takenSections(this.classrooms(), institutionId, grade).size;
      }

      return takenSections(this.classrooms(), institutionId, grade).size < SECTIONS.length;
    });
  });

  /** Sections not already used for this grade at this school. */
  readonly availableSections = computed(() => {
    const taken = takenSections(this.classrooms(), this.institutionId(), this.grade());

    return SECTIONS.filter(section => !taken.has(section));
  });

  /** The catalogue, narrowed to what this classroom may actually be given. */
  readonly availableProgrammes = computed(() => {
    const type = this.type();

    if (!type || !this.institutionId()) {
      return [];
    }

    return programmesFor(this.programmes(), {
      institutionId: this.institutionId(),
      type: programmeTypeFor(type),
      grade: this.grade()
    });
  });

  readonly selectedCount = computed(() => this.selectedProgrammeIds().size);

  /** Placeholder for the inline create form, in production's naming style. */
  readonly suggestedName = computed(() =>
    suggestedProgrammeName(this.selectedSchool()?.institutionName ?? '', this.grade(), 'Subject')
  );

  /**
   * Everything answered.
   *
   * At least one programme is required, matching production, where the
   * programme control carries Validators.required. A classroom with none is
   * not useful — nothing would ever be assigned to it.
   */
  readonly valid = computed(() => {
    if (!this.programmesUnlocked() || this.selectedCount() === 0) {
      return false;
    }

    return this.isClub()
      ? this.stemClubName().trim() !== ''
      : this.grade() !== '' && this.section() !== '';
  });

  // ---- Change handlers ---------------------------------------------------
  //
  // Each one CLEARS whatever depended on the answer it just changed. Without
  // this, picking a school, choosing grade 8, then going back and changing the
  // pincode would leave grade 8 selected against a school that may not have
  // been re-chosen — and the draft would be written with a mismatched pair.

  setType(value: string): void {
    this.type.set(value as ClassroomType | '');
    this.resetFromSchool();
    this.grade.set('');
    this.section.set('');
    this.stemClubName.set('');
  }

  setCountry(value: string): void {
    this.country.set(value);
    this.board.set('');
    this.resetFromSchool();
  }

  setPincode(value: string): void {
    this.pincode.set(value);
    this.board.set('');
    this.resetFromSchool();
  }

  setBoard(value: string): void {
    this.board.set(value);
    this.resetFromSchool();
  }

  search(): void {
    this.searched.set(true);
  }

  setInstitution(value: string): void {
    /**
     * The sentinel is not a school — it opens the form instead.
     *
     * The select is left where it was rather than moved to the sentinel, so
     * cancelling the form returns to whatever was chosen before it opened
     * instead of a control showing "Add a New Institution" as its value.
     */
    if (value === AddClassroom.ADD_INSTITUTION) {
      this.creatingInstitution.set(true);
      return;
    }

    this.institutionId.set(value);
    this.grade.set('');
    this.section.set('');
    this.clearProgrammes();
  }

  closeInstitutionForm(): void {
    this.creatingInstitution.set(false);
  }

  /** Passes the draft up. The page writes it and sends the result back down. */
  requestInstitution(draft: InstitutionDraft): void {
    this.institutionRequested.emit(draft);
  }

  setGrade(value: string): void {
    this.grade.set(value);
    this.section.set('');
    // The programme list is grade-scoped, so a selection made under the old
    // grade may no longer be on offer.
    this.clearProgrammes();
  }

  setSection(value: string): void {
    this.section.set(value);
  }

  setStemClubName(value: string): void {
    this.stemClubName.set(value);
  }

  /** Clears the school and everything chosen after it. */
  private resetFromSchool(): void {
    this.searched.set(false);
    this.institutionId.set('');
    this.clearProgrammes();
  }

  private clearProgrammes(): void {
    this.selectedProgrammeIds.set(new Set());
    this.creatingProgramme.set(false);
  }

  toggleProgramme(programmeId: string): void {
    this.selectedProgrammeIds.update(current => {
      const next = new Set(current);

      if (!next.delete(programmeId)) {
        next.add(programmeId);
      }

      return next;
    });
  }

  isSelected(programmeId: string): boolean {
    return this.selectedProgrammeIds().has(programmeId);
  }

  // ---- Inline programme creation ----------------------------------------

  openProgrammeForm(): void {
    this.creatingProgramme.set(true);
  }

  cancelProgrammeForm(): void {
    this.creatingProgramme.set(false);
    this.newProgrammeName.set('');
  }

  readonly newProgrammeValid = computed(() => this.newProgrammeName().trim() !== '');

  /**
   * Asks the PARENT to create the programme.
   *
   * This component never writes. The parent owns every Firestore call, so a
   * created programme lands in the catalogue the page already holds and flows
   * straight back down through the `programmes` input — no reload, and no
   * second copy of the list to keep in step.
   *
   * The new programme is scoped to the school and grade currently chosen, which
   * is the only scope that can be correct: it is being created because the
   * picker for that exact combination had nothing to offer.
   */
  createProgramme(): void {
    const school = this.selectedSchool();
    const type = this.type();

    if (!this.newProgrammeValid() || !school || !type) {
      return;
    }

    const name = this.newProgrammeName().trim();

    this.programmeRequested.emit({
      programmeName: name,
      displayName: name,
      // Nothing to describe it with from here; the Programme page can fill it in.
      programmeDescription: '',
      institutionId: school.docId,
      institutionName: school.institutionName,
      // A club programme is not grade-scoped, so it carries no grades.
      grades: this.isClub() || !this.grade() ? [] : [this.grade()],
      // Grade-scoped by construction, so the age band stays empty.
      age: [],
      type: programmeTypeFor(type),
      // Created LIVE: it exists because it is wanted on the classroom being
      // filled in right now, and a DRAFT would not be offered by the picker.
      programmeStatus: 'LIVE',
      // Written empty rather than omitted, so a programme created from here has
      // the same shape as one created by the Programme wizard.
      programmeImagePath: '',
      learningUnitsIds: [],
      assignmentIds: []
    });

    this.cancelProgrammeForm();
  }

  // ---- Submit ------------------------------------------------------------

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  save(): void {
    const school = this.selectedSchool();
    const type = this.type();

    if (this.saving() || !this.valid() || !school || !type) {
      return;
    }

    const chosen = this.availableProgrammes().filter(programme =>
      this.selectedProgrammeIds().has(programme.programmeId)
    );

    this.submitted.emit({
      type,
      // classroomName is composed by the service, so every writer produces the
      // same "8 B" rather than each one formatting it its own way.
      classroomName: '',
      stemClubName: this.isClub() ? this.stemClubName().trim() : '',
      grade: this.isClub() ? '' : this.grade(),
      section: this.isClub() ? '' : this.section(),
      board: school.board,
      institutionId: school.docId,
      institutionName: school.institutionName,
      programmes: Object.fromEntries(
        chosen.map(programme => [
          programme.programmeId,
          {
            programmeId: programme.programmeId,
            programmeName: programme.programmeName,
            programmeCode: programme.programmeCode,
            displayName: programme.displayName?.trim() || programme.programmeName
          }
        ])
      )
    });
  }

  close(): void {
    this.closed.emit();
  }
}

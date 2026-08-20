import { Component, computed, input, output, signal, inject } from '@angular/core';
import { ConfigurationService } from '../../services/configuration.service';

import { Icon } from '../../components/icon/icon';
import { gradeLabel } from '../../data/classroom-options';
import {
  KnownTeacher,
  TeacherClassEntry,
  TeacherEntry,
  emptyClassEntry,
  emptyTeacherEntry,
  findKnownTeacher,
  isBlankClass,
  isBlankEntry,
  isCompleteClass,
  isCompleteEntry,
  isValidEmail,
  isValidPhone,
  toPhoneDigits
} from '../../data/teacher-options';

/**
 * Add Teachers — step 2 of the Set Up Wizard.
 *
 * ONE TEACHER, MANY CLASSES. The ⊕ appends another Grade/Section/Programme row
 * under the SAME set of contact details — it does not add another teacher. That
 * is what the reference does, and it follows from the fact that a teacher takes
 * several classes while having one phone number.
 *
 * THE CLASS ROWS START HIDDEN. Nothing of Grade/Section/Programme is shown until
 * the ⊕ is pressed, so a teacher can be registered without one and the form opens
 * on the five fields that describe the person rather than on eight.
 *
 * A COMPLETED CLASS ROW LOCKS. Only the last row is editable; the ones above it
 * render read-only with a bin beside them, which is how the reference draws them.
 * Changing a committed row means deleting it and adding it again — deliberate,
 * because the rows are a set and an edit-in-place invites two rows quietly
 * becoming the same class.
 *
 * ITS OWN COMPONENT rather than another branch inside setup-wizard.html, because
 * this file is already long enough to be worth reading on its own and the wizard
 * page has no business holding a repeatable form's row bookkeeping.
 *
 * Nothing here is specific to step 2 — the heading lives in the stepper, not in
 * this file — so a second cohort step could reuse it unchanged. Production has
 * one (Add STEM Club Teachers); it was removed from this wizard on instruction.
 *
 * IT COLLECTS; IT DOES NOT WRITE. `submitted` carries the rows up to the wizard,
 * which owns what happens to them. That is the same split every other form in
 * this app uses, and it is what will let a Firestore write be added in one place
 * rather than in each step.
 *
 * IT RECOGNISES A NUMBER IT HAS SEEN, AND THEN GOES READ-ONLY. Ten digits that
 * match an already-registered teacher fill in their name, email and role — and
 * lock the WHOLE form, class rows included. The ⊕ is withdrawn and Submit is
 * dead: an existing teacher is shown, not edited, from here.
 *
 * That is narrower than it once was. This step used to let a matched teacher be
 * given additional classes, which is what TeacherService.appendClasses exists
 * for; that path was closed on instruction. The service method is left in place
 * because it is correct and tested, and reopening this is a matter of unlocking
 * the rows again.
 *
 * ZONELESS. Every field the template reads is a signal.
 */
@Component({
  selector: 'app-add-teachers',
  imports: [Icon],
  templateUrl: './add-teachers.html',
  styleUrl: './add-teachers.css'
})
export class AddTeachers {

  /**
   * Option lists, read from the Configuration collection in Firestore.
   *
   * The properties below are its SIGNALS, so a list edited in the console reaches
   * this form without a deploy. Each falls back to the constant it replaced, so a
   * refused read renders the options the app shipped with rather than empty selects.
   */
  private config = inject(ConfigurationService);

  /**
   * The dial code shown as a non-editable prefix.
   *
   * Passed in from the wizard rather than hardcoded to +91, because step 1 has a
   * Country select and the two must not disagree about which country this run is
   * for.
   */
  readonly dial = input('+91');

  /** True while the wizard is writing. Keeps Submit from firing twice. */
  readonly saving = input(false);

  /**
   * The chosen institution's programme catalogue.
   *
   * Passed in rather than read here, because WHICH catalogue is a wizard
   * question — it depends on the institution picked in step 1 — and this
   * component has no business knowing about institutions.
   */
  readonly programmes = input<readonly { id: string; name: string }[]>([]);

  /**
   * Teachers this admin has already registered, for the phone lookup.
   *
   * Passed in rather than read here for the same reason the catalogue is: which
   * teachers exist is the wizard's question, and a form that fetches its own
   * data is a form that cannot be rendered in a test without a service.
   */
  readonly known = input<readonly KnownTeacher[]>([]);

  readonly submitted = output<TeacherEntry[]>();

  readonly roles = this.config.teacherRoles;
  readonly grades = this.config.grades;
  readonly sections = this.config.sections;
  readonly gradeLabel = gradeLabel;

  /**
   * Bulk Upload Teachers.
   *
   * The step-1 toggle's twin, and off for the same reason: the two modes are
   * alternatives, so switching it on replaces the rows rather than adding a
   * panel beneath them.
   */
  readonly bulkUpload = signal(false);

  /** The one teacher being entered, with the class rows they take. */
  readonly entry = signal<TeacherEntry>(emptyTeacherEntry());

  /** The class rows, read straight off the teacher. */
  readonly classes = computed(() => this.entry().classes);

  /**
   * Which controls have been left, and whether Submit has been pressed.
   *
   * Class-row keys are `${index}.${field}` rather than the field alone: every
   * row shares field names, and a single set would paint row 2's untouched
   * Section red because row 1's was left empty.
   */
  private readonly blurred = signal<ReadonlySet<string>>(new Set());
  private readonly attempted = signal(false);

  readonly count = computed(() => this.classes().length);

  /**
   * The registered teacher this number belongs to, or undefined.
   *
   * Derived rather than stored, so it cannot fall out of step with the number in
   * the field — the one bug this feature is most likely to have.
   */
  readonly matched = computed(() => findKnownTeacher(this.known(), this.entry().phone));

  /**
   * A recognised number makes the ENTIRE form read-only.
   *
   * Not just the name and email: the class rows too, and the ⊕ that would add
   * one. An existing teacher is displayed here, not edited.
   */
  readonly identityLocked = computed(() => !!this.matched());

  /** No ⊕ for a teacher who already exists — there is nothing to add. */
  readonly canAddClass = computed(() => !this.identityLocked());

  /** Only the last class row is editable; the ones above it are committed. */
  locked(index: number): boolean {
    return index < this.classes().length - 1;
  }

  /**
   * Every row valid, and at least one of them non-blank.
   *
   * The blank check matters because a fresh row is not "invalid" in the sense of
   * having bad input — it is empty — and without this a form the user has not
   * touched would report itself complete.
   */
  readonly canSubmit = computed(() => {
    const entry = this.entry();

    /**
     * A RECOGNISED NUMBER CANNOT BE SUBMITTED. Nothing on the form is editable
     * once one is matched, so there is nothing to save — and a live Submit over a
     * read-only form would only ever write back what is already stored.
     */
    if (this.identityLocked()) {
      return false;
    }

    return !isBlankEntry(entry) && isCompleteEntry(entry);
  });

  // ---- Row editing --------------------------------------------------------

  /** A field on the teacher themselves — phone, email, the names, the role. */
  update(field: 'phone' | 'email' | 'firstName' | 'lastName' | 'role', value: string): void {
    if (field !== 'phone') {
      this.entry.update(current => ({ ...current, [field]: value }));
      return;
    }

    this.setPhone(toPhoneDigits(value));
  }

  /**
   * The phone, and everything that follows from it.
   *
   * A COMPLETE number that belongs to somebody fills their details in. Editing it
   * away again CLEARS what the lookup wrote, so the form never sits showing one
   * person's name against another's number — which it would if prefilled values
   * were simply left behind.
   *
   * Only the fields the lookup filled are cleared. Anything typed by hand before
   * the number was recognised is left alone, because taking it away would be
   * deleting the user's own work to tidy up after a feature they did not ask for.
   */
  private setPhone(phone: string): void {
    const before = this.matched();
    const after = findKnownTeacher(this.known(), phone);

    this.entry.update(current => {
      if (after) {
        return {
          ...current,
          phone,
          existingId: after.docId,
          firstName: after.firstName,
          lastName: after.lastName,
          email: after.email,
          role: after.role || current.role
        };
      }

      if (!before) {
        return { ...current, phone, existingId: '' };
      }

      // The match is gone. Undo the prefill, but only where it is still exactly
      // what the lookup put there.
      return {
        ...current,
        phone,
        existingId: '',
        firstName: current.firstName === before.firstName ? '' : current.firstName,
        lastName: current.lastName === before.lastName ? '' : current.lastName,
        email: current.email === before.email ? '' : current.email
      };
    });
  }

  /** A field on one class row. */
  updateClass(index: number, field: keyof TeacherClassEntry, value: string): void {
    this.entry.update(current => ({
      ...current,
      classes: current.classes.map((row, position) =>
        position === index ? { ...row, [field]: value } : row
      )
    }));
  }

  /**
   * Appends a class row — and, on the first press, is what REVEALS them at all.
   *
   * Refuses while the current last row is incomplete, and marks it instead: a ⊕
   * pressed over a half-filled row would lock that row unfinished, and the only
   * way back would be deleting it. With no rows yet there is nothing to refuse
   * over, so the first press always works.
   */
  addClass(): void {
    if (!this.canAddClass()) {
      return;
    }

    const rows = this.classes();
    const last = rows[rows.length - 1];

    if (last && !isCompleteClass(last)) {
      this.attempted.set(true);
      return;
    }

    this.entry.update(current => ({ ...current, classes: [...current.classes, emptyClassEntry()] }));
  }

  /**
   * Removes a class row.
   *
   * REMOVES THE LAST ONE OUTRIGHT now, rather than clearing it. Classes are
   * optional and hidden until asked for, so a teacher with none is a legitimate
   * state and the ⊕ brings the controls back — where previously an empty row was
   * always on screen and had to be kept.
   *
   * The bin is hidden while a single row is showing, so reaching this with one
   * row means a keyboard or programmatic caller; it is handled rather than
   * guarded against.
   */
  removeClass(index: number): void {
    this.entry.update(current => ({
      ...current,
      classes: current.classes.filter((_, position) => position !== index)
    }));

    this.blurred.set(new Set());
  }

  // ---- Validation ---------------------------------------------------------

  markBlurred(key: string): void {
    this.blurred.update(current => new Set(current).add(key));
  }

  private shows(key: string): boolean {
    return this.attempted() || this.blurred().has(key);
  }

  /**
   * A blank row is never wrong.
   *
   * Pressing ⊕ and then Submit must not turn the row you have not reached yet
   * red — it is skipped on submit, so complaining about it would be complaining
   * about something that is not blocking anything.
   */
  phoneInvalid(): boolean {
    return this.shows('phone') && !isValidPhone(this.entry().phone);
  }

  emailInvalid(): boolean {
    return this.shows('email') && !isValidEmail(this.entry().email);
  }

  /** A required field on the teacher left empty. */
  missing(field: 'firstName' | 'lastName'): boolean {
    return this.shows(field) && this.entry()[field].trim() === '';
  }

  /**
   * A required control on one class row left empty.
   *
   * A LOCKED ROW IS NEVER WRONG — it was complete when it was committed — and a
   * blank trailing row is only wrong once Submit has been pressed, because until
   * then the user may simply not have reached it.
   */
  missingClass(index: number, field: keyof TeacherClassEntry): boolean {
    const row = this.classes()[index];

    // A read-only row cannot be wrong, whether it is read-only because it was
    // committed or because the teacher already exists.
    if (!row || this.locked(index) || this.identityLocked()) {
      return false;
    }

    if (isBlankClass(row) && !this.attempted()) {
      return false;
    }

    return this.shows(`${index}.${field}`) && row[field].trim() === '';
  }

  // ---- Actions ------------------------------------------------------------

  toggleBulkUpload(): void {
    this.bulkUpload.update(on => !on);
  }

  /**
   * Hands the teacher up, then resets to a blank one.
   *
   * The button is disabled while incomplete, so this rarely runs against a bad
   * form — but the guard stays, because `addClass()` also sets `attempted` and a
   * keyboard or programmatic call must not slip past.
   */
  submit(): void {
    if (this.saving()) {
      return;
    }

    this.attempted.set(true);

    if (!this.canSubmit()) {
      return;
    }

    /**
     * A trailing blank class row is DROPPED rather than rejected: it is what a ⊕
     * pressed one time too many leaves behind, and refusing the whole submit over
     * it would be pedantry. `canSubmit` has already established the rest are
     * complete.
     */
    const entry = this.entry();

    this.submitted.emit([{
      ...entry,
      classes: entry.classes.filter(row => !isBlankClass(row))
    }]);

    this.entry.set(emptyTeacherEntry());
    this.blurred.set(new Set());
    this.attempted.set(false);
  }

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }
}

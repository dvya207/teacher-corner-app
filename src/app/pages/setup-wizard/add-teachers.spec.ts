import { ComponentFixture, TestBed } from '@angular/core/testing';

import { KnownTeacher, TeacherEntry } from '../../data/teacher-options';
import { AddTeachers } from './add-teachers';

/**
 * Add Teachers — step 2 of the Set Up Wizard.
 *
 * WHAT IS WORTH PINNING. The class rows are repeatable, and every bug a
 * repeatable form has is about rows being confused with one another: an edit
 * landing in the wrong row, one row's error painting another's, a removed row
 * taking its neighbour's values.
 *
 * The other half is the two states the form can be in — a NEW teacher, where
 * everything is editable, and a RECOGNISED one, where nothing is.
 *
 * Nothing here touches Firestore — the component collects and emits, and the
 * wizard decides what happens next.
 */
describe('Add Teachers', () => {

  let fixture: ComponentFixture<AddTeachers>;
  let component: AddTeachers;
  let emitted: TeacherEntry[][];

  const CATALOGUE = [
    { id: 'prog-1', name: 'Oak 26-27 Grade 1 - Science' },
    { id: 'prog-2', name: 'Oak 26-27 Grade 2 - Maths' }
  ];

  const ANITA: KnownTeacher = {
    docId: 'existing-1',
    countryCode: '+91',
    phoneNumber: '9876543210',
    firstName: 'Anita',
    lastName: 'Rao',
    email: 'anita@example.com',
    role: 'ThinkTac Coach'
  };

  async function render(
    dial = '+91',
    programmes: { id: string; name: string }[] = CATALOGUE,
    known: KnownTeacher[] = []
  ): Promise<void> {
    await TestBed.configureTestingModule({ imports: [AddTeachers] }).compileComponents();

    fixture = TestBed.createComponent(AddTeachers);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('dial', dial);
    fixture.componentRef.setInput('programmes', programmes);
    fixture.componentRef.setInput('known', known);

    emitted = [];
    component.submitted.subscribe(rows => emitted.push(rows));

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function classRows(): number {
    return el().querySelectorAll('.class-row').length;
  }

  /** The teacher's own required fields. */
  function fillTeacher(phone = '9000000000', first = 'Anita'): void {
    component.update('phone', phone);
    component.update('firstName', first);
    component.update('lastName', 'Rao');
    // REQUIRED, so a "filled" teacher has to carry one. Tests that care about
    // the email itself set or clear it explicitly after calling this.
    component.update('email', 'anita.rao@example.com');
  }

  /**
   * Reveals a class row and answers it.
   *
   * The rows are hidden until the ⊕ is pressed, so every test that needs one has
   * to ask for it the way a user would.
   */
  function addClass(section = 'A', programmeId = 'prog-1', grade = '1'): void {
    component.addClass();
    const index = component.classes().length - 1;
    component.updateClass(index, 'grade', grade);
    component.updateClass(index, 'section', section);
    component.updateClass(index, 'programmeId', programmeId);
  }

  /* ---- What the form opens on --------------------------------------------- */

  /**
   * THE CLASS CONTROLS START HIDDEN. The form opens on the five fields that
   * describe the person; Grade/Section/Programme appear only when asked for.
   */
  it('opens with no class rows at all', async () => {
    await render();

    expect(classRows()).toBe(0);
    expect(el().querySelector('#tc-grade-0')).toBeNull();
    expect(el().querySelectorAll('#tc-phone').length).toBe(1);
  });

  it('reveals the first class row when the ⊕ is pressed', async () => {
    await render();

    component.addClass();
    fixture.detectChanges();

    expect(classRows()).toBe(1);
    expect(el().querySelector('#tc-grade-0')).not.toBeNull();
  });

  it('shows the person’s fields, with only Email and Role unmarked', async () => {
    await render();

    const labels = [...el().querySelectorAll('.field > label')]
      .map(label => label.textContent?.replace(/\s+/g, ' ').trim());

    expect(labels).toEqual([
      'Phone *',
      'Email (optional)',
      'First Name *',
      'Last Name *',
      'Teacher Role'
    ]);
  });

  it('adds the three class labels once a row exists', async () => {
    await render();
    component.addClass();
    fixture.detectChanges();

    const labels = [...el().querySelectorAll('.field > label')]
      .map(label => label.textContent?.replace(/\s+/g, ' ').trim());

    expect(labels.slice(5)).toEqual(['Grade *', 'Section *', 'Programme *']);
  });

  /** The prefix comes from step 1's Country, so the two cannot disagree. */
  it('shows the dial code it was given, not a hardcoded +91', async () => {
    await render('+44');

    expect(el().querySelector('.phone-prefix')?.textContent?.trim()).toBe('+44');
  });

  /**
   * PINNED to production's list. An earlier version offered five roles inferred
   * from a screenshot that only showed the control at rest.
   */
  it('offers production’s two roles and no others', async () => {
    await render();

    const options = [...el().querySelectorAll('#tc-role option')]
      .map(option => option.textContent?.trim());

    expect(options).toEqual(['School Teacher', 'ThinkTac Coach']);
  });

  it('opens the role control on School Teacher', async () => {
    await render();

    expect(el().querySelector<HTMLSelectElement>('#tc-role')?.value).toBe('School Teacher');
  });

  /* ---- One teacher, many classes ------------------------------------------ */

  /**
   * THE STRUCTURAL POINT. The ⊕ appends a CLASS, not a teacher — a teacher takes
   * several classes while having one phone number.
   */
  it('adds a class row, not another teacher', async () => {
    await render();
    addClass();

    component.addClass();
    fixture.detectChanges();

    expect(classRows()).toBe(2);
    expect(el().querySelectorAll('#tc-phone').length).toBe(1);
  });

  /**
   * A ⊕ pressed over a half-filled row would lock it unfinished, and the only way
   * back would be deleting it.
   */
  it('refuses to add a row while the current one is incomplete', async () => {
    await render();
    component.addClass();
    component.updateClass(0, 'section', 'A');

    component.addClass();
    fixture.detectChanges();

    expect(classRows()).toBe(1);
    expect(component.missingClass(0, 'programmeId')).toBe(true);
  });

  it('locks every row but the last', async () => {
    await render();
    addClass();
    addClass('B', 'prog-2');
    component.addClass();
    fixture.detectChanges();

    expect(component.locked(0)).toBe(true);
    expect(component.locked(1)).toBe(true);
    expect(component.locked(2)).toBe(false);
    expect(el().querySelector<HTMLSelectElement>('#tc-grade-0')?.disabled).toBe(true);
    expect(el().querySelector<HTMLSelectElement>('#tc-grade-2')?.disabled).toBe(false);
  });

  it('keeps a locked row visible with its values', async () => {
    await render();
    addClass('C', 'prog-2');
    component.addClass();
    fixture.detectChanges();

    expect(el().querySelector<HTMLSelectElement>('#tc-section-0')?.value).toBe('C');
    expect(el().querySelector<HTMLSelectElement>('#tc-programme-0')?.value).toBe('prog-2');
    expect(el().querySelector('.class-row.is-locked')).not.toBeNull();
  });

  it('marks a required control only on the row still being filled', async () => {
    await render();
    addClass();
    component.addClass();
    component.submit();
    fixture.detectChanges();

    expect(component.missingClass(0, 'section')).toBe(false);
    expect(component.missingClass(1, 'section')).toBe(true);
  });

  /**
   * THE BUG THIS CATCHES: an edit landing in the wrong row. Every row shares
   * field names, so an update keyed on the field alone writes to all of them.
   */
  it('edits only the row it was given', async () => {
    await render();
    addClass();
    component.addClass();

    component.updateClass(1, 'section', 'Z');

    expect(component.classes()[0].section).toBe('A');
    expect(component.classes()[1].section).toBe('Z');
  });

  /* ---- The bin ------------------------------------------------------------ */

  /** With one row there is nothing to remove; a bin that clears is not a bin. */
  it('hides the bin while there is only one class row', async () => {
    await render();
    component.addClass();
    fixture.detectChanges();

    expect(el().querySelectorAll('.class-remove').length).toBe(0);
  });

  it('shows a bin on every row once the ⊕ has produced a second', async () => {
    await render();
    addClass();

    component.addClass();
    fixture.detectChanges();

    expect(el().querySelectorAll('.class-remove').length).toBe(2);
  });

  it('hides the bin again when a delete leaves one row', async () => {
    await render();
    addClass();
    component.addClass();
    fixture.detectChanges();
    expect(el().querySelectorAll('.class-remove').length).toBe(2);

    component.removeClass(1);
    fixture.detectChanges();

    expect(el().querySelectorAll('.class-remove').length).toBe(0);
  });

  it('removes the row asked for, not the last one', async () => {
    await render();
    addClass('A');
    addClass('B');
    addClass('C');

    component.removeClass(1);
    fixture.detectChanges();

    expect(component.classes().map(row => row.section)).toEqual(['A', 'C']);
  });

  /** Classes are optional, so removing the last one is allowed outright. */
  it('removes the only row rather than clearing it', async () => {
    await render();
    addClass();

    component.removeClass(0);
    fixture.detectChanges();

    expect(classRows()).toBe(0);
  });

  it('unlocks the row that becomes last after a delete', async () => {
    await render();
    addClass();
    component.addClass();
    expect(component.locked(0)).toBe(true);

    component.removeClass(1);
    fixture.detectChanges();

    expect(component.locked(0)).toBe(false);
  });

  /* ---- Phone and email ---------------------------------------------------- */

  it('strips non-digits and caps the number at ten', async () => {
    await render();

    component.update('phone', '+91 98765-4321099');

    expect(component.entry().phone).toBe('9198765432');
  });

  it('reports a short number once the field has been left', async () => {
    await render();

    component.update('phone', '12345');
    expect(component.phoneInvalid()).toBe(false);

    component.markBlurred('phone');
    fixture.detectChanges();

    expect(component.phoneInvalid()).toBe(true);
    expect(el().querySelector('.field-error')?.textContent?.trim())
      .toBe('Enter valid 10 digits phone number');
  });

  it('requires an email, and says so rather than failing silently', async () => {
    await render();
    fillTeacher();
    addClass();
    component.update('email', '');
    component.markBlurred('email');
    fixture.detectChanges();

    // NOT emailInvalid(): isValidEmail() passes '' so it can validate format
    // alone. A blank field is reported by emailMissing() instead.
    expect(component.emailInvalid()).toBe(false);
    expect(component.emailMissing()).toBe(true);
    expect(component.canSubmit()).toBe(false);

    const errors = [...el().querySelectorAll('.field-error')].map(e => e.textContent?.trim());
    expect(errors).toContain('Email is required');
  });

  it('rejects a malformed one', async () => {
    await render();

    component.update('email', 'not-an-address');
    component.markBlurred('email');

    expect(component.emailInvalid()).toBe(true);
  });

  /* ---- Grade, Section, Programme ------------------------------------------ */

  it('labels the numbered grades and leaves the pre-primary years alone', async () => {
    await render();
    component.addClass();
    fixture.detectChanges();

    const options = [...el().querySelectorAll('#tc-grade-0 option')]
      .map(o => o.textContent?.trim());

    expect(options).toContain('Class 1');
    expect(options).toContain('Pre-primary 1');
    expect(options).not.toContain('Class Pre-primary 1');
  });

  /** Stored bare: prettifying would write a value no imported row would match. */
  it('stores the bare grade, not its label', async () => {
    await render();
    component.addClass();

    component.updateClass(0, 'grade', '8');

    expect(component.classes()[0].grade).toBe('8');
  });

  it('includes production’s NA section', async () => {
    await render();
    component.addClass();
    fixture.detectChanges();

    const options = [...el().querySelectorAll('#tc-section-0 option')]
      .map(o => o.textContent?.trim());

    expect(options[0]).toBe('Select');
    expect(options).toContain('NA');
  });

  it('lists the programmes it was given, by name', async () => {
    await render();
    component.addClass();
    fixture.detectChanges();

    const options = [...el().querySelectorAll('#tc-programme-0 option')]
      .map(o => o.textContent?.trim())
      .filter(Boolean);

    expect(options).toEqual(['Oak 26-27 Grade 1 - Science', 'Oak 26-27 Grade 2 - Maths']);
  });

  /** An empty catalogue is work to do elsewhere, so the control says so once. */
  it('disables Programme and explains itself when the catalogue is empty', async () => {
    await render('+91', []);
    component.addClass();
    fixture.detectChanges();

    expect(el().querySelector<HTMLSelectElement>('#tc-programme-0')?.disabled).toBe(true);
    expect(el().querySelector('.field-hint.is-warn')?.textContent)
      .toContain('no live programmes yet');
  });

  /* ---- Submit ------------------------------------------------------------- */

  it('will not submit a form nobody has typed into', async () => {
    await render();

    expect(component.canSubmit()).toBe(false);

    component.submit();

    expect(emitted.length).toBe(0);
  });

  /**
   * AT LEAST ONE CLASS IS REQUIRED. Because the controls are hidden behind the
   * ⊕, the requirement is invisible until it is announced, so the message is
   * part of the contract rather than a nicety.
   */
  it('refuses a teacher with no classes, and says why', async () => {
    await render();
    fillTeacher();

    expect(component.canSubmit()).toBe(false);

    component.submit();
    fixture.detectChanges();

    expect(emitted.length).toBe(0);
    expect(component.classesMissing()).toBe(true);

    const errors = [...el().querySelectorAll('.field-error')].map(e => e.textContent?.trim());
    expect(errors).toContain('Add at least one class using the + below');
  });

  /**
   * A row that exists must be blank or complete, never in between.
   *
   * An untouched row is what a ⊕ pressed one time too many leaves behind, so it
   * is tolerated and dropped on submit. One with a section but no programme is a
   * genuine mistake, and blocks.
   */
  it('tolerates a blank added row but blocks a half-filled one', async () => {
    await render();
    fillTeacher();
    // A COMPLETE ROW FIRST, because one is now required: a blank row on its own
    // no longer satisfies the requirement, so this test would otherwise be
    // asserting the class rule rather than the blank-row rule.
    addClass('A', 'prog-1');

    component.addClass();
    expect(component.canSubmit()).toBe(true);

    component.updateClass(1, 'section', 'B');
    expect(component.canSubmit()).toBe(false);

    component.updateClass(1, 'programmeId', 'prog-2');
    expect(component.canSubmit()).toBe(true);
  });

  it('will not submit without both names', async () => {
    await render();
    fillTeacher();
    component.update('firstName', '   ');

    expect(component.canSubmit()).toBe(false);
  });

  it('keeps Submit dead until the person’s fields are complete', async () => {
    await render();
    const button = () => el().querySelector<HTMLButtonElement>('.entry-foot button')!;

    expect(button().disabled).toBe(true);

    fillTeacher();
    fixture.detectChanges();

    // Still dead: the person is complete but they have no class yet.
    expect(button().disabled).toBe(true);

    addClass();
    fixture.detectChanges();

    expect(button().disabled).toBe(false);
  });

  it('keeps Submit dead while the wizard is writing', async () => {
    await render();
    fillTeacher();
    fixture.componentRef.setInput('saving', true);
    fixture.detectChanges();

    expect(el().querySelector<HTMLButtonElement>('.entry-foot button')?.disabled).toBe(true);
  });

  /** Pressing Submit is how the user asks what is left, so it paints the gaps. */
  it('stays on the step and marks the gaps when incomplete', async () => {
    await render();
    component.update('phone', '9876543210');
    component.submit();
    fixture.detectChanges();

    expect(emitted.length).toBe(0);
    expect(component.missing('firstName')).toBe(true);

    const errors = [...el().querySelectorAll('.field-error')].map(e => e.textContent?.trim());
    expect(errors).toContain('First name is required');
    expect(errors).toContain('Last name is required');
  });

  it('emits the teacher with every class they take', async () => {
    await render();
    fillTeacher();
    addClass('A', 'prog-1');
    addClass('B', 'prog-2');

    component.submit();

    expect(emitted.length).toBe(1);
    expect(emitted[0].length).toBe(1);
    expect(emitted[0][0].classes).toEqual([
      { grade: '1', section: 'A', programmeId: 'prog-1' },
      { grade: '1', section: 'B', programmeId: 'prog-2' }
    ]);
  });

  /** A trailing blank row is what a ⊕ pressed one time too many leaves behind. */
  it('drops a trailing blank class row rather than rejecting the submit', async () => {
    await render();
    fillTeacher();
    addClass();
    component.addClass();

    component.submit();

    expect(emitted.length).toBe(1);
    expect(emitted[0][0].classes.length).toBe(1);
  });

  it('resets to a blank teacher with no class rows after a successful submit', async () => {
    await render();
    fillTeacher();
    addClass();
    addClass('B');
    component.submit();
    fixture.detectChanges();

    expect(classRows()).toBe(0);
    expect(component.entry().phone).toBe('');
    expect(component.phoneInvalid()).toBe(false);
  });

  /**
   * NO RUNNING COUNT INSIDE THE FORM. A registration is confirmed by the toast
   * the wizard shows; a second green box in the card said the same thing twice
   * and was removed on instruction.
   */
  it('shows no confirmation inside the form itself', async () => {
    await render();

    expect(el().querySelector('.notice')).toBeNull();
  });

  /* ---- Bulk upload -------------------------------------------------------- */

  it('opens with the toggle off and the form showing', async () => {
    await render();

    expect(component.bulkUpload()).toBe(false);
    expect(el().querySelector('#tc-phone')).not.toBeNull();
  });

  /** The two modes are alternatives, so the form is replaced rather than joined. */
  it('replaces the form with the bulk panel when toggled on', async () => {
    await render();

    component.toggleBulkUpload();
    fixture.detectChanges();

    expect(el().querySelector('#tc-phone')).toBeNull();
    expect(el().querySelector('.step-stub h2')?.textContent?.trim()).toBe('Bulk upload');
  });

  /* ---- The phone lookup --------------------------------------------------- */

  it('fills in a registered teacher when the number is complete', async () => {
    await render('+91', CATALOGUE, [ANITA]);

    component.update('phone', '9876543210');
    fixture.detectChanges();

    expect(component.entry().firstName).toBe('Anita');
    expect(component.entry().lastName).toBe('Rao');
    expect(component.entry().email).toBe('anita@example.com');
    expect(component.entry().role).toBe('ThinkTac Coach');
    expect(component.entry().existingId).toBe('existing-1');
  });

  /** A lookup on three digits would prefill from whoever happened to share them. */
  it('does not look up a partial number', async () => {
    await render('+91', CATALOGUE, [ANITA]);

    component.update('phone', '98765');
    fixture.detectChanges();

    expect(component.matched()).toBeUndefined();
    expect(component.entry().firstName).toBe('');
  });

  it('says whose number it recognised, and nothing more', async () => {
    await render('+91', CATALOGUE, [ANITA]);

    component.update('phone', '9876543210');
    fixture.detectChanges();

    const notice = el().querySelector('.matched')?.textContent ?? '';
    expect(notice).toContain('Anita Rao');
    expect(notice).toContain('already registered on this number');
    // The second sentence was removed on instruction.
    expect(notice).not.toContain('will be added to them');
  });

  /* ---- A recognised number makes the whole form read-only ----------------- */

  /**
   * AN EXISTING TEACHER IS SHOWN, NOT EDITED. Everything locks — not just the
   * name and email, but the class rows and the ⊕ that would add one.
   */
  it('locks the person’s fields while the number is recognised', async () => {
    await render('+91', CATALOGUE, [ANITA]);

    component.update('phone', '9876543210');
    fixture.detectChanges();

    expect(el().querySelector<HTMLInputElement>('#tc-first')?.disabled).toBe(true);
    expect(el().querySelector<HTMLInputElement>('#tc-last')?.disabled).toBe(true);
    expect(el().querySelector<HTMLInputElement>('#tc-email')?.disabled).toBe(true);
    expect(el().querySelector<HTMLSelectElement>('#tc-role')?.disabled).toBe(true);
  });

  it('withdraws the ⊕ for a teacher who already exists', async () => {
    await render('+91', CATALOGUE, [ANITA]);

    component.update('phone', '9876543210');
    fixture.detectChanges();

    expect(component.canAddClass()).toBe(false);
    expect(el().querySelector('.add-entry')).toBeNull();
  });

  it('refuses to add a class row for a recognised number', async () => {
    await render('+91', CATALOGUE, [ANITA]);
    component.update('phone', '9876543210');

    component.addClass();
    fixture.detectChanges();

    expect(classRows()).toBe(0);
  });

  /**
   * THE INSTRUCTION THIS PINS: a row added before the number was recognised must
   * not stay editable once it is.
   */
  it('locks class rows added before the number was recognised', async () => {
    await render('+91', CATALOGUE, [ANITA]);
    addClass();
    fixture.detectChanges();
    expect(el().querySelector<HTMLSelectElement>('#tc-section-0')?.disabled).toBe(false);

    component.update('phone', '9876543210');
    fixture.detectChanges();

    expect(el().querySelector<HTMLSelectElement>('#tc-grade-0')?.disabled).toBe(true);
    expect(el().querySelector<HTMLSelectElement>('#tc-section-0')?.disabled).toBe(true);
    expect(el().querySelector<HTMLSelectElement>('#tc-programme-0')?.disabled).toBe(true);
  });

  it('will not submit a recognised teacher', async () => {
    await render('+91', CATALOGUE, [ANITA]);

    component.update('phone', '9876543210');
    fixture.detectChanges();

    expect(component.canSubmit()).toBe(false);
    expect(el().querySelector<HTMLButtonElement>('.entry-foot button')?.disabled).toBe(true);

    component.submit();

    expect(emitted.length).toBe(0);
  });

  it('leaves the fields open for a number nobody has', async () => {
    await render('+91', CATALOGUE, [ANITA]);

    component.update('phone', '9000000000');
    fixture.detectChanges();

    expect(component.identityLocked()).toBe(false);
    expect(component.canAddClass()).toBe(true);
    expect(el().querySelector<HTMLInputElement>('#tc-first')?.disabled).toBe(false);
  });

  /**
   * THE BUG THIS CATCHES: one person's name left showing against another's
   * number, because the prefill was never undone.
   */
  it('clears the prefill and unlocks when the number is edited away', async () => {
    await render('+91', CATALOGUE, [ANITA]);

    component.update('phone', '9876543210');
    expect(component.entry().firstName).toBe('Anita');

    component.update('phone', '9876543211');
    fixture.detectChanges();

    expect(component.matched()).toBeUndefined();
    expect(component.identityLocked()).toBe(false);
    expect(component.entry().firstName).toBe('');
    expect(component.entry().email).toBe('');
    expect(component.entry().existingId).toBe('');
  });

  /** Taking away the user's own typing to tidy up would be deleting their work. */
  it('keeps a name typed by hand when the number stops matching', async () => {
    await render('+91', CATALOGUE, [ANITA]);

    component.update('phone', '9876543210');
    component.update('firstName', 'Edited By Hand');
    component.update('phone', '9876543211');

    expect(component.entry().firstName).toBe('Edited By Hand');
  });

  it('recognises nobody when the pool is empty', async () => {
    await render();

    component.update('phone', '9876543210');

    expect(component.matched()).toBeUndefined();
    expect(component.identityLocked()).toBe(false);
  });
});

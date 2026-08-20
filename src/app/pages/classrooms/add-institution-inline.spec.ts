import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InstitutionDraft } from '../../models/teaching.model';
import { AddInstitutionInline } from './add-institution-inline';

/**
 * Add a New Institution — the inline school form.
 *
 * The claim worth guarding is that this writes the SAME shape the three-step
 * wizard writes, so it lands in the same `institutions` collection under the
 * same rules with no schema change. That is asserted on the emitted draft here;
 * the collection and rules themselves are covered by the rules suite.
 */
describe('AddInstitutionInline', () => {
  let fixture: ComponentFixture<AddInstitutionInline>;
  let component: AddInstitutionInline;
  let emitted: InstitutionDraft | undefined;

  async function open(
    context: { country?: string; board?: string; pincode?: string } = {}
  ): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({ imports: [AddInstitutionInline] }).compileComponents();

    fixture = TestBed.createComponent(AddInstitutionInline);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('country', context.country ?? 'India');
    fixture.componentRef.setInput('board', context.board ?? 'CBSE');
    fixture.componentRef.setInput('pincode', context.pincode ?? '564352');
    fixture.detectChanges();

    emitted = undefined;
    component.submitted.subscribe(draft => (emitted = draft));
  }

  /** Fills only the three fields the form requires. */
  function fillRequired(): void {
    component.update('registrationNumber', 'UDISE-99');
    component.update('institutionName', '  Oak Valley School  ');
    component.update('representativeFirstName', '  Megha  ');
  }

  beforeEach(async () => {
    await open();
  });

  /**
   * The whole reason the form is reachable from the classroom flow: the search
   * that found nothing is what pre-fills it.
   */
  it('carries the country, board and pincode in from the classroom form', () => {
    expect(component.field('board')).toBe('CBSE');
    expect(component.addressField('country')).toBe('India');
    expect(component.addressField('pincode')).toBe('564352');
  });

  it('shows the full board name while storing the code', async () => {
    await open({ board: 'ICSE' });

    expect(component.boardLabel()).toBe('Indian Certificate Of Secondary Education');
    expect(component.field('board')).toBe('ICSE');
  });

  /**
   * The dial code follows the country, as the wizard's does. Without it a school
   * abroad would store +91 against a real number.
   */
  it('derives the dial code from the country', async () => {
    expect(component.dialCode()).toBe('+91');

    await open({ country: 'Iraq' });
    expect(component.dialCode()).not.toBe('+91');
  });

  it('requires the UDISE code, the school name and the representative first name', () => {
    expect(component.valid()).toBe(false);

    component.update('registrationNumber', 'UDISE-99');
    expect(component.valid()).toBe(false);

    component.update('institutionName', 'Oak Valley School');
    expect(component.valid()).toBe(false);

    component.update('representativeFirstName', 'Megha');
    expect(component.valid()).toBe(true);
  });

  /** Everything else is descriptive and fillable later from Institutions. */
  it('does not require the address or the optional representative fields', () => {
    fillRequired();

    expect(component.valid()).toBe(true);
    expect(component.addressField('city')).toBe('');
    expect(component.field('representativeEmail')).toBe('');
  });

  it('refuses to emit while invalid', () => {
    component.save();

    expect(emitted).toBeUndefined();
  });

  /**
   * The emitted draft must be the wizard's shape exactly, because the page hands
   * it to the same InstitutionService.create().
   */
  it('emits a complete InstitutionDraft with every key present', () => {
    fillRequired();
    component.save();

    expect(emitted).toBeDefined();

    const draft = emitted as InstitutionDraft;

    // The address is a nested map, as production stores it.
    expect(Object.keys(draft.institutionAddress).sort()).toEqual([
      'city', 'country', 'district', 'landmark', 'pincode',
      'state', 'street', 'subDistrict', 'village'
    ]);

    // Fields the wizard sets that this form does not ask for still have values,
    // so nothing reaches Firestore as undefined.
    expect(draft.institutionCode).toBe('');
    expect(draft.customerSchool).toBe(false);
    expect(draft.active).toBe(true);
    expect(draft.verified).toBe(false);
  });

  it('trims the name and the representative fields', () => {
    fillRequired();
    component.save();

    expect((emitted as InstitutionDraft).institutionName).toBe('Oak Valley School');
    expect((emitted as InstitutionDraft).representativeFirstName).toBe('Megha');
  });

  /**
   * The dial code stays its own field and is never folded into the number —
   * storing the country twice would break comparison with production data.
   */
  it('strips the phone to subscriber digits and leaves the dial code alone', () => {
    fillRequired();
    component.update('representativePhoneNumber', '+91 98765 43210');
    component.save();

    const draft = emitted as InstitutionDraft;

    expect(draft.representativePhoneNumber).toBe('9876543210');
    expect(draft.representativeCountryCode).toBe('+91');
  });

  it('writes the prefilled board and pincode into the draft', () => {
    fillRequired();
    component.save();

    const draft = emitted as InstitutionDraft;

    expect(draft.board).toBe('CBSE');
    expect(draft.institutionAddress.pincode).toBe('564352');
  });

  /** A mistyped pincode is a likely reason the search found nothing. */
  it('lets the pincode be corrected', () => {
    fillRequired();
    component.updateAddress('pincode', '560001');
    component.save();

    expect((emitted as InstitutionDraft).institutionAddress.pincode).toBe('560001');
  });

  it('renders Submit as the only footer action', () => {
    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.modal-foot button')
    );

    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent?.trim()).toBe('Submit');
  });
  /* ---- Progressive unlocking --------------------------------------------- */

  /**
   * Each field waits on the one above it. Country, board and pincode are carried
   * in from the classroom form, so the chain effectively opens at the UDISE code.
   */
  it('opens at the UDISE code and locks everything below it', () => {
    expect(component.locked('udise')).toBe(false);
    expect(component.locked('name')).toBe(true);
    expect(component.locked('medium')).toBe(true);
    expect(component.locked('email')).toBe(true);

    expect((fixture.nativeElement.querySelector('#ai-name') as HTMLInputElement).disabled)
      .toBe(true);
  });

  it('unlocks the next field as each one is filled', () => {
    component.update('registrationNumber', 'UDISE-1');
    fixture.detectChanges();
    expect(component.locked('name')).toBe(false);
    expect(component.locked('medium')).toBe(true);

    component.update('institutionName', 'Oak Valley');
    fixture.detectChanges();
    expect(component.locked('medium')).toBe(false);
    expect((fixture.nativeElement.querySelector('#ai-medium') as HTMLSelectElement).disabled)
      .toBe(false);
  });

  /** Landmark is optional, so an empty one cannot hold City shut. */
  it('lets an empty Landmark through to City', () => {
    component.update('registrationNumber', 'UDISE-1');
    component.update('institutionName', 'Oak Valley');
    component.update('medium', 'EN');
    component.update('typeofSchool', 'Private School');
    component.update('genderType', 'Co-ed');
    component.updateAddress('street', 'MG Road');
    component.updateAddress('village', 'Indiranagar');
    fixture.detectChanges();

    expect(component.locked('landmark')).toBe(false);
    expect(component.locked('city')).toBe(false);
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InstitutionDraft } from '../../models/teaching.model';
import { AddInstitution } from './add-institution';

/**
 * Add Institution — the Country select, required fields, and the gated button.
 *
 * These drive the rendered DOM rather than the component's own signals, because
 * the requirement is about what the user can click: asserting `stepOneValid()`
 * would pass even if the button were never wired to it.
 */
describe('AddInstitution', () => {
  let fixture: ComponentFixture<AddInstitution>;
  let component: AddInstitution;
  let submitted: InstitutionDraft[];

  /** Everything the form demands, so tests can leave exactly one field out. */
  const COMPLETE: Record<string, string> = {
    board: 'CBSE',
    registrationNumber: 'RG-1001',
    institutionName: 'Deogiri Global Academy',
    medium: 'EN',
    typeofSchool: 'Private School',
    genderType: 'Co-ed',
    representativePhoneNumber: '9999900001',
    representativeFirstName: 'Megha',
    representativeLastName: 'Suryawanshi',
    // gmail.com, because that is the only domain the form accepts.
    representativeEmail: 'megha.more2021@gmail.com'
  };

  /** Landmark is absent on purpose: it is optional, and the form must be
      valid without it. */
  const COMPLETE_ADDRESS: Record<string, string> = {
    country: 'India',
    pincode: '431401',
    street: 'Vasmat Road',
    village: 'Shivaji Nagar',
    city: 'Parbhani',
    subDistrict: 'Parbhani',
    district: 'Parbhani',
    state: 'Maharashtra'
  };

  function fillEverything(): void {
    for (const [key, value] of Object.entries(COMPLETE)) {
      component.update(key as keyof InstitutionDraft, value as never);
    }

    for (const [key, value] of Object.entries(COMPLETE_ADDRESS)) {
      component.updateAddress(key as never, value);
    }

    fixture.detectChanges();
  }

  function nextButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('.next-btn') as HTMLButtonElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AddInstitution] }).compileComponents();

    fixture = TestBed.createComponent(AddInstitution);
    component = fixture.componentInstance;

    submitted = [];
    component.submitted.subscribe(draft => submitted.push(draft));

    fixture.detectChanges();
  });

  describe('country', () => {

    it('renders a Country select above Board', () => {
      const country = fixture.nativeElement.querySelector('#country');
      const board = fixture.nativeElement.querySelector('#board');

      expect(country).toBeTruthy();
      // compareDocumentPosition: 4 means board FOLLOWS country in the document.
      expect(country.compareDocumentPosition(board) & 4).toBeTruthy();
    });

    it('offers the whole world, not just India', () => {
      const options = fixture.nativeElement.querySelectorAll('#country option');
      // Plus the "Select country" placeholder.
      expect(options.length).toBeGreaterThan(190);
    });

    it('opens on India, as the reference does', () => {
      expect(component.draft().institutionAddress.country).toBe('India');
    });

    it('drags the dial code along when the country changes', () => {
      component.setCountry('Iraq');

      expect(component.draft().institutionAddress.country).toBe('Iraq');
      // Leaving this at +91 would store a wrong dial code against a real number.
      expect(component.draft().representativeCountryCode).toBe('+964');
    });
  });

  /**
   * The reference form's fields, in the reference's order.
   *
   * Pinned as an exact ordered list rather than a set of presence checks: the
   * brief was the exact fields in the exact order, and a set would pass while a
   * field sat in the wrong place or a removed one crept back.
   */
  /**
   * Same defect the edit modal had: [value] on a <select> is discarded while @for
   * is still building the options, so a default never showed. Country opens on
   * India and the dial code follows it, and both were rendering blank.
   */
  describe('dropdowns show the value the draft holds', () => {

    function select(id: string): HTMLSelectElement {
      return fixture.nativeElement.querySelector(id) as HTMLSelectElement;
    }

    it('opens with Country on India, as the draft does', () => {
      expect(component.draft().institutionAddress.country).toBe('India');
      expect(select('#country').value).toBe('India');
    });

    it('opens with the dial code the draft holds', () => {
      expect(select('.dial-select').value).toBe(component.draft().representativeCountryCode);
    });

    it('follows the Country choice through to both selects', () => {
      component.setCountry('Iraq');
      fixture.detectChanges();

      expect(select('#country').value).toBe('Iraq');
      expect(select('.dial-select').value).toBe('+964');
    });

    it('reflects a chosen Board, Medium, Type and Gender back into the controls', () => {
      component.update('board', 'ICSE');
      component.update('medium', 'HI');
      component.update('typeofSchool', 'Government School');
      component.update('genderType', 'Girls');
      fixture.detectChanges();

      expect(select('#board').value).toBe('ICSE');
      expect(select('#medium').value).toBe('HI');
      expect(select('#typeofSchool').value).toBe('Government School');
      expect(select('#genderType').value).toBe('Girls');
    });
  });

  describe('step one matches the reference form', () => {

    const REFERENCE_LABELS = [
      'Country',
      'Board',
      'School Affiliation Number or UDISE Code',
      'School Name',
      'Medium of Instruction',
      'Type of School',
      'Boys / Girls / Co-ed',
      'School Pincode',
      'Street Name',
      'Locality Name',
      'Landmark',
      'City',
      'Sub District',
      'District',
      'State',
      'School Representative Contact Number',
      'Representative First Name',
      'Representative Last Name',
      'Representative Email'
    ];

    function labels(): string[] {
      return Array.from(
        fixture.nativeElement.querySelectorAll('.modal-body label') as NodeListOf<HTMLElement>
      ).map(el => el.textContent!.replace('*', '').replace(/\s+/g, ' ').trim());
    }

    it('renders exactly the reference fields, in order', () => {
      expect(labels()).toEqual(REFERENCE_LABELS);
    });

    it('does not collect Institution Code or Chain Name', () => {
      // institutionCode is stored and filled from the edit modal instead;
      // chainName no longer exists on the document at all.
      expect(labels()).not.toContain('Institution Code');
      expect(labels()).not.toContain('Chain Name');
      expect(fixture.nativeElement.querySelector('#institutionCode')).toBeNull();
      expect(fixture.nativeElement.querySelector('#chainName')).toBeNull();
    });

    it('gives Boys / Girls / Co-ed a row of its own', () => {
      const gender = fixture.nativeElement.querySelector('#genderType') as HTMLElement;

      // Paired fields sit inside .field-row; this one must not.
      expect(gender.closest('.field-row')).toBeNull();
    });

    it('pairs Medium with Type of School, City with Sub District, District with State', () => {
      for (const [a, b] of [
        ['#medium', '#typeofSchool'],
        ['#city', '#subDistrict'],
        ['#district', '#state']
      ]) {
        const rowA = (fixture.nativeElement.querySelector(a) as HTMLElement).closest('.field-row');
        const rowB = (fixture.nativeElement.querySelector(b) as HTMLElement).closest('.field-row');

        expect(rowA).not.toBeNull();
        expect(rowA).toBe(rowB);
      }
    });
  });

  describe('landmark', () => {

    it('does not block the form, because it is optional', () => {
      fillEverything();

      expect(component.draft().institutionAddress.landmark).toBe('');
      expect(nextButton().disabled).toBe(false);
      expect(component.missingLabels()).toEqual([]);
    });

    it('is carried into the emitted draft when filled', () => {
      fillEverything();
      component.updateAddress('landmark', 'Opposite the bus stand');
      component.save();

      expect(submitted[0].institutionAddress.landmark).toBe('Opposite the bus stand');
    });
  });

  describe('the gated button', () => {

    it('is disabled on an empty form', () => {
      expect(nextButton().disabled).toBe(true);
    });

    it('is still disabled when one single field is missing', () => {
      fillEverything();
      expect(nextButton().disabled).toBe(false);

      // Blank out one field. Any one is enough to close the door again.
      component.update('registrationNumber', '');
      fixture.detectChanges();

      expect(nextButton().disabled).toBe(true);
    });

    it('is disabled when an ADDRESS field is missing', () => {
      fillEverything();
      component.updateAddress('state', '');
      fixture.detectChanges();

      expect(nextButton().disabled).toBe(true);
    });

    it('treats whitespace as empty', () => {
      fillEverything();
      component.update('institutionName', '   ');
      fixture.detectChanges();

      expect(nextButton().disabled).toBe(true);
    });

    it('enables once every field is filled', () => {
      fillEverything();
      expect(nextButton().disabled).toBe(false);
    });
  });

  describe('required fields', () => {

    it('names every outstanding field', () => {
      // Nothing filled, so every required field should be listed. Country is the
      // exception: it opens on India, so it is satisfied from the start.
      expect(component.missingLabels()).not.toContain('Country' as never);
      expect(component.missingLabels()).toContain('Board' as never);
      expect(component.missingLabels()).toContain('State' as never);
      expect(component.missingLabels()).toContain('Representative Email' as never);
    });

    it('lists Country only if it is actually cleared', () => {
      component.updateAddress('country', '');
      expect(component.missingLabels()).toContain('Country' as never);
    });

    it('drops a field from the summary once it is filled', () => {
      expect(component.missingLabels()).toContain('School Name' as never);

      component.update('institutionName', 'Deogiri Global Academy');

      expect(component.missingLabels()).not.toContain('School Name' as never);
    });

    it('lists nothing once the form is complete', () => {
      fillEverything();
      expect(component.missingLabels()).toEqual([]);
    });

    it('shows an error only after the field has been visited', () => {
      // Empty from the start, but untouched: flagging it on open would paint a
      // blank form red before the user has done anything.
      expect(component.isMissing('board')).toBe(false);

      component.markBlurred('board');

      expect(component.isMissing('board')).toBe(true);
    });

    it('clears the error once the field is filled', () => {
      component.markBlurred('institutionName');
      expect(component.isMissing('institutionName')).toBe(true);

      component.update('institutionName', 'Deogiri Global Academy');
      expect(component.isMissing('institutionName')).toBe(false);
    });

    it('marks every label required in the DOM', () => {
      const markers = fixture.nativeElement.querySelectorAll('.req');
      // Eighteen required fields across step one, each carrying its asterisk.
      // Landmark is the one field with no marker, because it is optional.
      expect(markers.length).toBe(18);
      expect(
        fixture.nativeElement.querySelector('label[for="landmark"] .req')
      ).toBeNull();
    });
  });

  describe('saving', () => {

    it('refuses to emit while the form is incomplete', () => {
      component.save();
      expect(submitted).toEqual([]);
    });

    it('emits the draft once complete', () => {
      fillEverything();
      component.save();

      expect(submitted.length).toBe(1);
      expect(submitted[0].institutionName).toBe('Deogiri Global Academy');
      expect(submitted[0].institutionAddress.country).toBe('India');
    });

    it('will not advance past step one while incomplete', () => {
      component.next();
      expect(component.step()).toBe(1);

      fillEverything();
      component.next();
      expect(component.step()).toBe(2);
    });
  });
  /* ---- Progressive unlocking --------------------------------------------- */

  /**
   * Each field is locked until the one above it has a value, so the form is
   * filled top to bottom. Country is pre-filled with India, so Board is the first
   * field the user actually opens.
   */
  it('opens only the first two fields on a fresh form', () => {
    const disabled = (id: string) =>
      (fixture.nativeElement.querySelector('#' + id) as HTMLInputElement).disabled;

    // Country is filled by default, so it and Board are open.
    expect(disabled('country')).toBe(false);
    expect(disabled('board')).toBe(false);

    // Everything after Board is shut. The control IDS are the short ones the
    // template uses; the flow names are the draft keys.
    for (const id of ['registrationNumber', 'institutionName', 'medium', 'typeofSchool',
                      'genderType', 'pincode', 'street', 'village', 'city',
                      'repPhone', 'repEmail']) {
      expect(disabled(id)).toBe(true);
    }
  });

  it('unlocks the next field as each one is filled', () => {
    const disabled = (id: string) =>
      (fixture.nativeElement.querySelector('#' + id) as HTMLInputElement).disabled;

    component.update('board', 'CBSE');
    fixture.detectChanges();
    expect(disabled('registrationNumber')).toBe(false);
    expect(disabled('institutionName')).toBe(true);

    component.update('registrationNumber', 'UDISE-1');
    fixture.detectChanges();
    expect(disabled('institutionName')).toBe(false);
    expect(disabled('medium')).toBe(true);
  });

  it('re-locks the fields below when an earlier one is cleared', () => {
    component.update('board', 'CBSE');
    component.update('registrationNumber', 'UDISE-1');
    fixture.detectChanges();

    expect(component.locked('institutionName')).toBe(false);

    component.update('board', '');
    fixture.detectChanges();

    expect(component.locked('registrationNumber')).toBe(true);
    expect(component.locked('institutionName')).toBe(true);
  });

  /**
   * Landmark is the one optional field on this form, so leaving it empty must not
   * hold City shut.
   */
  it('lets an empty Landmark through to City', () => {
    for (const [key, value] of [
      ['board', 'CBSE'], ['registrationNumber', 'UDISE-1'], ['institutionName', 'Oak'],
      ['medium', 'EN'], ['typeofSchool', 'Private School'], ['genderType', 'Co-ed']
    ] as const) {
      component.update(key, value);
    }
    component.updateAddress('pincode', '560001');
    component.updateAddress('street', 'MG Road');
    component.updateAddress('village', 'Indiranagar');
    fixture.detectChanges();

    expect(component.locked('landmark')).toBe(false);
    expect(component.locked('city')).toBe(false);
    expect((fixture.nativeElement.querySelector('#city') as HTMLInputElement).disabled)
      .toBe(false);
  });

  /** The dial code shares the phone field's lock rather than opening early. */
  it('locks the dial code with the phone number it belongs to', () => {
    const dial = () =>
      (fixture.nativeElement.querySelector('.dial-select') as HTMLSelectElement).disabled;

    expect(dial()).toBe(true);
    expect(component.locked('representativePhoneNumber')).toBe(true);
  });

  it('states the rule once rather than per field', () => {
    const notes = fixture.nativeElement.querySelectorAll('.flow-note');

    expect(notes.length).toBe(1);
    expect(notes[0].textContent).toContain('unlock one at a time');
  });
});

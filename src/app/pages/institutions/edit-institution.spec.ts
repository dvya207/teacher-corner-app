import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Timestamp } from 'firebase/firestore';

import { Institution } from '../../models/teaching.model';
import { EditInstitution } from './edit-institution';

/**
 * Edit Institution — tabs, per-tab saving, and phone normalisation.
 *
 * The component is presentational: it emits a patch and never touches
 * Firestore, so these run with no database and no auth.
 */

const INSTITUTION: Institution = {
  docId: 'inst-1',
  ownerId: 'alice',
  institutionName: 'Deogiri Global Academy',
  board: 'CBSE',
  classroomCounter: 10,
  genderType: 'Co-ed',
  institutionAddress: {
    city: 'Parbhani',
    country: 'India',
    district: 'Parbhani',
    landmark: '',
    pincode: '431401',
    state: 'Maharashtra',
    street: 'Vasmat Road',
    subDistrict: 'Parbhani',
    village: 'Shivaji Nagar'
  },
  institutionCode: '1000789',
  medium: 'EN',
  registrationNumber: '27171000515',
  representativeCountryCode: '+91',
  representativePhoneNumber: '9999900002',
  representativeEmail: 'megha.more2021@gmail.com',
  representativeFirstName: 'Megha',
  representativeLastName: 'Suryawanshi',
  representativeName: 'Megha Suryawanshi',
  teachersRegistered: 0,
  typeofSchool: 'Private School',
  customerSchool: false,
  createdAt: Timestamp.fromDate(new Date('2026-08-07T10:00:00.000Z')),
  creationDate: Timestamp.fromDate(new Date('2026-08-07T10:00:00.000Z')),
  updatedAt: Timestamp.fromDate(new Date('2026-08-07T10:00:00.000Z')),
  active: true,
  verified: false
};

describe('EditInstitution', () => {
  let fixture: ComponentFixture<EditInstitution>;
  let component: EditInstitution;
  let patches: Partial<Institution>[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [EditInstitution] }).compileComponents();

    fixture = TestBed.createComponent(EditInstitution);
    fixture.componentRef.setInput('institution', INSTITUTION);
    component = fixture.componentInstance;

    patches = [];
    component.saved.subscribe(patch => patches.push(patch));

    fixture.detectChanges();
  });

  it('renders exactly the three kept tabs', () => {
    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.edit-tab') as NodeListOf<HTMLElement>
    ).map(el => el.textContent!.trim());

    // Chain, School Onboarding and Programmes were removed; their absence is
    // pinned here so a partial revert cannot put them back unnoticed. Programmes
    // went because they are managed on the Programme page, not per institution.
    expect(labels).toEqual(['Basic Info', 'Address', 'Board']);
    expect(labels).not.toContain('Chain');
    expect(labels).not.toContain('School Onboarding');
    expect(labels).not.toContain('Programmes');
  });

  it('opens on Basic Info with the institution already populated', () => {
    const body = fixture.nativeElement.querySelector('.edit-body');

    expect(component.tab()).toBe('basic');
    expect(body.querySelector('#e-name').value).toBe('Deogiri Global Academy');
    expect(body.querySelector('#e-repFirst').value).toBe('Megha');
    expect(body.querySelector('#e-regNo').value).toBe('27171000515');
    // Institution Code and Chain Name are both off this tab now.
    expect(body.querySelector('#e-code')).toBeNull();
    expect(body.querySelector('#e-chain')).toBeNull();
  });

  it('keeps the dial code and the number in separate fields, as production does', () => {
    // The number input never contains the country code.
    expect(fixture.nativeElement.querySelector('#e-repPhone').value).toBe('9999900002');

    component.update('representativePhoneNumber', '+91 98123-45678');
    component.save();

    expect(patches[0].representativePhoneNumber).toBe('9812345678');
    expect(patches[0].representativeCountryCode).toBe('+91');
    expect(patches[0].representativePhoneNumber).not.toContain('+');
  });

  it('shows the document id read-only, since editing it would mean a new document', () => {
    const input = fixture.nativeElement.querySelector('#e-id') as HTMLInputElement;

    // BLANK value: the id is the placeholder, so the field holds nothing that
    // could be selected or deleted, and it still cannot be edited.
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('inst-1');
    expect(input.readOnly).toBe(true);
  });

  describe('copying the Institution ID', () => {

    function copyButton(): HTMLButtonElement {
      return fixture.nativeElement.querySelector('.control-copy') as HTMLButtonElement;
    }

    /** It was a span with pointer-events:none before — it could not be clicked. */
    it('is a real button, not decoration', () => {
      expect(copyButton()).not.toBeNull();
      expect(copyButton().tagName).toBe('BUTTON');
      expect(copyButton().getAttribute('aria-label')).toBe('Copy institution ID');
    });

    it('writes the document id to the clipboard', async () => {
      const written: string[] = [];
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async (text: string) => { written.push(text); } },
        configurable: true
      });

      await component.copyId();

      expect(written).toEqual(['inst-1']);
      expect(component.copied()).toBe(true);
      expect(component.copyFailed()).toBe(false);
    });

    it('confirms the copy on the button', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        // A stub that resolves and records nothing: the assertion below is about
        // the button label changing, not about what reached the clipboard.
        value: { writeText: async () => undefined },
        configurable: true
      });

      await component.copyId();
      fixture.detectChanges();

      expect(copyButton().getAttribute('aria-label')).toBe('Institution ID copied');
    });

    /**
     * The clipboard rejects outside a secure context. A silent no-op would leave
     * the user with no way to get the id at all, so it is shown to read off.
     */
    it('shows the id to read off when the clipboard is unavailable', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async () => { throw new Error('denied'); } },
        configurable: true
      });

      await component.copyId();
      fixture.detectChanges();

      expect(component.copyFailed()).toBe(true);
      expect(component.copied()).toBe(false);
      expect(fixture.nativeElement.querySelector('.field-note').textContent)
        .toContain('inst-1');
    });
  });

  /**
   * Basic Info's fields, in the reference's order.
   *
   * The grid flows row-wise, so this single ordered list is also the two-column
   * layout: odd entries land in the left column, even ones in the right.
   */
  /**
   * BUG: every dropdown opened on "Select" instead of the stored value.
   *
   * The selects bound [value] on the <select> itself. Angular sets that as a DOM
   * property, and a <select> silently discards a value that matches none of its
   * current options — which is the state it is in while @for is still building
   * the option list. The inputs beside them were fine, so the modal looked
   * populated while every dropdown had quietly reset to its placeholder. Saving
   * from there would have written the placeholder back over real data.
   */
  describe('dropdowns open on the stored value', () => {

    function select(id: string): HTMLSelectElement {
      return fixture.nativeElement.querySelector(id) as HTMLSelectElement;
    }

    it('shows the stored Gender Type, Medium and Type of School', () => {
      expect(select('#e-gender').value).toBe('Co-ed');
      expect(select('#e-medium').value).toBe('EN');
      expect(select('#e-type').value).toBe('Private School');
    });

    it('marks the matching option as selected, not just the select value', () => {
      const chosen = Array.from(select('#e-medium').options).find(o => o.selected);

      expect(chosen?.value).toBe('EN');
      expect(chosen?.textContent?.trim()).toBe('English');
    });

    it('shows the stored Board and Country on the Board tab', () => {
      component.setTab('board');
      fixture.detectChanges();

      expect(select('#b-board').value).toBe('CBSE');
      expect(select('#b-country').value).toBe('India');
    });

    it('shows the stored Customer School state', () => {
      expect(select('#e-customer').value).toBe('No');
    });

    /** An empty stored value must still land on the placeholder. */
    it('falls back to the placeholder when nothing is stored', async () => {
      fixture.componentRef.setInput('institution', { ...INSTITUTION, medium: '', genderType: '' });
      fixture.detectChanges();

      expect(select('#e-medium').value).toBe('');
      expect(select('#e-gender').value).toBe('');
    });
  });

  describe('Basic Info matches the reference', () => {

    const REFERENCE_LABELS = [
      'Institution Name',            // row 1 left
      'Representative First Name',   // row 1 right
      'Gender Types',                // row 2 left
      'Representative Last Name',    // row 2 right
      'Medium of Instruction',       // row 3 left
      'Representative Email',        // row 3 right
      'Type of School',              // row 4 left
      'Representative Phone',        // row 4 right
      'Customer School',             // row 5 left
      'Institution ID',              // row 5 right
      'Registration Number'          // row 6 left, nothing beside it
    ];

    function labels(): string[] {
      return Array.from(
        fixture.nativeElement.querySelectorAll('.edit-body label') as NodeListOf<HTMLElement>
      ).map(el => el.textContent!.replace('*', '').replace(/\s+/g, ' ').trim());
    }

    it('renders exactly the reference fields, in order', () => {
      expect(labels()).toEqual(REFERENCE_LABELS);
    });

    /** Basic Info now matches the reference exactly — nothing added, nothing missing. */
    it('adds no field the reference does not have', () => {
      expect(labels().filter(label => !REFERENCE_LABELS.includes(label))).toEqual([]);
    });

    it('shows neither Chain Name nor Institution Code', () => {
      expect(labels()).not.toContain('Chain Name');
      expect(labels()).not.toContain('Institution Code');
      expect(fixture.nativeElement.querySelector('#e-chain')).toBeNull();
      expect(fixture.nativeElement.querySelector('#e-code')).toBeNull();
    });

    /**
     * The reference puts a symbol at the start of these three controls. They are
     * selects, which had no icon slot before — only the text inputs did.
     */
    it('puts the reference symbol at the start of the three selects', () => {
      const iconFor = (id: string) => {
        const control = (fixture.nativeElement.querySelector(id) as HTMLElement).closest('.control');
        return control?.querySelector('.control-icon app-icon');
      };

      expect(iconFor('#e-gender')).not.toBeNull();
      expect(iconFor('#e-medium')).not.toBeNull();
      expect(iconFor('#e-type')).not.toBeNull();
    });

    it('gives each select room for its symbol, so the value is not overlapped', () => {
      for (const id of ['#e-gender', '#e-medium', '#e-type']) {
        const select = fixture.nativeElement.querySelector(id) as HTMLElement;

        // The icon lives in .control; without the wrapper there is nowhere to put it.
        expect(select.closest('.control')).not.toBeNull();
      }
    });

    it('marks the same fields required as the reference', () => {
      const required = Array.from(
        fixture.nativeElement.querySelectorAll('.edit-body label') as NodeListOf<HTMLElement>
      )
        .filter(el => el.querySelector('.req'))
        .map(el => el.textContent!.replace('*', '').replace(/\s+/g, ' ').trim());

      // Type of School, Customer School and Institution ID carry no asterisk.
      expect(required).toEqual([
        'Institution Name', 'Representative First Name', 'Gender Types',
        'Representative Last Name', 'Medium of Instruction', 'Representative Email',
        'Representative Phone', 'Registration Number'
      ]);
    });

    it('leaves Registration Number in one column rather than spanning both', () => {
      const field = (fixture.nativeElement.querySelector('#e-regNo') as HTMLElement)
        .closest('.field');

      expect(field!.classList.contains('span-2')).toBe(false);
    });
  });

  /**
   * The Address tab's fields, in the reference's order.
   *
   * Row-wise flow again, so odd entries are the left column and even the right:
   * Street | District Name, City Name | State, Village Name | Pincode, then
   * Sub District Name alone.
   */
  describe('Address matches the reference', () => {

    const REFERENCE_LABELS = [
      'Street', 'District Name',
      'City Name', 'State',
      'Village Name', 'Pincode',
      'Sub District Name',
      // Not on the reference. The Add form collects a Landmark, so without this
      // it could be typed once at creation and never corrected.
      'Landmark'
    ];

    function labels(): string[] {
      return Array.from(
        fixture.nativeElement.querySelectorAll('.edit-body label') as NodeListOf<HTMLElement>
      ).map(el => el.textContent!.replace('*', '').replace(/\s+/g, ' ').trim());
    }

    beforeEach(() => {
      component.setTab('address');
      fixture.detectChanges();
    });

    it('renders exactly the reference fields, in order', () => {
      expect(labels()).toEqual(REFERENCE_LABELS);
    });

    it('has no Country control — that lives on the Board tab', () => {
      expect(labels()).not.toContain('Country');
      expect(fixture.nativeElement.querySelector('#a-country')).toBeNull();
    });

    it('marks the same fields required as the reference', () => {
      const required = Array.from(
        fixture.nativeElement.querySelectorAll('.edit-body label') as NodeListOf<HTMLElement>
      )
        .filter(el => el.querySelector('.req'))
        .map(el => el.textContent!.replace('*', '').replace(/\s+/g, ' ').trim());

      // Village Name and Sub District Name carry no asterisk.
      expect(required).toEqual([
        'Street', 'District Name', 'City Name', 'State', 'Pincode'
      ]);
    });

    /**
     * Country is no longer editable here, but it must still survive this tab's
     * save — the whole address map is the unit of change, so dropping the control
     * without carrying the value would blank it.
     */
    it('still saves country through, untouched', () => {
      component.updateAddress('city', 'Mysuru');
      component.save();

      expect(patches[0].institutionAddress!.country)
        .toBe(INSTITUTION.institutionAddress.country);
      expect(patches[0].institutionAddress!.city).toBe('Mysuru');
    });
  });

  describe('Customer School', () => {

    it('shows No, with the red state marker, for a non-customer', () => {
      const select = fixture.nativeElement.querySelector('#e-customer') as HTMLSelectElement;

      expect(select.value).toBe('No');
      expect(select.dataset['state']).toBe('no');
      expect(Array.from(select.options).map(o => o.value)).toEqual(['No', 'Yes']);
    });

    it('stores a boolean, not the Yes / No the select shows', () => {
      component.setCustomerSchool('Yes');
      component.save();

      expect(patches[0].customerSchool).toBe(true);

      component.setCustomerSchool('No');
      component.save();

      expect(patches[1].customerSchool).toBe(false);
    });

    it('flips the state marker to green once it is a customer', () => {
      component.setCustomerSchool('Yes');
      fixture.detectChanges();

      const select = fixture.nativeElement.querySelector('#e-customer') as HTMLSelectElement;

      expect(select.dataset['state']).toBe('yes');
    });
  });

  it('saves ONLY Basic Info fields from the Basic Info tab', () => {
    component.update('institutionName', 'Renamed');
    component.save();

    // customerSchool and institutionCode are in; chainName is gone from the
    // document entirely, because nothing in the UI ever filled it.
    expect(Object.keys(patches[0]).sort()).toEqual([
      'customerSchool', 'genderType', 'institutionName', 'medium',
      'registrationNumber', 'representativeCountryCode', 'representativeEmail',
      'representativeFirstName', 'representativeLastName',
      'representativePhoneNumber', 'typeofSchool'
    ]);
    expect(patches[0]).not.toHaveProperty('institutionAddress');
    expect(patches[0].institutionName).toBe('Renamed');
  });

  it('saves the whole address map as ONE field from the Address tab', () => {
    component.setTab('address');
    component.updateAddress('city', 'Mysuru');
    component.save();

    // A nested map is the unit of change, so the patch is one key, not seven.
    expect(Object.keys(patches[0])).toEqual(['institutionAddress']);
    expect(patches[0].institutionAddress!.city).toBe('Mysuru');
    // Untouched keys inside the map survive.
    expect(patches[0].institutionAddress!.state).toBe('Maharashtra');
    expect(patches[0]).not.toHaveProperty('institutionName');
  });

  /**
   * The Board tab writes `board` and the address map, and nothing else. The map
   * is in scope because Select Country lives on this tab; Basic Info's fields
   * must still be out of reach, which is what the negative assertions pin.
   */
  it('saves board and the address map from the Board tab, and nothing else', () => {
    component.setTab('board');
    component.update('board', 'ICSE');
    component.save();

    expect(Object.keys(patches[0]).sort()).toEqual(['board', 'institutionAddress']);
    expect(patches[0].board).toBe('ICSE');
    expect(patches[0]).not.toHaveProperty('institutionName');
    expect(patches[0]).not.toHaveProperty('representativeEmail');
    expect(patches[0]).not.toHaveProperty('registrationNumber');
  });

  it('offers full board names while storing the short code', () => {
    component.setTab('board');
    fixture.detectChanges();

    const options = Array.from(
      fixture.nativeElement.querySelectorAll('#b-board option') as NodeListOf<HTMLOptionElement>
    );
    const cbse = options.find(o => o.value === 'CBSE');

    expect(cbse!.textContent!.trim()).toBe('Central Board Of Secondary Education');
  });

  /* ---- Save Changes is shut until something is edited ------------------- */

  /**
   * Opening a modal and finding its primary action live invites a write that
   * changes nothing, and makes "did I edit that?" unanswerable from the screen.
   */
  it('opens with Save Changes disabled on every tab', () => {
    for (const tab of ['basic', 'address', 'board'] as const) {
      component.setTab(tab);
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('.save-btn') as HTMLButtonElement;

      expect(button.disabled).toBe(true);
      expect(button.getAttribute('title')).toBe('No changes to save yet');
    }
  });

  it('enables Save Changes as soon as a field on this tab changes', () => {
    component.update('institutionName', 'Deogiri Global Academy 2');
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('.save-btn') as HTMLButtonElement;

    expect(component.dirty()).toBe(true);
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('title')).toBeNull();
  });

  /** Typed and typed back is not an edit: there is nothing left to write. */
  it('disables it again when the value is put back', () => {
    component.update('institutionName', 'Something else');
    expect(component.dirty()).toBe(true);

    component.update('institutionName', INSTITUTION.institutionName);
    fixture.detectChanges();

    expect(component.dirty()).toBe(false);
    expect((fixture.nativeElement.querySelector('.save-btn') as HTMLButtonElement).disabled)
      .toBe(true);
  });

  /**
   * Dirtiness is PER TAB, because each tab saves independently. An edit on
   * Address must not light up a button that would not write it.
   */
  it('keeps the Board tab shut for an edit made on Address', () => {
    component.updateAddress('city', 'Mysuru');

    component.setTab('address');
    expect(component.dirty()).toBe(true);

    component.setTab('basic');
    expect(component.dirty()).toBe(false);
  });

  /**
   * The one deliberate overlap: the Board tab writes the whole address map, so a
   * pending address edit IS a change it would save.
   */
  it('treats an address edit as a change for the Board tab, which writes that map', () => {
    component.updateAddress('city', 'Mysuru');
    component.setTab('board');

    expect(component.dirty()).toBe(true);
  });

  /** Reformatting a number without changing its digits is not an edit. */
  it('ignores phone formatting that normalises back to the stored digits', () => {
    component.update('representativePhoneNumber', '98342-36469');

    expect(component.dirty()).toBe(false);

    component.update('representativePhoneNumber', '9999900003');

    expect(component.dirty()).toBe(true);
  });

  it('offers Cancel beside it, as the classroom modal does', () => {
    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.edit-foot button') as NodeListOf<HTMLElement>
    ).map(el => el.textContent!.trim());

    expect(labels).toEqual(['Cancel', 'Save Changes']);
  });

  it('closes without saving when Cancel is clicked', () => {
    let closed = 0;
    component.closed.subscribe(() => (closed += 1));

    (fixture.nativeElement.querySelector('.btn-ghost') as HTMLButtonElement).click();

    expect(closed).toBe(1);
    expect(patches).toEqual([]);
  });

  it('has no stub pane left to render', () => {
    expect(fixture.nativeElement.querySelector('.tab-stub')).toBeNull();
  });

  it('shows Save Changes on every tab', () => {
    for (const tab of ['basic', 'address', 'board'] as const) {
      component.setTab(tab);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.save-btn')).toBeTruthy();
    }
  });

  /**
   * Select Country on the Board tab is a real control over the same COUNTRIES
   * list the Address tab and the create form use, not a read-only mirror.
   */
  it('offers the full country list on the Board tab and saves the choice', () => {
    component.setTab('board');
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('#b-country') as HTMLSelectElement;
    const values = Array.from(select.options).map(o => o.value);

    expect(select.disabled).toBe(false);
    expect(values).toContain('India');
    expect(values.length).toBeGreaterThan(50);

    component.updateAddress('country', 'Singapore');
    component.save();

    expect(patches[0].institutionAddress!.country).toBe('Singapore');
    // The rest of the address goes back untouched.
    expect(patches[0].institutionAddress!.city).toBe(INSTITUTION.institutionAddress.city);
    expect(patches[0].institutionAddress!.pincode).toBe(INSTITUTION.institutionAddress.pincode);
  });

  it('does not emit twice while a save is already in flight', () => {
    fixture.componentRef.setInput('saving', true);
    fixture.detectChanges();

    component.save();

    expect(patches).toEqual([]);
  });
});

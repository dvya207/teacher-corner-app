import { TestBed } from '@angular/core/testing';

import { GRADES, SECTIONS } from '../data/classroom-options';
import { BOARDS } from '../data/institution-options';
import {
  CONFIGURATION_READER,
  ConfigurationDocuments,
  ConfigurationService
} from './configuration.service';

/**
 * The Configuration collection.
 *
 * TWO PROPERTIES MATTER and both are asserted here:
 *
 *   1. what Firestore holds is what the UI shows — otherwise editing a document in the
 *      console does nothing and the whole exercise is decoration;
 *   2. what the app shipped with is what it falls back to — a refused read, a missing
 *      document or an empty array must never leave a form with an empty select.
 *
 * The read is supplied through CONFIGURATION_READER rather than mocked. Angular's
 * vitest setup rejects vi.mock on relative imports, and mocking 'firebase/firestore'
 * globally breaks every other spec that touches Firestore.
 */

describe('ConfigurationService', () => {
  let documents: ConfigurationDocuments;
  let shouldThrow: boolean;
  let service: ConfigurationService;

  beforeEach(() => {
    documents = new Map();
    shouldThrow = false;

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CONFIGURATION_READER,
          useValue: async () => {
            if (shouldThrow) {
              throw new Error('permission-denied');
            }
            return documents;
          }
        }
      ]
    });

    service = TestBed.inject(ConfigurationService);
  });

  /* ---- Fallbacks ---------------------------------------------------------- */

  it('starts holding the values the app shipped with', () => {
    expect(service.boards()).toEqual(BOARDS);
    expect(service.grades()).toEqual(GRADES);
    expect(service.sections()).toEqual(SECTIONS);
  });

  it('keeps the fallback when the collection is empty', async () => {
    await service.load();

    expect(service.grades()).toEqual(GRADES);
  });

  /** A denied read must degrade to the shipped behaviour, not to empty selects. */
  it('keeps the fallback when the read fails', async () => {
    shouldThrow = true;

    await service.load();

    expect(service.boards()).toEqual(BOARDS);
    expect(service.grades()).toEqual(GRADES);
  });

  /* ---- Firestore wins ----------------------------------------------------- */

  it('shows what Firestore holds, so a console edit reaches the UI', async () => {
    documents.set('GradeList', { docId: 'GradeList', grades: ['11', '12'] });
    documents.set('SectionList', { docId: 'SectionList', sections: ['X', 'Y'] });

    await service.load();

    expect(service.grades()).toEqual(['11', '12']);
    expect(service.sections()).toEqual(['X', 'Y']);
  });

  it('reads each list from the document id and key the contract names', async () => {
    documents.set('BoardListAll', { boards: [{ code: 'NEW', label: 'A new board' }] });
    documents.set('Languages', { langTypes: [{ code: 'FR', label: 'French' }] });
    documents.set('typeofSchools', { typeofSchools: [{ value: 'Charter', short: 'Chr' }] });
    documents.set('ProgrammeAges', { ages: ['1', '2'] });
    documents.set('SchoolGenderTypes', { genderTypes: ['Mixed'] });

    await service.load();

    expect(service.boards()).toEqual([{ code: 'NEW', label: 'A new board' }]);
    expect(service.languages()).toEqual([{ code: 'FR', label: 'French' }]);
    expect(service.schoolTypes()).toEqual([{ value: 'Charter', short: 'Chr' }]);
    expect(service.programmeAges()).toEqual(['1', '2']);
    expect(service.genderTypes()).toEqual(['Mixed']);
  });

  it('derives country names and dial codes from CountryCodes', async () => {
    documents.set('CountryCodes', {
      countryCodes: [
        { iso2: 'IN', name: 'India', dial: '+91' },
        { iso2: 'NP', name: 'Nepal', dial: '+977' }
      ]
    });

    await service.load();

    expect(service.countryNamesSignal()).toEqual(['India', 'Nepal']);
    expect(service.dialFor('Nepal')).toBe('+977');
  });

  /**
   * An empty array is far more likely to be somebody having deleted the values than a
   * genuinely empty vocabulary, and applying it blanks a dropdown for every user.
   */
  it('ignores an empty array rather than blanking a dropdown', async () => {
    documents.set('GradeList', { grades: [] });

    await service.load();

    expect(service.grades()).toEqual(GRADES);
  });

  it('only loads once, however many times it is called', async () => {
    documents.set('GradeList', { grades: ['11'] });
    await service.load();

    documents.set('GradeList', { grades: ['12'] });
    await service.load();

    expect(service.grades()).toEqual(['11']);
  });

  /* ---- Behaviour that used to be hardcoded -------------------------------- */

  it('validates a pincode from the rules rather than an if on India', () => {
    expect(service.isCompletePincode('560001', 'India')).toBe(true);
    expect(service.isCompletePincode('56000', 'India')).toBe(false);
    // A leading zero is rejected by the seeded pattern.
    expect(service.isCompletePincode('060001', 'India')).toBe(false);
    // A country with no rule takes anything non-empty, as the old else-branch did.
    expect(service.isCompletePincode('AB1 2CD', 'Nepal')).toBe(true);
    expect(service.isCompletePincode('', 'Nepal')).toBe(false);
  });

  it('takes a new country rule from Firestore', async () => {
    documents.set('PincodeRules', {
      rules: [
        { country: 'India', pattern: '^[1-9][0-9]{5}$', digits: 6 },
        { country: 'Nepal', pattern: '^[0-9]{5}$', digits: 5 }
      ]
    });

    await service.load();

    expect(service.isCompletePincode('44600', 'Nepal')).toBe(true);
    expect(service.isCompletePincode('4460', 'Nepal')).toBe(false);
    expect(service.pincodeDigits('44600123', 'Nepal')).toBe('44600');
  });

  /** A malformed pattern must not make every pincode invalid. */
  it('survives an invalid pattern in Firestore', async () => {
    documents.set('PincodeRules', { rules: [{ country: 'India', pattern: '([', digits: 6 }] });

    await service.load();

    expect(service.isCompletePincode('560001', 'India')).toBe(true);
  });

  it('resolves a dial code, falling back to the default country', () => {
    expect(service.dialFor('India')).toBe('+91');
    expect(service.dialFor('Nowhere')).toBe('+91');
  });
});

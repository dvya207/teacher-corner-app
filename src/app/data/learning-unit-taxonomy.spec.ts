import {
  LEARNING_UNIT_CODE_PATTERN,
  LEARNING_UNIT_MATURITIES,
  TaxonomyRow,
  compositeCodeFor,
  domainCodesOf,
  learningUnitType,
  learningUnitTypeCode,
  subDomainNamesOf,
  subjectCodesOf,
  taxonomyForCode,
  taxonomyFromUnits
} from './learning-unit-taxonomy';
import { LearningUnit } from '../models/teaching.model';

/**
 * A small table with a deliberate shape: two sub-domains under one domain (P/S
 * and P/L), and one pair reused under a different domain (C/S) so a lookup that
 * matched on only one of the two characters would pass the wrong row back.
 */
const ROWS: TaxonomyRow[] = [
  { subjectCode: 'SC', subjectName: 'Science', domainCode: 'P', domainName: 'Physics', subDomainCode: 'S', subDomainName: 'Sound' },
  { subjectCode: 'SC', subjectName: 'Science', domainCode: 'P', domainName: 'Physics', subDomainCode: 'L', subDomainName: 'Light' },
  { subjectCode: 'SC', subjectName: 'Science', domainCode: 'C', domainName: 'Chemistry', subDomainCode: 'S', subDomainName: 'Solutions' }
];

function unit(fields: Partial<LearningUnit>): LearningUnit {
  return fields as LearningUnit;
}

describe('LEARNING_UNIT_CODE_PATTERN', () => {

  it('accepts two uppercase letters then two digits', () => {
    expect(LEARNING_UNIT_CODE_PATTERN.test('AE04')).toBe(true);
    expect(LEARNING_UNIT_CODE_PATTERN.test('PS07')).toBe(true);
  });

  it('rejects the near misses', () => {
    expect(LEARNING_UNIT_CODE_PATTERN.test('ae04')).toBe(false);  // lowercase
    expect(LEARNING_UNIT_CODE_PATTERN.test('A04')).toBe(false);   // one letter
    expect(LEARNING_UNIT_CODE_PATTERN.test('AE4')).toBe(false);   // one digit
    expect(LEARNING_UNIT_CODE_PATTERN.test('AE045')).toBe(false); // too long
    expect(LEARNING_UNIT_CODE_PATTERN.test('A1B2')).toBe(false);  // interleaved
  });

  /**
   * Anchored at BOTH ends. Production's pattern is unanchored at the start and
   * relies on a maxlength attribute to stop 'XXAE04' — this one does not.
   */
  it('rejects a valid code with a prefix', () => {
    expect(LEARNING_UNIT_CODE_PATTERN.test('XXAE04')).toBe(false);
  });
});

describe('taxonomyForCode', () => {

  it('matches on BOTH letters, not just the domain', () => {
    expect(taxonomyForCode('PS07', ROWS)?.subDomainName).toBe('Sound');
    expect(taxonomyForCode('PL23', ROWS)?.subDomainName).toBe('Light');
    expect(taxonomyForCode('CS01', ROWS)?.domainName).toBe('Chemistry');
  });

  it('uppercases before looking up, as the input does', () => {
    expect(taxonomyForCode('ps07', ROWS)?.subDomainName).toBe('Sound');
  });

  /** The digits are a serial number and play no part in the lookup. */
  it('ignores the digits', () => {
    expect(taxonomyForCode('PS07', ROWS)).toBe(taxonomyForCode('PS99', ROWS));
  });

  it('is null for a well-formed code whose pair is unknown', () => {
    expect(taxonomyForCode('ZZ01', ROWS)).toBeNull();
  });

  it('is null for a malformed code', () => {
    expect(taxonomyForCode('P', ROWS)).toBeNull();
    expect(taxonomyForCode('', ROWS)).toBeNull();
  });
});

describe('compositeCodeFor', () => {

  /**
   * Just the two letters. Production writes
   * `String(domainCode) + String(subDomainCode)` — not the full code, and not a
   * hyphenated join, both of which a reader would reasonably expect.
   */
  it('is the domain code then the sub-domain code', () => {
    expect(compositeCodeFor({ domainCode: 'A', subDomainCode: 'E' })).toBe('AE');
  });
});

describe('taxonomyFromUnits', () => {

  it('folds the vocabulary the stored units carry over the static seed', () => {
    const rows = taxonomyFromUnits([
      unit({
        subjectCode: 'XX',
        subjectName: 'Invented Subject',
        domainCode: 'Q',
        domainName: 'Invented Domain',
        subDomainCode: 'Z',
        subDomainName: 'Invented Sub-Domain'
      })
    ]);

    expect(taxonomyForCode('QZ01', rows)?.domainName).toBe('Invented Domain');
  });

  /**
   * A real document WINS over the seeded row for the same pair. The seed's names
   * are inferred; the data's are authoritative.
   */
  it('lets a stored unit override a seeded pair', () => {
    const rows = taxonomyFromUnits([
      unit({
        subjectCode: 'SC',
        subjectName: 'Science',
        domainCode: 'P',
        domainName: 'Physical Sciences',
        subDomainCode: 'S',
        subDomainName: 'Acoustics'
      })
    ]);

    expect(taxonomyForCode('PS07', rows)?.subDomainName).toBe('Acoustics');
  });

  /** A half-filled pair cannot be looked up, so it is skipped entirely. */
  it('skips units missing either half of the pair', () => {
    const rows = taxonomyFromUnits([
      unit({ domainCode: 'Q', subDomainCode: '', domainName: 'Half' }),
      unit({ domainCode: '', subDomainCode: 'Z', domainName: 'Other Half' })
    ]);

    expect(rows.some(row => row.domainName === 'Half')).toBe(false);
    expect(rows.some(row => row.domainName === 'Other Half')).toBe(false);
  });

  it('keeps the seeded rows when there are no units', () => {
    expect(taxonomyForCode('PS07', taxonomyFromUnits([]))).not.toBeNull();
  });
});

describe('picker vocabularies', () => {

  it('are distinct and sorted', () => {
    expect(subjectCodesOf(ROWS)).toEqual(['SC']);
    expect(domainCodesOf(ROWS)).toEqual(['C', 'P']);
  });

  /**
   * Sub-domain names narrow to the selected code, as production narrows them —
   * S is used by both Physics and Chemistry here, so an unfiltered list would
   * offer Solutions while the user was categorising a Physics unit.
   */
  it('narrow sub-domain names to the chosen sub-domain code', () => {
    expect(subDomainNamesOf(ROWS, 'L')).toEqual(['Light']);
    expect(subDomainNamesOf(ROWS, 'S')).toEqual(['Solutions', 'Sound']);
  });

  it('offer every name when no code is chosen', () => {
    expect(subDomainNamesOf(ROWS, '')).toEqual(['Light', 'Solutions', 'Sound']);
  });
});

describe('learning unit types', () => {

  it('resolve a name to its code', () => {
    expect(learningUnitTypeCode('TACtivity')).toBe('TA');
  });

  it('are empty rather than undefined for an unknown name', () => {
    expect(learningUnitType('Nonsense')).toBeNull();
    expect(learningUnitTypeCode('Nonsense')).toBe('');
  });
});

describe('LEARNING_UNIT_MATURITIES', () => {

  /**
   * These four, in this order. Not read from Configuration — production
   * hardcodes them as `defaultMaturities`, so this list is the contract.
   */
  it('are production\'s four, in production\'s order', () => {
    expect([...LEARNING_UNIT_MATURITIES]).toEqual(['Gold', 'Silver', 'Diamond', 'Platinum']);
  });
});

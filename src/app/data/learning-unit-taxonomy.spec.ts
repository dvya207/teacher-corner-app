import { LEARNING_UNIT_RESOURCE_SCHEMA } from './learning-unit-resource-schema';
import {
  LEARNING_UNIT_CODE_PATTERN,
  LEARNING_UNIT_MATURITIES,
  LEARNING_UNIT_MATURITY_LADDER,
  LEARNING_UNIT_TYPES,
  TaxonomyRow,
  compositeCodeFor,
  cumulativeMaturityFor,
  domainCodesOf,
  learningUnitType,
  learningUnitTypeCode,
  subDomainNamesOf,
  orderedMaturities,
  resourceSchemaKeyOf,
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

  /** All thirteen production defines, alphabetical by code. */
  it('are production\'s thirteen', () => {
    expect(LEARNING_UNIT_TYPES.map(entry => entry.code)).toEqual([
      'CB', 'FL', 'FV', 'GA', 'GR', 'KH', 'ME', 'MI', 'MU', 'RT', 'TA', 'TQ', 'TT'
    ]);
  });

  /**
   * THE REGRESSION THESE EXIST FOR.
   *
   * Three of the four provisional entries were wrong, and 'Tool TAC' was wrong in the
   * dangerous way: it claimed code TT, which production assigns to Toys and Tales. A
   * unit created as a Tool TAC minted a valid-looking 'TT-…' learningUnitId that every
   * other reader resolves as a different type.
   */
  it('assign TT to Toys and Tales, not to a Tool TAC', () => {
    expect(learningUnitTypeCode('Toys and Tales')).toBe('TT');
    expect(learningUnitType('Tool TAC')).toBeNull();
  });

  it('have no TP, and spell MuT with a lowercase u', () => {
    expect(LEARNING_UNIT_TYPES.map(entry => entry.code)).not.toContain('TP');
    expect(learningUnitTypeCode('MuT')).toBe('MU');
    expect(learningUnitType('MUT')).toBeNull();
  });

  it('have a unique code per type, and a unique name', () => {
    const codes = LEARNING_UNIT_TYPES.map(entry => entry.code);
    const names = LEARNING_UNIT_TYPES.map(entry => entry.name);

    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(names).size).toBe(names.length);
  });

  /** Every code is two uppercase letters, as the id's first segment requires. */
  it('use two-letter uppercase codes', () => {
    for (const entry of LEARNING_UNIT_TYPES) {
      expect(entry.code).toMatch(/^[A-Z]{2}$/);
    }
  });
});

describe('resourceSchemaKeyOf', () => {

  /**
   * The learning unit stores `type` with its spaces; the resource schema is keyed
   * without them. This is the whole of that conversion.
   */
  it('strips spaces from a type name', () => {
    expect(resourceSchemaKeyOf('Toys and Tales')).toBe('ToysandTales');
    expect(resourceSchemaKeyOf('Keep @ Home')).toBe('Keep@Home');
    expect(resourceSchemaKeyOf('Micro Improvement Programme'))
      .toBe('MicroImprovementProgramme');
    expect(resourceSchemaKeyOf('CBE Theme')).toBe('CBETheme');
    expect(resourceSchemaKeyOf('TACtivity')).toBe('TACtivity');
  });

  it('is safe on nothing', () => {
    expect(resourceSchemaKeyOf('')).toBe('');
    expect(resourceSchemaKeyOf(undefined as unknown as string)).toBe('');
  });

  /**
   * THE CROSS-CHECK BETWEEN TWO SEEDED DOCUMENTS.
   *
   * Nine of the thirteen types have an entry in learningUnitResourceSchema; the other
   * four get no upload slots at all. Asserting the split both ways catches a type
   * renamed in one document and not the other — which would silently give a whole type
   * no resources.
   */
  it('maps exactly nine types onto the resource schema', () => {
    const keys = Object.keys(LEARNING_UNIT_RESOURCE_SCHEMA);

    const withSchema = LEARNING_UNIT_TYPES
      .filter(entry => keys.includes(resourceSchemaKeyOf(entry.name)))
      .map(entry => entry.code);

    expect(withSchema).toEqual(['CB', 'FL', 'GR', 'KH', 'MI', 'MU', 'RT', 'TA', 'TT']);

    const without = LEARNING_UNIT_TYPES
      .filter(entry => !keys.includes(resourceSchemaKeyOf(entry.name)))
      .map(entry => entry.name);

    expect(without).toEqual(['Field Visits', 'Online Games', 'Museum Exhibit', 'TACQuotient']);
  });

  /** No schema key is orphaned — every one is reachable from a declared type. */
  it('leaves no resource schema key without a type', () => {
    const reachable = new Set(LEARNING_UNIT_TYPES.map(e => resourceSchemaKeyOf(e.name)));

    for (const key of Object.keys(LEARNING_UNIT_RESOURCE_SCHEMA)) {
      expect(reachable.has(key)).toBe(true);
    }
  });
});

describe('LEARNING_UNIT_MATURITIES', () => {

  /**
   * RANK ORDER, lowest first.
   *
   * This test asserted ['Gold', 'Silver', 'Diamond', 'Platinum'] and described it as
   * production's, on the strength of a comment claiming the four were hardcoded in
   * production's component as `defaultMaturities`. Both were wrong: they live in
   * Configuration/learningUnitMaturity, and that document's ladder puts Silver below
   * Gold. The old expectation would have shown Gold above Silver in the dropdown.
   */
  it('are the four levels in rank order, lowest first', () => {
    expect([...LEARNING_UNIT_MATURITIES]).toEqual(['Silver', 'Gold', 'Platinum', 'Diamond']);
  });

  /**
   * The names are DERIVED from the ladder, so they cannot drift from it — which is
   * exactly how the previous hand-written order came to disagree with the data.
   */
  it('are exactly the ladder\'s levels, in the ladder\'s order', () => {
    expect([...LEARNING_UNIT_MATURITIES])
      .toEqual(LEARNING_UNIT_MATURITY_LADDER.map(entry => entry.level));
  });
});

describe('LEARNING_UNIT_MATURITY_LADDER', () => {

  /**
   * The cumulative ladder is the point of the document: a maturity names itself AND
   * every level beneath it, which is what decides how many resource documents get
   * created. Silver expands to one, diamond to four.
   */
  it('expands each level to itself and everything below, highest first', () => {
    expect(cumulativeMaturityFor('Silver')).toEqual(['Silver']);
    expect(cumulativeMaturityFor('Gold')).toEqual(['Gold', 'Silver']);
    expect(cumulativeMaturityFor('Platinum')).toEqual(['Platinum', 'Gold', 'Silver']);
    expect(cumulativeMaturityFor('Diamond'))
      .toEqual(['Diamond', 'Platinum', 'Gold', 'Silver']);
  });

  /** A unit stores 'Gold'; the document is keyed 'gold'. The lookup bridges that. */
  it('matches a level name case-insensitively', () => {
    expect(cumulativeMaturityFor('gold')).toEqual(['Gold', 'Silver']);
    expect(cumulativeMaturityFor('  DIAMOND  ')).toEqual(
      ['Diamond', 'Platinum', 'Gold', 'Silver']
    );
  });

  /** Empty rather than undefined, so a caller can spread it without a guard. */
  it('is empty for an unknown level', () => {
    expect(cumulativeMaturityFor('Bronze')).toEqual([]);
    expect(cumulativeMaturityFor('')).toEqual([]);
  });

  /** Only silver is upgradeable in production. Everything else is terminal. */
  it('marks only Silver upgradeable', () => {
    const upgradeable = LEARNING_UNIT_MATURITY_LADDER
      .filter(entry => entry.upgradeable)
      .map(entry => entry.level);

    expect(upgradeable).toEqual(['Silver']);
  });

  /** Rank IS the ladder length — there is no stored rank field to sort on. */
  it('sorts by ladder length, whatever order it is given in', () => {
    const shuffled = [...LEARNING_UNIT_MATURITY_LADDER].reverse();

    expect(orderedMaturities(shuffled).map(entry => entry.level))
      .toEqual(['Silver', 'Gold', 'Platinum', 'Diamond']);
  });
});

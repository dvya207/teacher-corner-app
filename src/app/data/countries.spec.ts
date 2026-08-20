import { COUNTRIES, COUNTRY_NAMES, DEFAULT_COUNTRY, DEFAULT_DIAL, DIAL_CODES, dialFor, flagOf } from './countries';

/**
 * The country list is 200-odd hand-entered rows, which is exactly the kind of
 * data where a duplicate or a missing '+' hides in plain sight. These assert the
 * invariants rather than the contents: nobody should have to re-read the table.
 */
describe('countries', () => {

  it('covers the world, not a handful of countries', () => {
    // A real list of sovereign states plus common territories. Well under this
    // and something has been dropped; this is the check that would have failed
    // against the previous single-entry ['India'].
    expect(COUNTRIES.length).toBeGreaterThan(190);
  });

  it('has no duplicate ISO codes', () => {
    const codes = COUNTRIES.map(country => country.iso2);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('has no duplicate names', () => {
    expect(new Set(COUNTRY_NAMES).size).toBe(COUNTRY_NAMES.length);
  });

  it('gives every country a well-formed ISO code and dial code', () => {
    for (const country of COUNTRIES) {
      expect(country.iso2).toMatch(/^[A-Z]{2}$/);
      expect(country.dial).toMatch(/^\+\d{1,4}$/);
      expect(country.name.trim()).toBe(country.name);
      expect(country.name).not.toBe('');
    }
  });

  it('is sorted by name, which is the order both selects render in', () => {
    const sorted = [...COUNTRY_NAMES].sort((left, right) => left.localeCompare(right));
    expect(COUNTRY_NAMES).toEqual(sorted);
  });

  it('defaults to India, as the reference form does', () => {
    expect(DEFAULT_COUNTRY).toBe('India');
    expect(DEFAULT_DIAL).toBe('+91');
    expect(COUNTRY_NAMES).toContain('India');
  });

  it('resolves a dial code from a country name', () => {
    expect(dialFor('India')).toBe('+91');
    expect(dialFor('Iraq')).toBe('+964');
    expect(dialFor('United States')).toBe('+1');
  });

  it('falls back to India rather than returning undefined for an unknown name', () => {
    // A stored country from an older document must not blank the phone prefix.
    expect(dialFor('Atlantis')).toBe('+91');
    expect(dialFor('')).toBe('+91');
  });

  it('derives flags from the ISO code', () => {
    expect(flagOf('IN')).toBe('🇮🇳');
    expect(flagOf('GB')).toBe('🇬🇧');
    expect(flagOf('us')).toBe('🇺🇸');
  });

  describe('dial codes', () => {

    it('lists each distinct code exactly once', () => {
      const codes = DIAL_CODES.map(dial => dial.code);
      expect(new Set(codes).size).toBe(codes.length);
    });

    it('names a shared code after its primary country', () => {
      // +44 is also Guernsey, the Isle of Man and Jersey. Without the primary
      // set it would be labelled "Guernsey", purely because G sorts before U.
      expect(DIAL_CODES.find(dial => dial.code === '+44')?.label).toBe('United Kingdom');
      // +1 is also Canada; +7 is also Kazakhstan.
      expect(DIAL_CODES.find(dial => dial.code === '+1')?.label).toBe('United States');
      expect(DIAL_CODES.find(dial => dial.code === '+7')?.label).toBe('Russia');
    });

    it('carries a flag for every entry', () => {
      for (const dial of DIAL_CODES) {
        expect(dial.flag).not.toBe('');
        expect(dial.label).not.toBe('');
      }
    });

    it('offers India, so the default is selectable', () => {
      expect(DIAL_CODES.some(dial => dial.code === '+91')).toBe(true);
    });
  });
});

import {
  FIRST_PROGRAMME_NUMBER,
  emptyProgrammeDraft,
  expandRange,
  formatProgrammeCode,
  highestProgrammeNumber,
  incrementProgrammeCode,
  isActiveStatus,
  programmeCodeNumber,
  rangeLabel,
  scopeOf,
  statusLabel
} from './programme-options';
import { Programme } from '../models/teaching.model';

function programme(fields: Partial<Programme>): Programme {
  return { programmeCode: '', grades: [], age: [], ...fields } as Programme;
}

/**
 * Production data contains BOTH 'LIVE' and 'ACTIVE', in mixed case. Testing only
 * for 'LIVE' would file real live programmes under Draft, which is what
 * production's own `isActive` guards against.
 */
describe('isActiveStatus', () => {

  it('accepts both spellings production uses, in any case', () => {
    expect(isActiveStatus('LIVE')).toBe(true);
    expect(isActiveStatus('live')).toBe(true);
    expect(isActiveStatus('ACTIVE')).toBe(true);
    expect(isActiveStatus('Active')).toBe(true);
  });

  it('treats development as a draft', () => {
    expect(isActiveStatus('DEVELOPEMENT')).toBe(false);
  });

  /**
   * The safe direction to be wrong in: an unrecognised programme shows up under
   * Draft rather than vanishing from both filters.
   */
  it('treats an unknown or missing status as a draft', () => {
    expect(isActiveStatus('SOMETHING-ELSE')).toBe(false);
    expect(isActiveStatus('')).toBe(false);
    expect(isActiveStatus(undefined)).toBe(false);
    expect(isActiveStatus(null)).toBe(false);
  });
});

describe('statusLabel', () => {

  /**
   * The stored value keeps production's misspelling; only the label is spelled
   * correctly, because nothing compares against display text.
   */
  it('renders the misspelled stored value correctly', () => {
    expect(statusLabel('DEVELOPEMENT')).toBe('In development');
    expect(statusLabel('LIVE')).toBe('Live');
  });

  it('passes an unknown status straight through rather than blanking it', () => {
    expect(statusLabel('ARCHIVED')).toBe('ARCHIVED');
  });
});

/**
 * A range is STORED EXPANDED — production's `getAllclsInArray`. Storing the
 * expansion is what lets the classroom picker ask a flat `grades.includes()`
 * question instead of parsing a range at every call site.
 */
describe('expandRange', () => {

  it('fills in every value between the endpoints', () => {
    expect(expandRange('4', '6')).toEqual(['4', '5', '6']);
  });

  it('returns a single value when the endpoints match', () => {
    expect(expandRange('8', '8')).toEqual(['8']);
  });

  it('does not run backwards when the endpoints are inverted', () => {
    expect(expandRange('6', '4')).toEqual(['6']);
  });

  it('treats a missing upper bound as a single value', () => {
    expect(expandRange('6', '')).toEqual(['6']);
  });

  /** The pre-primary years are not numbers and cannot form a range. */
  it('returns a non-numeric value as itself', () => {
    expect(expandRange('Pre-primary 2', 'Pre-primary 3')).toEqual(['Pre-primary 2']);
  });

  it('is empty for no lower bound at all', () => {
    expect(expandRange('', '')).toEqual([]);
  });
});

describe('rangeLabel', () => {

  it('shows first and last with a dash, never the values between', () => {
    expect(rangeLabel(['4', '5', '6'])).toBe('4 - 6');
  });

  it('shows a single value alone', () => {
    expect(rangeLabel(['8'])).toBe('8');
  });

  it('is empty for nothing stored', () => {
    expect(rangeLabel([])).toBe('');
    expect(rangeLabel(undefined)).toBe('');
    expect(rangeLabel(null)).toBe('');
  });
});

describe('scopeOf', () => {

  it('reports grade when grades are set', () => {
    expect(scopeOf({ grades: ['8'], age: [] })).toBe('grade');
  });

  it('reports age when only an age band is set', () => {
    expect(scopeOf({ grades: [], age: ['10', '11'] })).toBe('age');
  });

  /** Grade wins if a bad row somehow carries both. */
  it('prefers grade when both are set', () => {
    expect(scopeOf({ grades: ['8'], age: ['10'] })).toBe('grade');
  });

  it('defaults to grade when neither is set', () => {
    expect(scopeOf({ grades: [], age: [] })).toBe('grade');
  });
});

/**
 * The code sequence. Production's codes look like P11697, and the numbering is
 * the one field whose entire purpose is being distinct — so these cover the
 * parsing, the formatting, and the carry.
 */
describe('programmeCodeNumber', () => {

  it('reads the numeric tail past the prefix', () => {
    expect(programmeCodeNumber('P11697')).toBe(11697);
  });

  it('reads a bare number', () => {
    expect(programmeCodeNumber('42')).toBe(42);
  });

  /** A row imported from elsewhere may carry any convention. */
  it('tolerates a different prefix', () => {
    expect(programmeCodeNumber('PROG-00123')).toBe(123);
  });

  it('is null when there is no number at all', () => {
    expect(programmeCodeNumber('')).toBe(null);
    expect(programmeCodeNumber(undefined)).toBe(null);
    expect(programmeCodeNumber(null)).toBe(null);
    expect(programmeCodeNumber('none')).toBe(null);
  });
});

describe('formatProgrammeCode', () => {

  it('pads to production\'s five digits', () => {
    expect(formatProgrammeCode(1)).toBe('P00001');
    expect(formatProgrammeCode(11697)).toBe('P11697');
  });

  /** Truncating would produce a duplicate of an earlier code. */
  it('does not truncate a number that has outgrown the width', () => {
    expect(formatProgrammeCode(123456)).toBe('P123456');
  });
});

describe('incrementProgrammeCode', () => {

  it('adds one', () => {
    expect(incrementProgrammeCode('P11697')).toBe('P11698');
  });

  /**
   * The carry is where production's `addOne` gets strange — it walks the string
   * backwards and does something undefined on the leading letter. Splitting the
   * prefix off first gives the same answer for every real input.
   */
  it('carries across a row of nines', () => {
    expect(incrementProgrammeCode('P10999')).toBe('P11000');
    expect(incrementProgrammeCode('P99999')).toBe('P100000');
  });

  it('starts the sequence when there is nothing to increment', () => {
    expect(incrementProgrammeCode('')).toBe(formatProgrammeCode(FIRST_PROGRAMME_NUMBER));
  });
});

describe('highestProgrammeNumber', () => {

  /**
   * The floor the counter is seeded from. Without it, a teacher whose catalogue
   * was imported — codes but no counter — would start allocating from the bottom
   * and hand out codes that already exist.
   */
  it('finds the highest code in a catalogue', () => {
    const programmes = [
      programme({ programmeCode: 'P11697' }),
      programme({ programmeCode: 'P11700' }),
      programme({ programmeCode: 'P11699' })
    ];

    expect(highestProgrammeNumber(programmes)).toBe(11700);
  });

  it('ignores programmes with no usable code', () => {
    const programmes = [
      programme({ programmeCode: '' }),
      programme({ programmeCode: 'none' }),
      programme({ programmeCode: 'P10005' })
    ];

    expect(highestProgrammeNumber(programmes)).toBe(10005);
  });

  it('is one below the first number for an empty catalogue', () => {
    expect(highestProgrammeNumber([])).toBe(FIRST_PROGRAMME_NUMBER - 1);
  });
});

describe('emptyProgrammeDraft', () => {

  /**
   * LIVE by default, because it is the only status the classroom pickers offer —
   * a form that defaults to a state where its own output cannot be used is a
   * trap.
   */
  it('starts LIVE and REGULAR, with both scopes empty', () => {
    const draft = emptyProgrammeDraft();

    expect(draft.programmeStatus).toBe('LIVE');
    expect(draft.type).toBe('REGULAR');
    expect(draft.grades).toEqual([]);
    expect(draft.age).toEqual([]);
  });

  /** Written empty rather than omitted, so the shape matches production's. */
  it('carries the fields this app cannot fill yet, as empties', () => {
    const draft = emptyProgrammeDraft();

    expect(draft.programmeImagePath).toBe('');
    expect(draft.learningUnitsIds).toEqual([]);
    expect(draft.assignmentIds).toEqual([]);
  });
});

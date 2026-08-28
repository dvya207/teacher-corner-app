import { gradeKey } from './board-grade-resource.service';

/**
 * gradeKey — the map from a grade in the vocabulary to a key on a document.
 *
 * WHY THIS EXISTS. The board-and-grade grid draws one column per grade and can
 * only file into a column that has a key, so this function decides which grades
 * are reachable at all. It returned '' for the three pre-primary years, and the
 * grid silently dropped those columns — a grade a school teaches that nothing
 * could be uploaded against, with no error anywhere to say so.
 */
describe('gradeKey', () => {

  it('zero-pads a numbered grade, which is production\'s format', () => {
    expect(gradeKey('1')).toBe('grade_01');
    expect(gradeKey('3')).toBe('grade_03');
    expect(gradeKey('9')).toBe('grade_09');
    expect(gradeKey('10')).toBe('grade_10');
  });

  /* The regression: 9 and 10 are two digits and must not be mangled by the pad. */
  it('leaves a two-digit grade at two digits', () => {
    expect(gradeKey('10')).toBe('grade_10');
    expect(gradeKey('12')).toBe('grade_12');
  });

  /* The three that had no column. Same `grade_` prefix, so one prefix still
     finds every key on a document. */
  it('mints a key for each pre-primary year', () => {
    expect(gradeKey('Pre-primary 1')).toBe('grade_preprimary_1');
    expect(gradeKey('Pre-primary 2')).toBe('grade_preprimary_2');
    expect(gradeKey('Pre-primary 3')).toBe('grade_preprimary_3');
  });

  it('accepts the spelling variants the vocabulary might hold', () => {
    expect(gradeKey('pre primary 2')).toBe('grade_preprimary_2');
    expect(gradeKey('Pre-Primary 2')).toBe('grade_preprimary_2');
    expect(gradeKey('  Pre-primary 2  ')).toBe('grade_preprimary_2');
  });

  /* Still '' for junk, so a bad value is skipped rather than given a column. */
  it('yields nothing for a value that is not a grade', () => {
    expect(gradeKey('')).toBe('');
    expect(gradeKey('Nursery')).toBe('');
    expect(gradeKey('Grade')).toBe('');
    expect(gradeKey(undefined as unknown as string)).toBe('');
  });

  it('never collides two different grades onto one key', () => {
    const vocabulary = [
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
      'Pre-primary 1', 'Pre-primary 2', 'Pre-primary 3'
    ];
    const keys = vocabulary.map(gradeKey);

    expect(keys.every(key => key !== '')).toBe(true);
    expect(new Set(keys).size).toBe(vocabulary.length);
  });
});

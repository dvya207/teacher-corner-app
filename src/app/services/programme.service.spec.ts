import {
  academicYearLabel,
  classesAreStale,
  classesWithRenamed,
  normaliseProgramme,
  programmesFor,
  stripTrashMetadata,
  suggestedProgrammeName
} from './programme.service';
import { Programme, TeacherClass } from '../models/teaching.model';

function programme(fields: Partial<Programme>): Programme {
  return {
    docId: 'p1',
    programmeId: 'p1',
    programmeName: 'Science',
    programmeCode: 'P10001',
    displayName: 'Science',
    programmeDescription: '',
    institutionId: 'inst-1',
    institutionName: 'Oak School',
    grades: ['8'],
    age: [],
    type: 'REGULAR',
    programmeStatus: 'LIVE',
    programmeImagePath: '',
    learningUnitsIds: [],
    assignmentIds: [],
    ...fields
  } as Programme;
}

/**
 * The picker's whole behaviour lives in this filter. Get it wrong and the list
 * comes back empty, which the UI can only render as "no programmes available" —
 * indistinguishable from there genuinely being none. That is why it is a pure
 * function tested directly rather than a method reached through a component.
 */
describe('programmesFor', () => {

  const options = { institutionId: 'inst-1', type: 'REGULAR' as const, grade: '8' };

  it('offers a live programme for the right school, type and grade', () => {
    expect(programmesFor([programme({})], options).length).toBe(1);
  });

  it('drops anything not LIVE', () => {
    expect(programmesFor([programme({ programmeStatus: 'DEVELOPEMENT' })], options).length).toBe(0);

    // A status this app has never heard of — a row imported from somewhere with
    // its own vocabulary. The picker must not offer it either.
    const unknown = programme({});
    (unknown as { programmeStatus: string }).programmeStatus = 'ARCHIVED';
    expect(programmesFor([unknown], options).length).toBe(0);
  });

  it('drops another school\'s programme', () => {
    expect(programmesFor([programme({ institutionId: 'inst-2' })], options).length).toBe(0);
  });

  it('drops a programme of the wrong type', () => {
    expect(programmesFor([programme({ type: 'STEM-CLUB' })], options).length).toBe(0);
  });

  it('drops a programme that does not cover this grade', () => {
    expect(programmesFor([programme({ grades: ['9', '10'] })], options).length).toBe(0);
  });

  /**
   * A programme created without grades would otherwise be invisible everywhere,
   * with nothing in the UI to explain why. Treating an empty list as "any
   * grade" is the reading that cannot strand data.
   */
  it('treats an empty grades list as applying to every grade', () => {
    expect(programmesFor([programme({ grades: [] })], options).length).toBe(1);
  });

  /**
   * A club is not grade-scoped. Applying the grade filter to one would drop
   * every club programme, since none of them carry grades.
   */
  it('skips the grade filter entirely for a STEM club', () => {
    const club = programme({ type: 'STEM-CLUB', grades: [] });
    const chosen = programmesFor([club], {
      institutionId: 'inst-1',
      type: 'STEM-CLUB',
      grade: '8'
    });

    expect(chosen.length).toBe(1);
  });

  it('skips the grade filter when no grade has been chosen yet', () => {
    const chosen = programmesFor([programme({ grades: ['9'] })], {
      institutionId: 'inst-1',
      type: 'REGULAR'
    });

    expect(chosen.length).toBe(1);
  });
});

describe('normaliseProgramme', () => {

  /**
   * Production stores numeric grades as numbers, so an imported row arrives as
   * [8] where every comparison in this app expects '8'. Without the coercion
   * the grade filter above silently matches nothing.
   */
  it('coerces numeric grades to strings', () => {
    const result = normaliseProgramme('p1', { programmeName: 'Maths', grades: [8, 9] });

    expect(result.grades).toEqual(['8', '9']);
  });

  it('defaults displayName to the programme name', () => {
    expect(normaliseProgramme('p1', { programmeName: 'Maths' }).displayName).toBe('Maths');
  });

  it('keeps an explicit displayName', () => {
    const result = normaliseProgramme('p1', { programmeName: 'Maths', displayName: 'Maths 8' });

    expect(result.displayName).toBe('Maths 8');
  });

  it('falls back to the programme name for a blank displayName', () => {
    const result = normaliseProgramme('p1', { programmeName: 'Maths', displayName: '   ' });

    expect(result.displayName).toBe('Maths');
  });

  /**
   * Every field must come back defined. An undefined reaching a later write is
   * rejected by Firestore outright, which fails the whole document rather than
   * the one key.
   */
  it('fills every field a stored document may predate', () => {
    const result = normaliseProgramme('p1', {});

    expect(result.programmeId).toBe('p1');
    expect(result.programmeName).toBe('');
    expect(result.programmeCode).toBe('');
    expect(result.programmeDescription).toBe('');
    expect(result.institutionId).toBe('');
    expect(result.grades).toEqual([]);
    expect(result.age).toEqual([]);
    expect(result.type).toBe('REGULAR');
    expect(result.programmeStatus).toBe('LIVE');
    expect(result.programmeImagePath).toBe('');
    expect(result.learningUnitsIds).toEqual([]);
    expect(result.assignmentIds).toEqual([]);
  });

  /**
   * Production writes `age: ''` when a programme is grade-scoped rather than
   * omitting it or writing []. A bare `?? []` would leave a STRING where the
   * interface promises an array, and `.length` on it then reports the character
   * count — which would make scopeOf() call a grade-scoped programme
   * age-scoped.
   */
  it('turns production\'s empty-string age into a real empty array', () => {
    const result = normaliseProgramme('p1', { grades: [8], age: '' });

    expect(result.age).toEqual([]);
    expect(result.grades).toEqual(['8']);
  });

  it('coerces a numeric age band to strings', () => {
    expect(normaliseProgramme('p1', { age: [10, 11] }).age).toEqual(['10', '11']);
  });
});

describe('stripTrashMetadata', () => {

  it('removes trashAt so a restored programme is what was deleted', () => {
    const restored = stripTrashMetadata({
      docId: 'p1',
      programmeName: 'Science',
      trashAt: 'a timestamp'
    });

    expect('trashAt' in restored).toBe(false);
    expect(restored['programmeName']).toBe('Science');
  });

  it('does not mutate the object it was given', () => {
    const trashed = { docId: 'p1', trashAt: 'a timestamp' };

    stripTrashMetadata(trashed);

    expect('trashAt' in trashed).toBe(true);
  });
});

describe('academicYearLabel', () => {

  /** The Indian academic year opens in April. */
  it('uses the year that started in April for a month after it', () => {
    expect(academicYearLabel(new Date('2026-08-17'))).toBe('26-27');
    expect(academicYearLabel(new Date('2026-04-01'))).toBe('26-27');
  });

  it('still reports the previous April\'s year in January to March', () => {
    expect(academicYearLabel(new Date('2027-02-10'))).toBe('26-27');
    expect(academicYearLabel(new Date('2027-03-31'))).toBe('26-27');
  });

  it('pads a single-digit year', () => {
    expect(academicYearLabel(new Date('2009-06-01'))).toBe('09-10');
  });
});

describe('suggestedProgrammeName', () => {

  it('matches the shape production generates', () => {
    const name = suggestedProgrammeName('Oak School', '8', 'Maths');

    expect(name).toContain('Oak School');
    expect(name).toContain('Grade 8');
    expect(name).toContain('Maths');
  });

  it('leaves out the grade for something not grade-scoped', () => {
    expect(suggestedProgrammeName('Oak School', '', 'Robotics')).not.toContain('Grade');
  });
});

/**
 * RENAME PROPAGATION — the array half.
 *
 * The classroom half is a dotted-path write and cannot be exercised without a
 * Firestore double, which this project's vitest setup does not allow (see
 * configuration.service.spec.ts). The rows logic is the part with a real trap in
 * it, so it is pulled out and tested directly.
 */
describe('rename propagation across teacher class rows', () => {
  function row(fields: Partial<TeacherClass>): TeacherClass {
    return { grade: '1', section: 'A', programmeId: 'p-doc', programmeName: 'Science', ...fields };
  }

  it('spots a row whose stored name has drifted', () => {
    expect(classesAreStale([row({})], 'p-doc', 'Physics')).toBe(true);
  });

  it('does not report a row already carrying the new name', () => {
    expect(classesAreStale([row({})], 'p-doc', 'Science')).toBe(false);
  });

  /**
   * THE TRAP. A teacher's row keys on the programme's DOC ID, while a classroom's
   * programmes map keys on its programmeId. The two differ in real data, and a
   * cascade that used one for both would silently update nothing.
   */
  it('ignores rows keyed on a different id, so the wrong key updates nothing', () => {
    expect(classesAreStale([row({ programmeId: 'p-doc' })], 'p-programmeId', 'Physics')).toBe(false);
    expect(classesWithRenamed([row({ programmeId: 'p-doc' })], 'p-programmeId', 'Physics'))
      .toEqual([row({ programmeId: 'p-doc', programmeName: 'Science' })]);
  });

  it('renames only the matching rows and leaves the rest verbatim', () => {
    const classes = [
      row({ programmeId: 'p-doc', section: 'A' }),
      row({ programmeId: 'other', section: 'B', programmeName: 'Maths' })
    ];

    expect(classesWithRenamed(classes, 'p-doc', 'Physics')).toEqual([
      row({ programmeId: 'p-doc', section: 'A', programmeName: 'Physics' }),
      row({ programmeId: 'other', section: 'B', programmeName: 'Maths' })
    ]);
  });

  it('does not mutate the array it is given', () => {
    const classes = [row({})];
    classesWithRenamed(classes, 'p-doc', 'Physics');

    expect(classes[0].programmeName).toBe('Science');
  });

  it('copes with a teacher who has no class rows', () => {
    expect(classesAreStale([], 'p-doc', 'Physics')).toBe(false);
    expect(classesWithRenamed([], 'p-doc', 'Physics')).toEqual([]);
  });
});

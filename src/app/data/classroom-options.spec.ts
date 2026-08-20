import {
  SECTIONS,
  classroomTitle,
  classroomTypeLabel,
  composeClassroomName,
  nextClassroomCode,
  programmeTypeFor,
  takenSections
} from './classroom-options';
import { Classroom } from '../models/teaching.model';

/**
 * A classroom with only the fields these helpers read. Everything else on the
 * interface is irrelevant here and stubbing it would obscure what each case is
 * actually about.
 */
function row(fields: Partial<Classroom>): Classroom {
  return {
    type: 'CLASSROOM',
    institutionId: 'inst-1',
    grade: '',
    section: '',
    classroomCode: '000',
    classroomName: '',
    stemClubName: '',
    ...fields
  } as Classroom;
}

describe('composeClassroomName', () => {

  it('joins grade and section the way production does', () => {
    expect(composeClassroomName('8', 'B')).toBe('8 B');
  });

  /**
   * Production: `value.grade.includes('Pre-primary') ? value.grade : grade + ' ' + section`.
   * A pre-primary year is not sectioned, so appending one would invent a
   * distinction the school does not make.
   */
  it('leaves a pre-primary grade alone, with no section appended', () => {
    expect(composeClassroomName('Pre-primary 2', 'A')).toBe('Pre-primary 2');
    expect(composeClassroomName('Pre-primary 1', '')).toBe('Pre-primary 1');
  });

  it('does not leave a trailing space when the section is empty', () => {
    expect(composeClassroomName('8', '')).toBe('8');
  });

  it('is empty when there is no grade to name', () => {
    expect(composeClassroomName('', 'B')).toBe('');
  });
});

describe('classroomTitle', () => {

  it('prefers the classroom name', () => {
    expect(classroomTitle(row({ classroomName: '8 B' }))).toBe('8 B');
  });

  it('falls back to the club name, which is where a club carries its title', () => {
    expect(classroomTitle(row({ type: 'STEM-CLUB', stemClubName: 'Robotics' }))).toBe('Robotics');
  });

  /**
   * A row imported from production has only ONE of the two keys — the other is
   * deleted, not empty. Whitespace-only is the same problem in a different
   * shape, and both must fall through rather than render a blank cell.
   */
  it('ignores a whitespace-only name', () => {
    expect(classroomTitle(row({ classroomName: '   ', stemClubName: 'Robotics' }))).toBe('Robotics');
  });

  it('is empty when neither is set, rather than undefined', () => {
    expect(classroomTitle(row({}))).toBe('');
  });
});

describe('classroomTypeLabel', () => {

  it('renders the stored SCREAMING value as a human label', () => {
    expect(classroomTypeLabel('CLASSROOM')).toBe('Classroom');
    expect(classroomTypeLabel('STEM-CLUB')).toBe('STEM Club');
  });
});

describe('programmeTypeFor', () => {

  /**
   * Production maps classroom type 'CLASSROOM' to programme type 'REGULAR'.
   * Getting this wrong filters every programme out and the picker silently
   * offers nothing, which reads as "there are none" rather than as a bug.
   */
  it('maps a classroom to REGULAR and a club to STEM-CLUB', () => {
    expect(programmeTypeFor('CLASSROOM')).toBe('REGULAR');
    expect(programmeTypeFor('STEM-CLUB')).toBe('STEM-CLUB');
  });
});

describe('nextClassroomCode', () => {

  it('starts at 001 for a school with no classrooms', () => {
    expect(nextClassroomCode([], 'inst-1')).toBe('001');
  });

  it('continues from the highest existing code', () => {
    const existing = [
      row({ classroomCode: '001' }),
      row({ classroomCode: '004' }),
      row({ classroomCode: '002' })
    ];

    expect(nextClassroomCode(existing, 'inst-1')).toBe('005');
  });

  /**
   * The sequence is PER SCHOOL. Counting across schools would make the code
   * meaningless as a within-school identifier, which is the only thing it is.
   */
  it('ignores classrooms belonging to another school', () => {
    const existing = [
      row({ institutionId: 'inst-1', classroomCode: '001' }),
      row({ institutionId: 'inst-2', classroomCode: '099' })
    ];

    expect(nextClassroomCode(existing, 'inst-1')).toBe('002');
  });

  /**
   * A code written before the field was padded, or imported as a number, must
   * not collapse the whole sequence back to 001.
   */
  it('survives a missing or unparseable code', () => {
    const existing = [
      row({ classroomCode: '' }),
      row({ classroomCode: 'n/a' }),
      row({ classroomCode: '7' })
    ];

    expect(nextClassroomCode(existing, 'inst-1')).toBe('008');
  });

  it('keeps padding past three digits rather than truncating', () => {
    expect(nextClassroomCode([row({ classroomCode: '999' })], 'inst-1')).toBe('1000');
  });
});

describe('takenSections', () => {

  it('reports the sections already used for that grade at that school', () => {
    const existing = [
      row({ grade: '8', section: 'A' }),
      row({ grade: '8', section: 'B' }),
      row({ grade: '9', section: 'C' })
    ];

    const taken = takenSections(existing, 'inst-1', '8');

    expect(taken.has('A')).toBe(true);
    expect(taken.has('B')).toBe(true);
    expect(taken.has('C')).toBe(false);
  });

  it('does not count another school\'s classrooms', () => {
    const existing = [row({ institutionId: 'inst-2', grade: '8', section: 'A' })];

    expect(takenSections(existing, 'inst-1', '8').size).toBe(0);
  });

  /**
   * A STEM club has no grade or section at all, so counting one would block a
   * section that is in fact free.
   */
  it('ignores STEM clubs', () => {
    const existing = [row({ type: 'STEM-CLUB', grade: '', section: '' })];

    expect(takenSections(existing, 'inst-1', '8').size).toBe(0);
  });

  it('leaves free sections available out of the full alphabet', () => {
    const existing = [row({ grade: '8', section: 'A' })];
    const taken = takenSections(existing, 'inst-1', '8');

    expect(SECTIONS.filter(section => !taken.has(section)).length).toBe(SECTIONS.length - 1);
  });
});

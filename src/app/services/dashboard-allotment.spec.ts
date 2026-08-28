import { groupByInstitution } from './dashboard.service';
import { TeacherClassroom } from '../models/teaching.model';

/**
 * groupByInstitution — the dashboard's My Institutions & Classrooms section.
 *
 * WHY THIS IS TESTED AND THE READ IS NOT. The read is three Firestore queries
 * whose only interesting behaviour is the union, and the shape it produces is
 * what the cards render. Everything that can be got wrong is in here: which
 * school a class lands under, what the tiles count, and the order the cards
 * appear in — which must be stable, or the dashboard reshuffles itself between
 * visits because Firestore returned documents differently.
 */

function classroom(overrides: Partial<TeacherClassroom> = {}): TeacherClassroom {
  return {
    activeStatus: true,
    classroomId: 'c1',
    classroomName: '1 A',
    grade: '1',
    section: 'A',
    institutionId: 'inst-1',
    institutionName: 'ThinkTac',
    type: 'CLASSROOM',
    userRole: '',
    programmes: [],
    createdAt: null,
    ...overrides
  } as unknown as TeacherClassroom;
}

describe('groupByInstitution', () => {

  it('returns nothing for nothing', () => {
    expect(groupByInstitution([])).toEqual({ institutions: [], classroomCount: 0 });
  });

  it('groups several classes under one school', () => {
    const result = groupByInstitution([
      classroom({ classroomId: 'c1', classroomName: '1 A', grade: '1' }),
      classroom({ classroomId: 'c2', classroomName: '2 A', grade: '2' })
    ]);

    expect(result.institutions.length).toBe(1);
    expect(result.institutions[0].institutionName).toBe('ThinkTac');
    expect(result.institutions[0].classrooms.length).toBe(2);
    expect(result.classroomCount).toBe(2);
  });

  /* The case the union exists for: one person teaching at two schools. */
  it('splits classes across the schools they belong to', () => {
    const result = groupByInstitution([
      classroom({ classroomId: 'c1', institutionId: 'inst-1', institutionName: 'ThinkTac' }),
      classroom({ classroomId: 'c9', institutionId: 'inst-2', institutionName: 'Airaa Academy' })
    ]);

    expect(result.institutions.map(row => row.institutionName))
      .toEqual(['Airaa Academy', 'ThinkTac']);
    expect(result.classroomCount).toBe(2);
  });

  /* ALPHABETICAL, so the row of cards does not reorder itself between visits. */
  it('sorts schools by name', () => {
    const result = groupByInstitution([
      classroom({ classroomId: 'a', institutionId: 'i3', institutionName: 'Zenith' }),
      classroom({ classroomId: 'b', institutionId: 'i1', institutionName: 'Airaa' }),
      classroom({ classroomId: 'c', institutionId: 'i2', institutionName: 'Modern' })
    ]);

    expect(result.institutions.map(row => row.institutionName))
      .toEqual(['Airaa', 'Modern', 'Zenith']);
  });

  /* Numerically, not as strings — '10' must not sort between '1' and '2'. */
  it('sorts classes by grade within a school', () => {
    const result = groupByInstitution([
      classroom({ classroomId: 'c10', classroomName: '10 A', grade: '10' }),
      classroom({ classroomId: 'c2', classroomName: '2 A', grade: '2' }),
      classroom({ classroomId: 'c1', classroomName: '1 A', grade: '1' })
    ]);

    expect(result.institutions[0].classrooms.map(row => row.grade))
      .toEqual(['1', '2', '10']);
  });

  /* A STEM club carries no grade, so it cannot be compared numerically and
     sorts to the end rather than to the front as Number('') would put it. */
  it('puts a class with no grade after the numbered ones', () => {
    const result = groupByInstitution([
      classroom({ classroomId: 'club', classroomName: 'STEM Forge', grade: '', type: 'STEM-CLUB' }),
      classroom({ classroomId: 'c3', classroomName: '3 A', grade: '3' })
    ]);

    expect(result.institutions[0].classrooms.map(row => row.classroomName))
      .toEqual(['3 A', 'STEM Forge']);
  });

  /* Keyed by id, so two schools that share a name stay two cards. */
  it('keeps two schools apart when they share a name', () => {
    const result = groupByInstitution([
      classroom({ classroomId: 'c1', institutionId: 'inst-1', institutionName: 'ThinkTac' }),
      classroom({ classroomId: 'c2', institutionId: 'inst-2', institutionName: 'ThinkTac' })
    ]);

    expect(result.institutions.length).toBe(2);
    expect(result.classroomCount).toBe(2);
  });

  /* Falls back to the name, so a legacy entry with no institutionId still
     appears rather than being dropped with the class inside it. */
  it('groups a legacy entry with no institution id by its name', () => {
    const result = groupByInstitution([
      classroom({ classroomId: 'c1', institutionId: '', institutionName: 'Old School' }),
      classroom({ classroomId: 'c2', institutionId: '', institutionName: 'Old School' })
    ]);

    expect(result.institutions.length).toBe(1);
    expect(result.institutions[0].classrooms.length).toBe(2);
  });

  /* Nothing identifies the school, so there is no card to put it on. Skipped
     rather than collected under a blank heading. */
  it('skips an entry that names no school at all', () => {
    const result = groupByInstitution([
      classroom({ classroomId: 'c1', institutionId: '', institutionName: '' })
    ]);

    expect(result.institutions).toEqual([]);
    expect(result.classroomCount).toBe(0);
  });

  /* An inactive class is still allotted and still counted — production greys it
     rather than hiding it, and a vanishing class reads as data loss. */
  it('keeps and counts an inactive class', () => {
    const result = groupByInstitution([
      classroom({ classroomId: 'c1', activeStatus: false })
    ]);

    expect(result.institutions[0].classrooms[0].activeStatus).toBe(false);
    expect(result.classroomCount).toBe(1);
  });

  it('counts across every school, not per school', () => {
    const result = groupByInstitution([
      classroom({ classroomId: 'a', institutionId: 'i1', institutionName: 'One' }),
      classroom({ classroomId: 'b', institutionId: 'i1', institutionName: 'One' }),
      classroom({ classroomId: 'c', institutionId: 'i2', institutionName: 'Two' })
    ]);

    expect(result.institutions.length).toBe(2);
    expect(result.classroomCount).toBe(3);
  });
});

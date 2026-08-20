import {
  normaliseClassroom,
  stripTrashMetadata,
  toClassroomProgramme,
  toProgrammeMap
} from './classroom.service';
import { Classroom, Programme } from '../models/teaching.model';

function programme(fields: Partial<Programme>): Programme {
  return {
    docId: 'p1',
    programmeId: 'p1',
    programmeName: 'Science',
    programmeCode: 'SCI',
    displayName: 'Science',
    institutionId: 'inst-1',
    institutionName: 'Oak School',
    grades: ['8'],
    type: 'REGULAR',
    programmeStatus: 'LIVE',
    ...fields
  } as Programme;
}

/**
 * These guard the boundary with ThinkTac production data.
 *
 * Production DELETES the fields that do not apply to a row's variant — a STEM
 * club document has no `grade`, `section` or `classroomName` at all. Reading
 * one straight into the interface leaves undefined behind, and the first save
 * that copies a key off the loaded object fails the entire write with
 * "Unsupported field value: undefined". The institution service already paid
 * for this once; normaliseClassroom is the fix carried forward.
 */
describe('normaliseClassroom', () => {

  it('fills the fields a production STEM club document does not carry', () => {
    const result = normaliseClassroom<Classroom>('c1', {
      type: 'STEM-CLUB',
      stemClubName: 'Robotics',
      institutionId: 'inst-1'
    });

    expect(result.classroomName).toBe('');
    expect(result.grade).toBe('');
    expect(result.section).toBe('');
    expect(result.studentCounter).toBe(0);
    expect(result.studentCredentialStoragePath).toBe('');
    expect(result.programmes).toEqual({});
  });

  it('fills the field a production classroom document does not carry', () => {
    const result = normaliseClassroom<Classroom>('c1', {
      type: 'CLASSROOM',
      classroomName: '8 B',
      grade: 8,
      section: 'B'
    });

    expect(result.stemClubName).toBe('');
  });

  /**
   * Production stores grade as a NUMBER for 1–10 and a string for the
   * pre-primary years. This app uses strings throughout, so an imported row
   * has to be coerced or every grade comparison quietly fails.
   */
  it('coerces a numeric grade to a string', () => {
    expect(normaliseClassroom<Classroom>('c1', { grade: 8 }).grade).toBe('8');
  });

  it('leaves a pre-primary grade as it is', () => {
    expect(normaliseClassroom<Classroom>('c1', { grade: 'Pre-primary 2' }).grade)
      .toBe('Pre-primary 2');
  });

  it('does not turn a missing grade into the string "undefined"', () => {
    expect(normaliseClassroom<Classroom>('c1', {}).grade).toBe('');
    expect(normaliseClassroom<Classroom>('c1', { grade: null }).grade).toBe('');
  });

  it('defaults classroomId to the document id', () => {
    expect(normaliseClassroom<Classroom>('c1', {}).classroomId).toBe('c1');
  });

  it('keeps a classroomId that disagrees with the path, rather than rewriting it', () => {
    // Rewriting would hide a real inconsistency in the data behind a value that
    // looks correct. Surfacing it is more useful than papering over it.
    expect(normaliseClassroom<Classroom>('c1', { classroomId: 'other' }).classroomId)
      .toBe('other');
  });

  /** Anything not the club sentinel is a classroom, so an unknown type is safe. */
  it('treats an unrecognised type as a classroom', () => {
    expect(normaliseClassroom<Classroom>('c1', { type: 'SOMETHING-ELSE' }).type)
      .toBe('CLASSROOM');
    expect(normaliseClassroom<Classroom>('c1', { type: 'STEM-CLUB' }).type)
      .toBe('STEM-CLUB');
  });
});

describe('stripTrashMetadata', () => {

  /**
   * A restore that carried trashAt back into the live collection would leave a
   * row that looks deleted but is not, and nothing in the UI would show it.
   */
  it('removes trashAt so a restored row is byte-identical to what was deleted', () => {
    const restored = stripTrashMetadata({
      docId: 'c1',
      classroomName: '8 B',
      trashAt: 'a timestamp'
    });

    expect('trashAt' in restored).toBe(false);
    expect(restored['classroomName']).toBe('8 B');
    expect(restored['docId']).toBe('c1');
  });

  it('does not mutate the object it was given', () => {
    const trashed = { docId: 'c1', trashAt: 'a timestamp' };

    stripTrashMetadata(trashed);

    expect('trashAt' in trashed).toBe(true);
  });
});

describe('toClassroomProgramme', () => {

  it('keeps the four fields a classroom records about a programme', () => {
    expect(toClassroomProgramme(programme({}))).toEqual({
      programmeId: 'p1',
      programmeName: 'Science',
      programmeCode: 'SCI',
      displayName: 'Science'
    });
  });

  it('falls back to the programme name for a blank displayName', () => {
    expect(toClassroomProgramme(programme({ displayName: '  ' })).displayName).toBe('Science');
  });

  /**
   * production's `workflowIds` and `sequentiallyLocked` belong to the
   * learning-unit locking flow, which this app does not have. Writing keys
   * nothing here maintains would leave them stale on every classroom.
   */
  it('carries nothing beyond those four fields', () => {
    const extra = programme({ grades: ['8'], institutionName: 'Oak School' });

    expect(Object.keys(toClassroomProgramme(extra)).sort()).toEqual([
      'displayName', 'programmeCode', 'programmeId', 'programmeName'
    ]);
  });
});

describe('toProgrammeMap', () => {

  /** Firestore stores this as a MAP keyed by id, matching production. */
  it('keys each programme by its id', () => {
    const map = toProgrammeMap([
      programme({ programmeId: 'p1' }),
      programme({ programmeId: 'p2', programmeName: 'Maths', displayName: 'Maths' })
    ]);

    expect(Object.keys(map).sort()).toEqual(['p1', 'p2']);
    expect(map['p2'].programmeName).toBe('Maths');
  });

  it('is an empty object for no programmes, never undefined', () => {
    expect(toProgrammeMap([])).toEqual({});
  });
});

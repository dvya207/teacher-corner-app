import { supersededRequestKeys } from './profile.service';
import { TeacherProfile } from '../models/teaching.model';

type Requests = NonNullable<TeacherProfile['selfRegTeacherApproval']>;

/**
 * LEGACY REQUEST KEYS ARE CLEARED.
 *
 * Requests used to be keyed grade-section when no classroom could be resolved,
 * and the profile write is merge:true — so an old `9-A` entry survived every
 * subsequent save and the document carried both it and the properly keyed one for
 * the same class. This is the rule that decides what goes, tested directly
 * because it DELETES data.
 */
describe('supersededRequestKeys', () => {
  function request(fields: Partial<Requests[string]>): Requests[string] {
    return {
      approvalStatus: false,
      classroomId: 'c1',
      classroomName: '9 A',
      institutionName: 'Oak',
      institutionId: 'inst-1',
      grade: '9',
      section: 'A',
      programmeId: 'prog-1',
      programmeName: 'Science',
      ...fields
    };
  }

  it('drops a stored unresolved request the incoming one now covers', () => {
    const stored = { '9-A': request({ classroomId: '', classroomName: '' }) };
    const incoming = { c1: request({}) };

    expect(supersededRequestKeys(stored, incoming)).toEqual(['9-A']);
  });

  /** What makes it legacy is referencing no classroom, not the key's shape. */
  it('keeps a stored request that does reference a classroom', () => {
    const stored = { '9-A': request({}) };
    const incoming = { c1: request({}) };

    expect(supersededRequestKeys(stored, incoming)).toEqual([]);
  });

  /** A request for a different class is somebody's real pending ask. */
  it('keeps an unresolved request for a class the incoming one does not cover', () => {
    const stored = { '4-B': request({ classroomId: '', grade: '4', section: 'B' }) };
    const incoming = { c1: request({}) };

    expect(supersededRequestKeys(stored, incoming)).toEqual([]);
  });

  /**
   * NEVER DELETES A KEY IT IS ABOUT TO WRITE. If the incoming request carries the
   * same key, the write already replaces it and a delete would race it.
   */
  it('leaves a key the incoming write is itself setting', () => {
    const stored = { '9-A': request({ classroomId: '', classroomName: '' }) };
    const incoming = { '9-A': request({}) };

    expect(supersededRequestKeys(stored, incoming)).toEqual([]);
  });

  it('does nothing when the incoming request is unresolved too', () => {
    const stored = { '9-A': request({ classroomId: '' }) };
    const incoming = { '4-B': request({ classroomId: '', grade: '4', section: 'B' }) };

    expect(supersededRequestKeys(stored, incoming)).toEqual([]);
  });

  it('copes with an empty document', () => {
    expect(supersededRequestKeys({}, { c1: request({}) })).toEqual([]);
  });
});

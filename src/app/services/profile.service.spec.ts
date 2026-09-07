import { isUsableProfileName, supersededRequestKeys } from './profile.service';
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

/**
 * WHICH NAME WINS.
 *
 * Two sources carry a teacher's name and they are known to disagree in live data:
 * `users/{uid}`, which the teacher edits themselves, and `teachers/{docId}`,
 * which an administrator typed when registering them. The administrator's record
 * is consulted ONLY when the profile has no real name yet, so a teacher who edits
 * their own name keeps it instead of having it reverted on the next sign-in.
 * This predicate is the whole of that rule.
 */
describe('isUsableProfileName', () => {

  it('accepts a real name, which stops the teachers record being consulted', () => {
    expect(isUsableProfileName('Anita')).toBe(true);
  });

  it('rejects an absent name, so a wizard-registered teacher falls through', () => {
    expect(isUsableProfileName(undefined)).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(isUsableProfileName('')).toBe(false);
  });

  it('rejects a whitespace-only name rather than greeting someone with a space', () => {
    expect(isUsableProfileName('   ')).toBe(false);
  });

  /**
   * THE REGRESSION THIS EXISTS FOR. The seed used to persist displayName(), which
   * substitutes this placeholder when nothing is known, so phone-only accounts
   * were written with the literal first name 'Teacher'. A truthiness check reads
   * that as a real name, which is why those accounts stayed greeted as 'Teacher'
   * with a users/{uid} document that looked correctly filled in.
   */
  it('rejects the literal placeholder, which older accounts still carry', () => {
    expect(isUsableProfileName('Teacher')).toBe(false);
  });

  it('rejects the placeholder with padding, since it is trimmed before comparing', () => {
    expect(isUsableProfileName('  Teacher  ')).toBe(false);
  });

  /** Only the exact placeholder is refused; a real person may be named this. */
  it('accepts a name that merely contains the placeholder', () => {
    expect(isUsableProfileName('Teacherson')).toBe(true);
  });

  it('accepts a name that differs from the placeholder only in case', () => {
    expect(isUsableProfileName('teacher')).toBe(true);
  });
});

import { Timestamp } from 'firebase/firestore';

import { Teacher } from '../models/teaching.model';
import {
  classKey,
  mergeClasses,
  normaliseTeacher,
  stripImmutableTeacherFields,
  stripTeacherTrashMetadata,
  teacherFullName,
  withoutUndefinedTeacherFields
} from './teacher.service';

/**
 * Guards on the teacher write path.
 *
 * Tested directly rather than through a component, because the component specs
 * stub the service — an assertion there would be checking the stub, not this.
 * Same shape as institution.service.spec.ts, because the guards are the same
 * guards and a difference between them would be a bug in one of the two.
 */
describe('stripImmutableTeacherFields', () => {

  it('removes ownerId, which the security rule pins on update', () => {
    const patch = { firstName: 'Anita', ownerId: 'someone-else' } as Partial<Teacher>;

    expect(stripImmutableTeacherFields(patch)).toEqual({ firstName: 'Anita' });
  });

  it('removes docId, which mirrors the document path rather than being editable', () => {
    expect(stripImmutableTeacherFields({ docId: 'abc', role: 'ThinkTac Coach' }))
      .toEqual({ role: 'ThinkTac Coach' });
  });

  /**
   * NOT a rules requirement — a judgement.
   *
   * Moving a teacher between schools is a real operation, but it is not an EDIT
   * of their details. Letting a name change carry a school change alongside it
   * is how a teacher silently ends up at the wrong institution.
   */
  it('removes institutionId, so an edit cannot quietly move a teacher between schools', () => {
    const patch = { firstName: 'Anita', institutionId: 'other-school' } as Partial<Teacher>;

    expect(stripImmutableTeacherFields(patch)).toEqual({ firstName: 'Anita' });
  });

  it('removes createdAt, which is set once', () => {
    expect(stripImmutableTeacherFields({ createdAt: Timestamp.now(), role: 'ThinkTac Coach' }))
      .toEqual({ role: 'ThinkTac Coach' });
  });

  it('leaves updatedAt alone, since every edit is meant to move it', () => {
    const now = Timestamp.now();

    expect(stripImmutableTeacherFields({ updatedAt: now })).toEqual({ updatedAt: now });
  });

  it('leaves falsy values untouched rather than treating them as absent', () => {
    const patch: Partial<Teacher> = { firstName: '', email: '', active: false };

    expect(stripImmutableTeacherFields(patch)).toEqual(patch);
  });

  it('returns an empty object when the patch held only immutable fields', () => {
    expect(stripImmutableTeacherFields({ docId: 'a', ownerId: 'b', institutionId: 'c' }))
      .toEqual({});
  });
});

describe('withoutUndefinedTeacherFields', () => {

  /**
   * Firestore treats undefined as an error rather than as "leave this alone", so
   * one stray key fails the whole update. This is the bug that broke Save
   * Changes on institutions.
   */
  it('drops keys whose value is undefined', () => {
    const fields = { firstName: 'Anita', lastName: undefined } as Partial<Teacher>;

    expect(withoutUndefinedTeacherFields(fields)).toEqual({ firstName: 'Anita' });
  });

  it('keeps empty strings and false, which are real values', () => {
    const fields: Partial<Teacher> = { email: '', active: false };

    expect(withoutUndefinedTeacherFields(fields)).toEqual(fields);
  });
});

describe('teacherFullName', () => {

  it('collapses first and last into one stored field', () => {
    expect(teacherFullName('Anita', 'Rao')).toBe('Anita Rao');
  });

  it('does not leave a stray space when half of it is missing', () => {
    expect(teacherFullName('Anita', '')).toBe('Anita');
    expect(teacherFullName('', 'Rao')).toBe('Rao');
    expect(teacherFullName('', '')).toBe('');
  });

  it('trims what it is given', () => {
    expect(teacherFullName('  Anita ', ' Rao  ')).toBe('Anita Rao');
  });
});

describe('stripTeacherTrashMetadata', () => {

  it('removes trashAt, so a restored document is byte-identical to the original', () => {
    const trashed = { firstName: 'Anita', ownerId: 'alice', trashAt: Timestamp.now() };

    expect(stripTeacherTrashMetadata(trashed)).toEqual({ firstName: 'Anita', ownerId: 'alice' });
  });

  it('leaves a document without trash metadata untouched', () => {
    const plain = { firstName: 'Anita', ownerId: 'alice' };

    expect(stripTeacherTrashMetadata(plain)).toEqual(plain);
  });

  it('does not mutate its input', () => {
    const trashed = { firstName: 'Anita', trashAt: Timestamp.now() };

    stripTeacherTrashMetadata(trashed);

    expect('trashAt' in trashed).toBe(true);
  });
});

describe('normaliseTeacher', () => {

  /**
   * A row written before a field existed simply has no such key, and the
   * interface says otherwise. Casting data() straight to Teacher is a lie the
   * type system cannot see; this is what makes it true.
   */
  it('fills in every field a stored document may predate', () => {
    const teacher = normaliseTeacher<Teacher>('t1', {});

    expect(teacher).toEqual({
      docId: 't1',
      institutionId: '',
      firstName: '',
      lastName: '',
      teacherName: '',
      email: '',
      countryCode: '',
      phoneNumber: '',
      role: '',
      classes: [],
      active: true
    });
  });

  it('carries the document id in, rather than trusting a stored copy of it', () => {
    const teacher = normaliseTeacher<Teacher>('real-id', { docId: 'stale-id' });

    expect(teacher.docId).toBe('real-id');
  });

  /** Absent means active; only an explicit false means inactive. */
  it('treats a missing active as true and a stored false as false', () => {
    expect(normaliseTeacher<Teacher>('t1', {}).active).toBe(true);
    expect(normaliseTeacher<Teacher>('t1', { active: false }).active).toBe(false);
    expect(normaliseTeacher<Teacher>('t1', { active: true }).active).toBe(true);
  });

  it('leaves stored values alone', () => {
    const teacher = normaliseTeacher<Teacher>('t1', {
      firstName: 'Anita',
      lastName: 'Rao',
      teacherName: 'Anita Rao',
      email: 'anita@example.com',
      countryCode: '+91',
      phoneNumber: '9876543210',
      role: 'School Teacher',
      institutionId: 'inst-1'
    });

    expect(teacher.firstName).toBe('Anita');
    expect(teacher.phoneNumber).toBe('9876543210');
    expect(teacher.institutionId).toBe('inst-1');
    expect(teacher.role).toBe('School Teacher');
  });

  /**
   * THE MIGRATION. The first teachers written here carried grade, section,
   * programmeId and programmeName as four FLAT fields, before the form grew a ⊕
   * that adds a second class. Those documents are real and must not read back as
   * a teacher who takes nothing.
   */
  it('folds the legacy single-class shape into a one-element array', () => {
    const teacher = normaliseTeacher<Teacher>('t1', {
      grade: '1',
      section: 'A',
      programmeId: 'prog-1',
      programmeName: 'Science'
    });

    expect(teacher.classes).toEqual([
      { grade: '1', section: 'A', programmeId: 'prog-1', programmeName: 'Science' }
    ]);
  });

  it('prefers a real classes array over any legacy fields beside it', () => {
    const teacher = normaliseTeacher<Teacher>('t1', {
      grade: '9',
      section: 'Z',
      classes: [{ grade: '1', section: 'A', programmeId: 'p', programmeName: 'Science' }]
    });

    expect(teacher.classes.length).toBe(1);
    expect(teacher.classes[0].section).toBe('A');
  });

  it('reads a teacher with neither shape as taking no classes', () => {
    expect(normaliseTeacher<Teacher>('t1', { firstName: 'Anita' }).classes).toEqual([]);
  });

  it('fills gaps inside a stored class entry', () => {
    const teacher = normaliseTeacher<Teacher>('t1', { classes: [{ grade: '1' }] });

    expect(teacher.classes[0]).toEqual({
      grade: '1', section: '', programmeId: '', programmeName: ''
    });
  });

  /**
   * The whole point of normalising: an update built by reading keys off a loaded
   * document must not send undefined to Firestore.
   */
  it('produces a document with no undefined values to feed back into an update', () => {
    const teacher = normaliseTeacher<Teacher>('t1', { firstName: 'Anita' });

    expect(Object.values(teacher).some(value => value === undefined)).toBe(false);
  });
});

describe('mergeClasses', () => {

  const cls = (grade: string, section: string, programmeId: string, programmeName = 'Science') =>
    ({ grade, section, programmeId, programmeName });

  it('appends a class the teacher does not have', () => {
    const merged = mergeClasses([cls('1', 'A', 'p1')], [cls('2', 'B', 'p2')]);

    expect(merged.map(classKey)).toEqual(['1|A|p1', '2|B|p2']);
  });

  /**
   * THE BUG THIS CATCHES: the lookup makes re-submitting the same class easy to
   * do by accident, and a growing list of identical entries is the result.
   */
  it('drops a class the teacher already has', () => {
    const merged = mergeClasses([cls('1', 'A', 'p1')], [cls('1', 'A', 'p1')]);

    expect(merged.length).toBe(1);
  });

  /**
   * programmeName is a denormalised SNAPSHOT, so two entries for the same class
   * written either side of a rename must not read as different classes.
   */
  it('ignores the programme name when deciding what is a duplicate', () => {
    const merged = mergeClasses(
      [cls('1', 'A', 'p1', 'Science')],
      [cls('1', 'A', 'p1', 'Science — renamed')]
    );

    expect(merged.length).toBe(1);
    expect(merged[0].programmeName).toBe('Science');
  });

  it('keeps the stored entry rather than the incoming one', () => {
    const merged = mergeClasses([cls('1', 'A', 'p1', 'Original')], [cls('1', 'A', 'p1', 'New')]);

    expect(merged[0].programmeName).toBe('Original');
  });

  it('deduplicates within the additions themselves', () => {
    const merged = mergeClasses([], [cls('1', 'A', 'p1'), cls('1', 'A', 'p1')]);

    expect(merged.length).toBe(1);
  });

  it('leaves the existing list alone when there is nothing to add', () => {
    const existing = [cls('1', 'A', 'p1')];

    expect(mergeClasses(existing, [])).toEqual(existing);
  });

  it('does not mutate its input', () => {
    const existing = [cls('1', 'A', 'p1')];
    mergeClasses(existing, [cls('2', 'B', 'p2')]);

    expect(existing.length).toBe(1);
  });
});

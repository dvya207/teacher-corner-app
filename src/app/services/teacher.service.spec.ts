import { Timestamp } from 'firebase/firestore';

import { Teacher, TeacherClassroom } from '../models/teaching.model';
import {
  mergeClassrooms,
  stampedClassrooms,
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
    expect(stripImmutableTeacherFields({ docId: 'abc', classrooms: {} }))
      .toEqual({ classrooms: {} });
  });

  /**
   * THE SCHOOL IS NO LONGER AT THIS LEVEL to be stripped: it lives on each
   * classroom entry, so an edit cannot move a teacher between schools by
   * touching one field. The guard here is now only docId and ownerId.
   */
  it('removes docId, which mirrors the path rather than being editable', () => {
    const patch = { docId: 'other-id', classrooms: {} } as Partial<Teacher>;

    expect(stripImmutableTeacherFields(patch)).toEqual({ classrooms: {} });
  });

  it('leaves updatedAt alone, since every edit is meant to move it', () => {
    const now = Timestamp.now();

    expect(stripImmutableTeacherFields({ updatedAt: now })).toEqual({ updatedAt: now });
  });

  it('leaves falsy values untouched rather than treating them as absent', () => {
    const patch: Partial<Teacher> = { classrooms: {} };

    expect(stripImmutableTeacherFields(patch)).toEqual(patch);
  });

  it('returns an empty object when the patch held only immutable fields', () => {
    expect(stripImmutableTeacherFields({ docId: 'a', ownerId: 'b' })).toEqual({});
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
    const fields: Partial<Teacher> = { classrooms: {} };

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
      teacherMeta: {
        countryCode: '',
        email: '',
        firstName: '',
        lastName: '',
        fullNameLowerCase: '',
        phone: '',
        phoneNumber: '',
        // uid is ABSENT, not empty: a teacher who has never signed in has no uid,
        // and a blank one would read as answered.
        updatedAt: null
      },
      classrooms: {}
    });
  });

  it('carries the document id in, rather than trusting a stored copy of it', () => {
    const teacher = normaliseTeacher<Teacher>('real-id', { docId: 'stale-id' });

    expect(teacher.docId).toBe('real-id');
  });

  it('lifts the flat legacy identity fields into teacherMeta', () => {
    const teacher = normaliseTeacher<Teacher>('t1', {
      firstName: 'Anita',
      lastName: 'Rao',
      email: 'anita@example.com',
      countryCode: '+91',
      phoneNumber: '9876543210'
    });

    expect(teacher.teacherMeta.firstName).toBe('Anita');
    expect(teacher.teacherMeta.phoneNumber).toBe('9876543210');
    expect(teacher.teacherMeta.phone).toBe('9876543210');
    expect(teacher.teacherMeta.countryCode).toBe('+91');
  });

  it('prefers a stored teacherMeta over the flat fields beside it', () => {
    const teacher = normaliseTeacher<Teacher>('t1', {
      firstName: 'Stale',
      teacherMeta: { firstName: 'Anita', lastName: 'Rao', phoneNumber: '9876543210' }
    });

    expect(teacher.teacherMeta.firstName).toBe('Anita');
  });

  /** Production's search key: lowercased, whitespace removed. */
  it('derives fullNameLowerCase when the stored document has none', () => {
    const teacher = normaliseTeacher<Teacher>('t1', { firstName: 'Santosh', lastName: 'Kanta' });

    expect(teacher.teacherMeta.fullNameLowerCase).toBe('santoshkanta');
  });

  it('omits uid entirely when the document has none', () => {
    const meta = normaliseTeacher<Teacher>('t1', { firstName: 'Anita' }).teacherMeta;

    expect('uid' in meta).toBe(false);
  });

  it('keeps a uid the document does carry', () => {
    const meta = normaliseTeacher<Teacher>('t1', {
      teacherMeta: { uid: 'auth-uid-1' }
    }).teacherMeta;

    expect(meta.uid).toBe('auth-uid-1');
  });

  it('reads a stored classrooms map, keeping its key as the classroom id', () => {
    const teacher = normaliseTeacher<Teacher>('t1', {
      classrooms: { c1: { classroomName: '4 A', institutionName: 'Airaa Academy' } }
    });

    expect(teacher.classrooms['c1'].classroomId).toBe('c1');
    expect(teacher.classrooms['c1'].classroomName).toBe('4 A');
    expect(teacher.classrooms['c1'].type).toBe('CLASSROOM');
    expect(teacher.classrooms['c1'].programmes).toEqual([]);
  });

  /**
   * LEGACY. The first teachers here carried a flat `classes` array of
   * grade/section/programme with no classroom behind it, because the wizard
   * collected those before the school had any classrooms. Those rows must not
   * read back as a teacher who takes nothing.
   */
  it('folds a legacy classes array into classrooms, keyed by programme', () => {
    const teacher = normaliseTeacher<Teacher>('t1', {
      classes: [{ grade: '1', section: 'A', programmeId: 'prog-1', programmeName: 'Science' }]
    });

    expect(teacher.classrooms['prog-1'].grade).toBe('1');
    expect(teacher.classrooms['prog-1'].section).toBe('A');
    expect(teacher.classrooms['prog-1'].programmes[0].programmeName).toBe('Science');
  });

  /** No classroom existed to reference, so the id stays visibly empty. */
  it('leaves a legacy entry with no classroomId rather than inventing one', () => {
    const teacher = normaliseTeacher<Teacher>('t1', {
      classes: [{ grade: '1', section: 'A', programmeId: 'prog-1', programmeName: 'Science' }]
    });

    expect(teacher.classrooms['prog-1'].classroomId).toBe('');
  });

  it('prefers a real classrooms map over a legacy classes array beside it', () => {
    const teacher = normaliseTeacher<Teacher>('t1', {
      classes: [{ grade: '9', section: 'Z', programmeId: 'old' }],
      classrooms: { c1: { classroomName: '4 A' } }
    });

    expect(Object.keys(teacher.classrooms)).toEqual(['c1']);
  });

  it('reads a teacher with neither shape as taking no classrooms', () => {
    expect(normaliseTeacher<Teacher>('t1', { firstName: 'Anita' }).classrooms).toEqual({});
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

describe('mergeClassrooms', () => {

  function entry(classroomId: string, programmeIds: string[]) {
    return {
      activeStatus: true,
      classroomId,
      classroomName: '4 A',
      grade: '4',
      section: 'A',
      institutionId: 'inst-1',
      institutionName: 'Airaa Academy',
      type: 'CLASSROOM' as const,
      userRole: 'schoolTeacher',
      programmes: programmeIds.map(programmeId => ({
        programmeId,
        programmeName: 'Science',
        displayName: 'Science',
        programmeCode: 'P1',
        sequentiallyLocked: false
      })),
      createdAt: null as never
    };
  }

  it('adds a classroom the teacher does not have', () => {
    const merged = mergeClassrooms({ c1: entry('c1', ['p1']) }, { c2: entry('c2', ['p2']) });

    expect(Object.keys(merged).sort()).toEqual(['c1', 'c2']);
  });

  /**
   * THE POINT OF THE MERGE. Re-registering a teacher against a classroom they
   * already have must not discard the programmes already on that entry.
   */
  it('unions the programmes on a classroom the teacher already has', () => {
    const merged = mergeClassrooms({ c1: entry('c1', ['p1']) }, { c1: entry('c1', ['p2']) });

    expect(merged['c1'].programmes.map(p => p.programmeId)).toEqual(['p1', 'p2']);
  });

  it('does not duplicate a programme already on the entry', () => {
    const merged = mergeClassrooms({ c1: entry('c1', ['p1']) }, { c1: entry('c1', ['p1']) });

    expect(merged['c1'].programmes.length).toBe(1);
  });

  /** The stored entry keeps its own snapshot rather than being overwritten. */
  it('keeps the existing programme entry when the addition matches it', () => {
    const existing = entry('c1', ['p1']);
    existing.programmes[0].programmeName = 'Science (stored)';

    const merged = mergeClassrooms({ c1: existing }, { c1: entry('c1', ['p1']) });

    expect(merged['c1'].programmes[0].programmeName).toBe('Science (stored)');
  });

  it('does not mutate either input', () => {
    const existing = { c1: entry('c1', ['p1']) };
    mergeClassrooms(existing, { c1: entry('c1', ['p2']) });

    expect(existing['c1'].programmes.length).toBe(1);
  });

  it('returns the additions when there is nothing stored yet', () => {
    expect(mergeClassrooms({}, { c1: entry('c1', ['p1']) })['c1'].classroomId).toBe('c1');
  });
});

/**
 * createdAt ON EACH CLASSROOM ENTRY.
 *
 * It shipped as a literal null: the component built the entry with a placeholder
 * and nothing ever replaced it, so every attachment read as "at no time". The
 * stamping is its own function so it is visible rather than buried in a payload
 * literal.
 */
describe('stampedClassrooms', () => {
  function entry(overrides: Partial<TeacherClassroom> = {}): TeacherClassroom {
    return {
      activeStatus: true,
      classroomId: 'c1',
      classroomName: '9 B',
      grade: '9',
      section: 'B',
      institutionId: 'inst-1',
      institutionName: 'KUVEMPU UNIVERSITY',
      type: 'CLASSROOM',
      userRole: 'School Teacher',
      programmes: [],
      createdAt: null as never,
      ...overrides
    };
  }

  it('replaces a null createdAt with something', () => {
    const stamped = stampedClassrooms({ c1: entry() });

    expect(stamped['c1'].createdAt).not.toBeNull();
    expect(stamped['c1'].createdAt).toBeDefined();
  });

  it('stamps every entry, not just the first', () => {
    const stamped = stampedClassrooms({
      c1: entry(),
      c2: entry({ classroomId: 'c2', classroomName: '4 A' })
    });

    expect(stamped['c1'].createdAt).not.toBeNull();
    expect(stamped['c2'].createdAt).not.toBeNull();
  });

  it('leaves everything else about the entry untouched', () => {
    const stamped = stampedClassrooms({ c1: entry() });

    expect(stamped['c1'].classroomName).toBe('9 B');
    expect(stamped['c1'].grade).toBe('9');
    expect(stamped['c1'].userRole).toBe('School Teacher');
  });

  it('does not mutate the map it is given', () => {
    const before = { c1: entry() };
    stampedClassrooms(before);

    expect(before['c1'].createdAt).toBeNull();
  });

  it('copes with an empty map', () => {
    expect(stampedClassrooms({})).toEqual({});
  });
});

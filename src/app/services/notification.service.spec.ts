import { Timestamp } from 'firebase/firestore';

import { NotificationAction, NotificationModule } from '../models/teaching.model';
import {
  normaliseNotification,
  notificationFor,
  notificationTitle
} from './notification.service';

/**
 * The notification wording and shape.
 *
 * Tested directly rather than through a component, because the page specs stub
 * the service — an assertion there would be checking the stub. The wording is
 * pure, and it is stored on the document, so these pin what the feed will still
 * say months after it was written.
 */

describe('notificationTitle', () => {

  it('names all twelve events the three modules raise', () => {
    const titles: [NotificationModule, NotificationAction, string][] = [
      ['institution', 'created',    'Institution added'],
      ['institution', 'updated',    'Institution updated'],
      ['institution', 'verified',   'Institution verified'],
      ['institution', 'unverified', 'Institution unverified'],
      ['institution', 'deleted',    'Institution deleted'],
      ['institution', 'restored',   'Institution restored'],
      ['classroom',   'created',    'Classroom created'],
      ['classroom',   'updated',    'Classroom updated'],
      ['classroom',   'assigned',   'Classroom programme assigned'],
      ['classroom',   'unassigned', 'Classroom programme removed'],
      ['classroom',   'deleted',    'Classroom deleted'],
      ['classroom',   'restored',   'Classroom restored'],
      ['programme',   'created',    'Programme created'],
      ['programme',   'updated',    'Programme updated'],
      ['programme',   'status',     'Programme status changed'],
      ['programme',   'deleted',    'Programme deleted'],
      ['programme',   'restored',   'Programme restored']
    ];

    for (const [module, action, expected] of titles) {
      expect(notificationTitle(module, action)).toBe(expected);
    }
  });

  /**
   * The institution UI says "Add Institution" while the other two say "Create",
   * so the feed follows each module's own word for the same act.
   */
  it('says added for an institution and created for the other two', () => {
    expect(notificationTitle('institution', 'created')).toBe('Institution added');
    expect(notificationTitle('classroom', 'created')).toBe('Classroom created');
    expect(notificationTitle('programme', 'created')).toBe('Programme created');
  });
});

describe('notificationFor', () => {

  it('names the subject the user sees, not the document id', () => {
    const draft = notificationFor('institution', 'created', 'Oak Valley School', 'inst-1');

    expect(draft.title).toBe('Institution added');
    expect(draft.description).toBe('Oak Valley School');
    expect(draft.module).toBe('institution');
    expect(draft.action).toBe('created');
  });

  it('appends a detail when one is given', () => {
    const draft = notificationFor('classroom', 'assigned', '8 B', 'cls-1', 'Grade 8 Science');

    expect(draft.description).toBe('8 B — Grade 8 Science');
  });

  /**
   * ONLY the id field for this notification's own module is set. Writing all
   * three would put empty strings in Firestore for the two that do not apply.
   */
  it('sets only its own module id field', () => {
    expect(notificationFor('institution', 'created', 'x', 'inst-1'))
      .toEqual(expect.objectContaining({ institutionId: 'inst-1' }));

    const classroom = notificationFor('classroom', 'created', 'x', 'cls-1');
    expect(classroom.classroomId).toBe('cls-1');
    expect(classroom.institutionId).toBeUndefined();
    expect(classroom.programmeId).toBeUndefined();

    const programme = notificationFor('programme', 'created', 'x', 'prog-1');
    expect(programme.programmeId).toBe('prog-1');
    expect(programme.classroomId).toBeUndefined();
  });

  /** An unnamed subject would otherwise render as a leading dash. */
  it('falls back to Untitled rather than showing an empty line', () => {
    expect(notificationFor('programme', 'updated', '   ', 'prog-1').description).toBe('Untitled');
  });

  /** Never undefined: Firestore rejects it outright. */
  it('emits no undefined values', () => {
    for (const draft of [
      notificationFor('institution', 'verified', 'Oak', 'inst-1'),
      notificationFor('classroom', 'unassigned', '8 B', 'cls-1', 'Science'),
      notificationFor('programme', 'status', 'Maths', 'prog-1', 'Live to In development')
    ]) {
      for (const value of Object.values(draft)) {
        expect(value).not.toBeUndefined();
      }
    }
  });
});

describe('normaliseNotification', () => {

  it('fills in a document that predates a field', () => {
    const note = normaliseNotification('n-1', { title: 'Institution added' });

    expect(note.id).toBe('n-1');
    expect(note.description).toBe('');
    expect(note.read).toBe(false);
    // Defaults rather than undefined, so the panel never renders a blank icon.
    expect(note.module).toBe('institution');
    expect(note.action).toBe('updated');
  });

  it('keeps what is stored', () => {
    const note = normaliseNotification('n-2', {
      module: 'programme',
      action: 'status',
      title: 'Programme status changed',
      description: 'Maths — Live to In development',
      programmeId: 'prog-1',
      read: true,
      createdAt: Timestamp.fromDate(new Date('2026-08-17T10:00:00Z'))
    });

    expect(note.module).toBe('programme');
    expect(note.action).toBe('status');
    expect(note.description).toBe('Maths — Live to In development');
    expect(note.programmeId).toBe('prog-1');
    expect(note.read).toBe(true);
  });

  /** Anything other than a literal true is unread: a missing flag is not read. */
  it('treats a missing or odd read flag as unread', () => {
    expect(normaliseNotification('a', {}).read).toBe(false);
    expect(normaliseNotification('b', { read: 'yes' }).read).toBe(false);
    expect(normaliseNotification('c', { read: 1 }).read).toBe(false);
    expect(normaliseNotification('d', { read: true }).read).toBe(true);
  });
});

import { TestBed } from '@angular/core/testing';

import {
  AssignmentUploadService,
  SUBMISSION_MAX_BYTES,
  SUBMISSION_STORAGE_FOLDER,
  UploadTarget
} from './assignment-upload.service';
import { ConfigurationService } from './configuration.service';
import { UploadSlot } from '../models/teaching.model';

/**
 * Uploading a file against an upload assignment's slot.
 *
 * WHAT IS WORTH TESTING HERE is the part that decides what happens to a file
 * BEFORE any network call: which extensions are accepted, which ceiling applies,
 * and where the file is filed. Each of those has a specific reason to be pinned:
 *
 *   - THE PATH IS PRODUCTION'S FORMAT and its own screens compute the same string
 *     to find a submission. Get it wrong and the file uploads to a place nothing
 *     can find, which looks like success and is not.
 *   - THE TWO CEILINGS DISAGREE. A video slot declares 200mb; production refuses
 *     anything over 3mb. The smaller has to win, and the message has to explain
 *     why, or a reader stares at a field saying 200mb wondering why 4mb failed.
 *   - '.jpeg' IS NOT ACCEPTED, because production's own list has only '.jpg' and
 *     '.png'. That looks like a bug worth fixing until you notice that accepting
 *     it here would produce files production then rejects.
 *
 * THE UPLOAD AND THE RECORD ARE NOT TESTED HERE. Both are network calls —
 * `uploadBytesResumable` and a merged `setDoc` — and standing in for them would
 * leave tests asserting that a mock was called. They were verified against the
 * database instead; see the service's own note for the live document the shape was
 * read from.
 */

function slot(overrides: Partial<UploadSlot> = {}): UploadSlot {
  return {
    title: 'Upload activity image',
    instructions: '',
    maxFileSize: 20,
    maxNoOfUploads: 1,
    uploadFileType: 'IMAGE',
    submissionId: 1,
    resourcePath: '',
    durationInHours: 0,
    durationInMinutes: 10,
    durationInSeconds: 0,
    ...overrides
  };
}

function target(overrides: Partial<UploadTarget> = {}): UploadTarget {
  return {
    uid: 'teacher-1',
    // The teacher RECORD's id, distinct from the uid: submissions root on the
    // record, while Storage paths and teacherId still key on the account.
    teacherDocId: 'teacher-doc-1',
    classroomId: 'class-1',
    programmeId: 'prog-1',
    workflowId: 'wf-1',
    assignmentId: 'asg-1',
    ...overrides
  };
}

/** A File of a given size, without allocating one. */
function file(name: string, bytes = 1024): File {
  const made = new File(['x'], name, { type: 'application/octet-stream' });

  Object.defineProperty(made, 'size', { value: bytes });

  return made;
}

function service(): AssignmentUploadService {
  return TestBed.inject(AssignmentUploadService);
}

describe('AssignmentUploadService', () => {

  describe('which extensions a slot accepts', () => {

    /**
     * THE SEEDED MAP ANSWERS, which is the point of seeding it: this app's own
     * Configuration document carries `formatNames` and `sizeCaps` but NOT
     * `formats`, so a reader that only consulted the document would leave the
     * whitelist empty and refuse every file as the wrong type.
     */
    it('answers from the seeded map with no document loaded', () => {
      expect(service().acceptedExtensions(slot({ uploadFileType: 'PDF' }))).toEqual([
        '.pdf'
      ]);
    });

    /** LOOKED UP LOWERCASE against an uppercase stored value, as production does. */
    it('matches an uppercase slot type against the lowercase keys', () => {
      expect(service().acceptedExtensions(slot({ uploadFileType: 'VIDEO' }))).toContain(
        '.mp4'
      );
    });

    /**
     * '.jpg' AND '.png', AND NOT '.jpeg' — production's own list. It looks like an
     * oversight and accepting .jpeg would be the obvious "fix", but this app's
     * files are read by production's screens, so admitting a file it refuses would
     * move the failure somewhere harder to see.
     */
    it('accepts jpg and png for an image slot, and not jpeg', () => {
      const extensions = service().acceptedExtensions(slot({ uploadFileType: 'IMAGE' }));

      expect(extensions).toEqual(['.jpg', '.png']);
      expect(extensions).not.toContain('.jpeg');
    });

    /**
     * AN UNKNOWN TYPE ACCEPTS EVERYTHING AT THE PICKER, and the refusal moves to
     * `validate`. An `accept` attribute built from an empty list makes the native
     * file dialog show no files at all, which reads as a broken button rather than
     * as an unconfigured slot.
     */
    it('returns nothing for a type it has no list for', () => {
      expect(service().acceptedExtensions(slot({ uploadFileType: 'HOLOGRAM' }))).toEqual(
        []
      );
      expect(service().acceptedExtensions(slot({ uploadFileType: '' }))).toEqual([]);
    });

    /** THE DOCUMENT WINS once it carries the key. */
    it('prefers the loaded configuration over the seeded map', () => {
      TestBed.inject(ConfigurationService).uploadExtensions.set({ pdf: ['.pdf', '.xps'] });

      expect(service().acceptedExtensions(slot({ uploadFileType: 'PDF' }))).toEqual([
        '.pdf',
        '.xps'
      ]);
    });
  });

  describe('the size ceiling', () => {

    /** PRODUCTION'S OWN NUMBER: `event.size > 3145728`. */
    it('is three megabytes', () => {
      expect(SUBMISSION_MAX_BYTES).toBe(3145728);
    });

    /**
     * THE SMALLER OF THE TWO WINS, and on a video slot they are two orders of
     * magnitude apart: the slot says 200mb and production refuses over 3mb.
     * Reporting the slot's number would promise something the upload then refuses.
     */
    it('takes the hard cap over a larger slot limit', () => {
      expect(service().limitMb(slot({ maxFileSize: 200 }))).toBe(3);
    });

    /** AND THE SLOT'S NUMBER WHEN IT IS THE SMALLER ONE. */
    it('takes the slot limit when it is under the hard cap', () => {
      expect(service().limitMb(slot({ maxFileSize: 1 }))).toBe(1);
    });

    /** A slot with no usable limit falls back to the hard cap, not to zero. */
    it('falls back to the hard cap for a blank or nonsense limit', () => {
      expect(service().limitMb(slot({ maxFileSize: '' }))).toBe(3);
      expect(service().limitMb(slot({ maxFileSize: 0 }))).toBe(3);
      expect(service().limitMb(slot({ maxFileSize: -5 }))).toBe(3);
    });
  });

  describe('validate', () => {

    it('passes a file of the right type and size', () => {
      expect(service().validate(file('photo.jpg', 1000), slot())).toBe('');
    });

    /** CASE-INSENSITIVE, so a camera's PHOTO.JPG is not refused for its capitals. */
    it('accepts an uppercase extension', () => {
      expect(service().validate(file('PHOTO.JPG', 1000), slot())).toBe('');
    });

    /**
     * THE WRONG TYPE AND THE WRONG SIZE GET DIFFERENT MESSAGES, because they need
     * different actions — pick another file, or shrink this one. Production shows
     * one string for both ("Invalid file type/ Exceeding size limit") and leaves
     * the reader to work out which half applied.
     */
    it('names the accepted extensions when the type is wrong', () => {
      const message = service().validate(file('notes.pdf', 1000), slot());

      expect(message).toContain('.pdf');
      expect(message).toContain('.jpg, .png');
    });

    it('names the size and the limit when the file is too big', () => {
      const message = service().validate(file('photo.jpg', 5 * 1024 * 1024), slot());

      expect(message).toContain('5.0MB');
      expect(message).toContain('3MB');
    });

    /**
     * AND EXPLAINS THE DISAGREEMENT when the slot's own number is the larger one.
     * A reader looking at a field that says 200mb, refused a 4mb video, otherwise
     * has no way to find out why.
     */
    it('explains why a video under the slot limit is still refused', () => {
      const message = service().validate(
        file('clip.mp4', 4 * 1024 * 1024),
        slot({ uploadFileType: 'VIDEO', maxFileSize: 200 })
      );

      expect(message).toContain('200MB');
      expect(message).toContain('capped at 3MB');
    });

    /** A file with no extension at all is refused, and says so readably. */
    it('refuses a file with no extension', () => {
      const message = service().validate(file('README', 100), slot());

      expect(message).toContain('That file');
    });

    /**
     * A SLOT WITH NO CONFIGURED TYPE CHECKS SIZE ONLY. Refusing everything would
     * make an unconfigured slot indistinguishable from a broken upload, and the
     * Storage rule is the backstop for the type either way.
     */
    it('checks only the size when the type has no list', () => {
      const unknown = slot({ uploadFileType: 'HOLOGRAM', maxFileSize: 2 });

      expect(service().validate(file('thing.xyz', 100), unknown)).toBe('');
      expect(service().validate(file('thing.xyz', 3 * 1024 * 1024), unknown)).toContain(
        '2MB'
      );
    });
  });

  describe('where the file is filed', () => {

    /**
     * PRODUCTION'S PATH FORMAT UNDER THIS APP'S OWN FOLDER, and this is the test
     * that matters most: the shape after the folder is what a reader computes to
     * find a submission, so getting it wrong uploads successfully to somewhere
     * nothing looks. Checked against a live production object —
     * `student_submissions/0pDZ…/BTpRtz4EW001Kfd86uch_RwUzSRxhKpykyWrfX8g8_1.jpg`
     * — which is folder / uid / programme _ assignment _ slot . ext. Everything
     * after the folder is copied from it verbatim.
     */
    it('builds production\'s path shape', () => {
      const path = service().pathFor(target(), slot({ submissionId: 3 }), 'photo.jpg');

      expect(path).toBe('teacher_submissions/teacher-1/prog-1_asg-1_3.jpg');
    });

    /**
     * THE FOLDER IS RENAMED, DELIBERATELY, and pinned so the divergence stays a
     * decision rather than drift.
     *
     * Production calls it `student_submissions` and files teacher uploads there
     * alongside student ones. This app has no students — nothing models one and
     * every upload is the signed-in teacher's — so a folder named for students
     * holding only teacher files misleads whoever opens the bucket. The cost is
     * that production's own report screens would not find these files, and that
     * cost is already paid: those screens read production's database, not this
     * one.
     */
    it('files under teacher_submissions, NOT production\'s student_submissions', () => {
      expect(SUBMISSION_STORAGE_FOLDER).toBe('teacher_submissions');
    });

    /**
     * THE FIRST SEGMENT IS THE UID, NOT THE TEACHER DOCUMENT ID.
     *
     * Firestore roots a submission on the teacher record; Storage roots it on the
     * account, because the storage rule compares the first segment against
     * `request.auth.uid` and a file's attribution belongs to whoever uploaded it.
     * The two ids are different values in this app, so this is worth pinning:
     * using the record id here would make every upload fail the rule.
     */
    it('keys the folder on the UID, not the teacher record id', () => {
      const path = service().pathFor(
        target({ uid: 'auth-uid-9', teacherDocId: 'teacher-doc-1' }),
        slot({ submissionId: 1 }),
        'photo.jpg'
      );

      expect(path).toBe('teacher_submissions/auth-uid-9/prog-1_asg-1_1.jpg');
      expect(path).not.toContain('teacher-doc-1');
    });

    /** THE EXTENSION IS LOWERCASED, so one slot cannot hold both .JPG and .jpg. */
    it('lowercases the extension', () => {
      expect(service().pathFor(target(), slot(), 'PHOTO.JPG')).toBe(
        'teacher_submissions/teacher-1/prog-1_asg-1_1.jpg'
      );
    });

    /** The last dot wins, so a dotted name does not lose its real extension. */
    it('uses the last extension of a dotted name', () => {
      expect(service().pathFor(target(), slot(), 'my.holiday.photo.png')).toBe(
        'teacher_submissions/teacher-1/prog-1_asg-1_1.png'
      );
    });

    /** No extension, no trailing dot — a path ending in '.' is not a filename. */
    it('leaves no trailing dot for a file with no extension', () => {
      expect(service().pathFor(target(), slot(), 'README')).toBe(
        'teacher_submissions/teacher-1/prog-1_asg-1_1'
      );
    });

    /**
     * THE CLASSROOM IS IN NEITHER THE FOLDER NOR THE NAME, which is production's
     * and is worth pinning precisely because it is surprising: two classrooms on
     * one programme share a path, so the second upload replaces the first. Copied
     * rather than corrected, because its own screens compute this string.
     */
    it('does not distinguish two classrooms on one programme', () => {
      const one = service().pathFor(target({ classroomId: 'class-1' }), slot(), 'a.jpg');
      const two = service().pathFor(target({ classroomId: 'class-9' }), slot(), 'a.jpg');

      expect(one).toBe(two);
    });
  });
});

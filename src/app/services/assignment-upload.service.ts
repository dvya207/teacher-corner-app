import { Injectable, inject } from '@angular/core';
import { arrayUnion, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable } from 'firebase/storage';

import { storage } from '../core/firebase';
import { submissionSummaryDoc } from '../core/firestore-paths';
import { UploadSlot } from '../models/teaching.model';
import { ConfigurationService } from './configuration.service';

/**
 * `teacher_submissions/{uid}/{programmeId}_{assignmentId}_{submissionId}.{ext}`
 *
 * A DELIBERATE DIVERGENCE FROM PRODUCTION, and the one place in this app that
 * takes one. Production's folder is `student_submissions`, and its TEACHER
 * uploads go in there too — the folder predates the split between the two
 * surfaces and both write into it. Verified against a live object:
 * `student_submissions/0pDZGzHV3IgQyez1NFFtUPVyyol1/BTpRtz4EW001Kfd86uch
 * _RwUzSRxhKpykyWrfX8g8_1.jpg`.
 *
 * IT IS RENAMED HERE BECAUSE THIS APP HAS NO STUDENTS. Nothing in this database
 * models one, every upload is made by the signed-in teacher, and the assignment
 * report reads teacher submissions rather than production's `Students`
 * collection. A folder called `student_submissions` holding nothing but teacher
 * uploads misleads whoever opens the bucket next.
 *
 * WHAT THE DIVERGENCE COSTS. Production's own report screens look in
 * `student_submissions`, so a file written here is not somewhere they would find
 * it. That cost is already paid: those screens read production's database, not
 * this one, and this app's report was repointed at teacher submissions for the
 * same reason.
 *
 * THE FIRST SEGMENT IS THE UID, NOT THE TEACHER DOCUMENT ID. Ownership in
 * Storage is the path — the rules compare it against `request.auth.uid` — and a
 * file's attribution belongs to the account that uploaded it. Firestore roots on
 * the teacher record; Storage roots on the account. The two differ on purpose.
 */
export const SUBMISSION_STORAGE_FOLDER = 'teacher_submissions';

/** PRODUCTION'S HARD CEILING, in bytes: `event.size > 3145728`, so 3MB. */
export const SUBMISSION_MAX_BYTES = 3 * 1024 * 1024;

/** Which slot on which assignment, for which unit. */
export interface UploadTarget {
  uid: string;
  /**
   * The TEACHER RECORD's document id — the root the submission is written under.
   *
   * SEPARATE FROM [uid], and they are different values. The uid identifies the
   * ACCOUNT and still stamps `teacherId` and the Storage path; this identifies
   * the teacher RECORD, which is what production roots submissions on. Resolved
   * once by the caller rather than looked up here, so one submit costs one query
   * and not three.
   */
  teacherDocId: string;

  classroomId: string;
  programmeId: string;
  /** '' outside a workflow, which changes the KEY the record is written under. */
  workflowId: string;
  assignmentId: string;
}

export interface UploadOutcome {
  /** The stored path, on success. */
  path?: string;
  /** What to tell the reader, when it did not work. */
  error?: string;
}

/**
 * Uploading a file against an upload assignment's slot.
 *
 * WHAT PRODUCTION DOES, read off `assignment-step.component.ts` and confirmed
 * against its live data rather than inferred:
 *
 *   1. The chosen file is checked against `Configuration/acceptedUploadFormats`
 *      `.formats[uploadFileType.toLowerCase()]` and against a 3MB ceiling.
 *   2. It goes to
 *      `teacher_submissions/{uid}/{programmeId}_{assignmentId}_{submissionId}.{ext}`
 *      with `customMetadata.original_name` carrying the file's real name.
 *   3. The path is recorded on the SAME summary document the quiz writes to —
 *      `submissions/{classroomId}-{programmeId}` — under a nested key naming the
 *      workflow, the assignment and the slot.
 *   4. A `versions.…attempt{N}` copy is kept, and a `submissionMeta` entry is
 *      appended to an ARRAY.
 *
 * THE PATH CARRIES NO TIMESTAMP, WHICH MEANS A RE-UPLOAD OVERWRITES. That is
 * production's behaviour and it is why `versions` exists: the Storage object is
 * replaced, and the record of each attempt is what survives. Kept as found —
 * a unique path per attempt would leave production's own screens reading a path
 * that no longer matches what it computes.
 *
 * THE SIZE LIMIT IS 3MB REGARDLESS OF THE SLOT'S OWN `maxFileSize`, and the two
 * disagree loudly: a VIDEO slot says 200mb and production refuses anything over 3.
 * Both are enforced, the smaller one wins, and the message names which — because a
 * reader looking at a field that says 200mb needs to be told why 4mb was refused.
 *
 * IT WILL BE DENIED UNTIL THE BUCKET'S RULES GRANT IT. helix-staging-india has one
 * bucket shared between several apps and its live ruleset has no
 * `teacher_submissions` path. A refusal is reported in words rather than thrown,
 * the same way ResourceUploadService reports one.
 */
@Injectable({ providedIn: 'root' })
export class AssignmentUploadService {

  private config = inject(ConfigurationService);

  /**
   * The extensions this slot accepts, for the file picker's `accept` attribute.
   *
   * EMPTY FOR AN UNKNOWN TYPE, which lets the picker offer everything and leaves
   * the refusal to `validate`. The alternative — an `accept` of nothing — makes a
   * native file dialog show no files at all, which reads as a broken button.
   */
  acceptedExtensions(slot: UploadSlot): readonly string[] {
    const type = (slot.uploadFileType ?? '').toLowerCase();

    return this.config.uploadExtensions()[type] ?? [];
  }

  /**
   * THE SMALLER OF THE TWO CEILINGS, in megabytes.
   *
   * The slot names one and production enforces 3MB, and they are wildly apart on a
   * video slot. Taking the smaller is the only answer that does not promise
   * something the upload will then refuse.
   */
  limitMb(slot: UploadSlot): number {
    const hard = SUBMISSION_MAX_BYTES / (1024 * 1024);
    const declared = Number(slot.maxFileSize);

    return Number.isFinite(declared) && declared > 0 ? Math.min(declared, hard) : hard;
  }

  /**
   * Whether this file may be uploaded, and why not.
   *
   * TWO SEPARATE MESSAGES, because the two failures need different actions: a
   * wrong type means pick a different file, a large one means shrink it. Production
   * shows one string for both ("Invalid file type/ Exceeding size limit"), which
   * leaves the reader guessing which of its two halves applied.
   */
  validate(file: File, slot: UploadSlot): string {
    const extensions = this.acceptedExtensions(slot);
    const extension = extensionOf(file.name);

    if (extensions.length > 0 && !extensions.includes(extension)) {
      return `${extension || 'That file'} is not accepted here. This slot takes ${extensions.join(', ')}.`;
    }

    const limit = this.limitMb(slot) * 1024 * 1024;

    if (file.size > limit) {
      const size = (file.size / (1024 * 1024)).toFixed(1);
      const hard = SUBMISSION_MAX_BYTES / (1024 * 1024);
      const because =
        this.limitMb(slot) === hard && Number(slot.maxFileSize) > hard
          ? ` The slot says ${slot.maxFileSize}MB, but submissions are capped at ${hard}MB.`
          : '';

      return `That file is ${size}MB. The limit is ${this.limitMb(slot)}MB.${because}`;
    }

    return '';
  }

  /**
   * Where the file goes.
   *
   * PRODUCTION'S OWN CONCATENATION, `{programmeId}_{assignmentId}_{submissionId}`
   * with the original extension. Note it is the PROGRAMME in the name and the
   * TEACHER in the folder; the classroom appears in neither, which means two
   * classrooms on one programme share a path and the second upload replaces the
   * first. That is production's, and changing it would put this app's files where
   * its screens do not look.
   */
  pathFor(where: UploadTarget, slot: UploadSlot, fileName: string): string {
    const extension = extensionOf(fileName).replace('.', '');
    const base = `${where.programmeId}_${where.assignmentId}_${slot.submissionId}`;

    return `${SUBMISSION_STORAGE_FOLDER}/${where.uid}/${base}${extension ? `.${extension}` : ''}`;
  }

  /**
   * The path already stored for this slot, or ''.
   *
   * READ OFF THE SUMMARY DOCUMENT rather than probed in Storage, because the
   * document is the record: a file can exist in the bucket from an attempt whose
   * Firestore write failed, and showing View for one of those would offer a file
   * this app never successfully recorded.
   */
  async storedPath(where: UploadTarget, slot: UploadSlot): Promise<string> {
    const snapshot = await getDoc(
      submissionSummaryDoc(where.teacherDocId, where.classroomId, where.programmeId)
    );

    if (!snapshot.exists()) {
      return '';
    }

    const scope = snapshot.data()[scopeKey(where)] as
      | Record<string, Record<string, { submissionPath?: string }>>
      | undefined;

    return (
      scope?.[`assignmentId_${where.assignmentId}`]?.[`submissionId_${slot.submissionId}`]
        ?.submissionPath ?? ''
    );
  }

  /**
   * Uploads the file and records it.
   *
   * THE RECORD IS WRITTEN AFTER THE FILE LANDS, not before. A record pointing at a
   * path with no object behind it renders a View link that 404s, which is worse
   * than no record: the reader believes their work is submitted.
   *
   * MERGED, NEVER SET WHOLE. One summary document holds every assignment and every
   * quiz attempt for a classroom and programme — a whole-document write here would
   * take the rest of them with it. The nested keys are written as one object and
   * merged, which Firestore applies field by field.
   */
  async upload(
    file: File,
    where: UploadTarget,
    slot: UploadSlot
  ): Promise<UploadOutcome> {
    const invalid = this.validate(file, slot);

    if (invalid) {
      return { error: invalid };
    }

    const path = this.pathFor(where, slot, file.name);

    try {
      await uploadBytesResumable(ref(storage, path), file, {
        /* THE REAL FILE NAME, kept as metadata because the stored path throws it
           away — production does the same, and it is the only way back to what the
           teacher actually chose. */
        customMetadata: { original_name: file.name }
      });
    } catch (error) {
      return { error: describeStorage(error) };
    }

    try {
      await this.record(path, where, slot, file);
    } catch (error) {
      /* THE FILE IS UP AND THE RECORD IS NOT, and that is said rather than
         glossed: the reader must know to try again, because nothing on this page
         will show the file until a record exists. */
      return {
        error:
          'The file uploaded, but recording it failed, so it will not appear here. Try again.' +
          ` (${describeFirestore(error)})`
      };
    }

    return { path };
  }

  /**
   * Writes production's nested record.
   *
   * `timeTaken` IS NULL, and that is what production's own live documents carry on
   * the submissions checked. Its player derives it from a per-step countdown this
   * app does not run, and a made-up duration on a submission record is worse than
   * an honest absence.
   *
   * `clientIp` IS EMPTY for the same reason it is on a quiz attempt: production
   * fills it from a device-info lookup this app has no equivalent of, and writes
   * '' itself when that lookup fails, so an empty string is a value its readers
   * already handle.
   */
  private async record(
    path: string,
    where: UploadTarget,
    slot: UploadSlot,
    file: File
  ): Promise<void> {
    const summary = submissionSummaryDoc(
      where.teacherDocId,
      where.classroomId,
      where.programmeId
    );

    const attempt = (await this.attemptsFor(where)) + 1;

    const entry = {
      submissionPath: path,
      type: slot.uploadFileType,
      timeTaken: null
    };

    const assignmentKey = `assignmentId_${where.assignmentId}`;
    const slotKey = `submissionId_${slot.submissionId}`;
    const scope = scopeKey(where);

    await setDoc(
      summary,
      {
        [scope]: {
          [assignmentKey]: {
            lastAttemptTime: serverTimestamp(),
            userAgent: globalThis.navigator?.userAgent ?? '',
            clientIp: '',
            [slotKey]: entry
          }
        },
        teacherId: where.uid,
        /*
         * EVERY ATTEMPT IS KEPT, which is the whole point of this branch of the
         * shape: the Storage path has no timestamp in it, so a re-upload REPLACES
         * the object. Without `versions` there would be no record that an earlier
         * submission ever existed.
         */
        versions: {
          [scope]: {
            [assignmentKey]: {
              [`attempt${attempt}`]: {
                attemptNumber: attempt,
                lastAttemptTime: serverTimestamp(),
                userAgent: globalThis.navigator?.userAgent ?? '',
                clientIp: '',
                originalName: file.name,
                [slotKey]: entry
              }
            }
          }
        },
        createdAt: serverTimestamp(),
        /*
         * AN ARRAY HERE, A SUBCOLLECTION FOR A QUIZ, IN THE SAME DOCUMENT — and
         * both are production's. Its upload path appends with arrayUnion; its quiz
         * path writes `submissionMeta/{autoId}`. Two shapes under one name is not a
         * design anybody would choose, and matching each where it is used is what
         * keeps its own readers working.
         */
        submissionMeta: arrayUnion({ clientIp: '', submissionTime: new Date() })
      },
      { merge: true }
    );
  }

  /**
   * How many attempts this assignment already has recorded.
   *
   * COUNTED FROM `versions`, not from a counter field, because there is no counter
   * — production reads `previousAttempts`, initialises it to 0 in `ngOnInit` and
   * never updates it, so every one of its uploads writes `attempt1` and overwrites
   * the last. Counting the keys is what makes the history it clearly intended.
   */
  private async attemptsFor(where: UploadTarget): Promise<number> {
    const snapshot = await getDoc(
      submissionSummaryDoc(where.teacherDocId, where.classroomId, where.programmeId)
    );

    if (!snapshot.exists()) {
      return 0;
    }

    const versions = snapshot.data()['versions'] as
      | Record<string, Record<string, Record<string, unknown>>>
      | undefined;

    const attempts =
      versions?.[scopeKey(where)]?.[`assignmentId_${where.assignmentId}`] ?? {};

    return Object.keys(attempts).filter(key => key.startsWith('attempt')).length;
  }
}

/**
 * WHICH KEY THE RECORD HANGS UNDER: the workflow, or the programme.
 *
 * PRODUCTION BRANCHES ON EXACTLY THIS — `workflowId_{id}` when the assignment was
 * reached through a workflow, `programmeId_{id}` when it was not — and both forms
 * are in its live data. The stepper always has a workflow, so this app writes the
 * first; the fallback exists because a workflow that has never been saved has no
 * id yet, and a record keyed `workflowId_` with nothing after it would be
 * unreadable.
 */
function scopeKey(where: UploadTarget): string {
  return where.workflowId
    ? `workflowId_${where.workflowId}`
    : `programmeId_${where.programmeId}`;
}

/** '.pdf' from 'Observations.PDF', lowercased. '' when there is no dot. */
function extensionOf(fileName: string): string {
  const at = fileName.lastIndexOf('.');

  return at > 0 ? fileName.slice(at).toLowerCase() : '';
}

/** What a Storage refusal means, in words a row can show. */
function describeStorage(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';

  if (code === 'storage/unauthorized') {
    return 'The storage bucket refused this upload. Its rules do not allow submissions yet.';
  }

  if (code === 'storage/canceled') {
    return 'The upload was cancelled.';
  }

  if (code === 'storage/retry-limit-exceeded') {
    return 'The upload timed out. Check your connection and try again.';
  }

  return 'The upload failed. Try again.';
}

/** And a Firestore refusal, for the record that follows it. */
function describeFirestore(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';

  return code === 'permission-denied'
    ? 'the database refused the write'
    : code || 'unknown error';
}

import { Injectable, inject } from '@angular/core';
import {
  Timestamp,
  deleteDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'firebase/firestore';

import { db } from '../core/firebase';
import {
  activeClassroomDoc,
  newActiveClassroomDoc,
  trashClassroomDoc,
  activeClassroomsCollection,
  trashClassroomsCollection
} from '../core/firestore-paths';
import { composeClassroomName, nextClassroomCode } from '../data/classroom-options';
import {
  Classroom,
  ClassroomDraft,
  ClassroomProgramme,
  Programme,
  TRASH_METADATA_FIELDS,
  TrashedClassroom
} from '../models/teaching.model';
import { AuthService } from './auth.service';

/**
 * Fills in fields a stored classroom may predate, and flattens production's
 * two-variant shape into this app's always-present one.
 *
 * A document written by teachercorner.thinktac.com has NO `stemClubName` key at
 * all if it is a classroom, and no `grade`/`section`/`classroomName` if it is a
 * club — production deletes them. Reading one of those straight into the
 * interface leaves undefined behind, and the first save that copies a key off
 * the loaded object fails the whole write with "Unsupported field value:
 * undefined". Normalising on the way IN means nothing downstream has to know
 * which variant it is holding.
 */
export function normaliseClassroom<T extends { docId: string }>(
  docId: string,
  data: Record<string, unknown>
): T {
  return {
    ...data,
    docId,
    classroomId: (data['classroomId'] as string | undefined) ?? docId,
    classroomCode: (data['classroomCode'] as string | undefined) ?? '',
    type: data['type'] === 'STEM-CLUB' ? 'STEM-CLUB' : 'CLASSROOM',
    classroomName: (data['classroomName'] as string | undefined) ?? '',
    stemClubName: (data['stemClubName'] as string | undefined) ?? '',
    // String() rather than ?? '': production stores numeric grades as numbers,
    // so an imported row arrives as 8 where this app expects '8'.
    grade: data['grade'] === undefined || data['grade'] === null ? '' : String(data['grade']),
    section: (data['section'] as string | undefined) ?? '',
    board: (data['board'] as string | undefined) ?? '',
    institutionId: (data['institutionId'] as string | undefined) ?? '',
    institutionName: (data['institutionName'] as string | undefined) ?? '',
    programmes: (data['programmes'] as Record<string, ClassroomProgramme> | undefined) ?? {},
    studentCounter: (data['studentCounter'] as number | undefined) ?? 0,
    studentCredentialStoragePath:
      (data['studentCredentialStoragePath'] as string | undefined) ?? ''
  } as unknown as T;
}

/**
 * Removes the trash bookkeeping, leaving the original document.
 *
 * Exported and tested directly, as its institution counterpart is: a restore
 * that carried trashAt back into the live collection would leave a row that
 * looks deleted but is not, and nothing in the UI would show it.
 */
export function stripTrashMetadata(
  trashed: Record<string, unknown>
): Record<string, unknown> {
  const restored = { ...trashed };

  for (const field of TRASH_METADATA_FIELDS) {
    delete restored[field];
  }

  return restored;
}

/**
 * The four fields a classroom keeps about a programme.
 *
 * Exported because both writers need it and they must agree: the Add form
 * attaches programmes at creation and Manage Programmes rewrites them later. If
 * the two shapes drifted, editing a classroom would silently drop whichever
 * field the other one wrote.
 *
 * production's `workflowIds` and `sequentiallyLocked` are deliberately NOT
 * carried. They belong to the learning-unit locking flow, which this app does
 * not have, and writing keys nothing here maintains would leave them stale.
 */
export function toClassroomProgramme(programme: Programme): ClassroomProgramme {
  return {
    programmeId: programme.programmeId,
    programmeName: programme.programmeName,
    programmeCode: programme.programmeCode,
    displayName: programme.displayName?.trim() || programme.programmeName
  };
}

/** The programmes map keyed by id, which is the shape Firestore stores. */
export function toProgrammeMap(programmes: Programme[]): Record<string, ClassroomProgramme> {
  return Object.fromEntries(
    programmes.map(programme => [programme.programmeId, toClassroomProgramme(programme)])
  );
}

@Injectable({
  providedIn: 'root'
})
export class ClassroomService {

  private auth = inject(AuthService);

  /**
   * Every LIVE classroom the signed-in teacher owns, newest first.
   *
   * No "not deleted" filter, because deleted rows are not in this collection at
   * all — that is the point of moving them rather than flagging them.
   */
  async list(): Promise<Classroom[]> {
    const snapshot = await getDocs(activeClassroomsCollection());

    return snapshot.docs
      .map(document => normaliseClassroom<Classroom>(document.id, document.data()))
      .sort((a, b) => (b.creationDate?.toMillis?.() ?? 0) - (a.creationDate?.toMillis?.() ?? 0));
  }

  /** Everything in the teacher's classroom trash, most recently deleted first. */
  async listTrash(): Promise<TrashedClassroom[]> {
    const snapshot = await getDocs(trashClassroomsCollection());

    return snapshot.docs
      .map(document => normaliseClassroom<TrashedClassroom>(document.id, document.data()))
      .sort((a, b) => (b.trashAt?.toMillis?.() ?? 0) - (a.trashAt?.toMillis?.() ?? 0));
  }

  /**
   * Creates a classroom owned by the signed-in teacher.
   *
   * `existing` is the caller's already-loaded list, passed in rather than
   * re-read, and is used for one thing: computing the next per-institution
   * classroomCode. Passing it keeps this method free of a second query on the
   * hot path, and makes the sequencing testable without a database.
   *
   * classroomName is composed HERE rather than on the form, so a classroom
   * created by any future caller gets the same "8 B" that production writes.
   */
  async create(draft: ClassroomDraft, existing: Classroom[]): Promise<Classroom> {
    const uid = this.auth.requireUid();
    const reference = newActiveClassroomDoc();
    const isClub = draft.type === 'STEM-CLUB';

    const payload = {
      ...draft,
      docId: reference.id,
      classroomId: reference.id,
      classroomCode: nextClassroomCode(existing, draft.institutionId),
      ownerId: uid,

      // The variant that does not apply is stored EMPTY rather than omitted —
      // see the note on the Classroom interface.
      classroomName: isClub ? '' : composeClassroomName(draft.grade, draft.section),
      stemClubName: isClub ? draft.stemClubName.trim() : '',
      grade: isClub ? '' : draft.grade,
      section: isClub ? '' : draft.section,

      studentCounter: 0,
      studentCredentialStoragePath: '',

      creationDate: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(reference, payload);

    /**
     * A LOCAL timestamp on the object handed back, not the server one.
     * serverTimestamp() is a sentinel that resolves server-side only, so the
     * written value is not readable here. The list is patched with this so the
     * new row appears immediately; the next load replaces it with the
     * authoritative value.
     */
    const now = Timestamp.now();

    return { ...payload, creationDate: now, createdAt: now, updatedAt: now } as Classroom;
  }

  /**
   * Saves the tabbed editor's changes.
   *
   * A PARTIAL update: the modal emits only the fields it changed, so a Basic
   * Info edit does not rewrite the programmes map and a programmes edit does not
   * rewrite the grade. Writing the whole working copy would push back fields the
   * user never opened, which is the bug the institution service's per-tab update
   * exists to avoid.
   *
   * The identity fields are stripped rather than trusted: docId and classroomId
   * mirror the path, ownerId is stripped because it is not this
   * method's to change — the rule requires it to match what is already stored,
   * so sending it can only ever be a no-op or a rejection, classroomCode is allocated per
   * school at creation, and creationDate/createdAt are set once.
   *
   * `programmes`, when present, is a WHOLE-MAP write rather than a merge. The
   * Programmes tab shows the complete Selected list, so removing a programme
   * there has to remove it from the document; a merge would only ever add.
   */
  async update(docId: string, patch: Partial<Classroom>): Promise<void> {
    const {
      docId: _docId,
      classroomId: _classroomId,
      classroomCode: _code,
      ownerId: _ownerId,
      type: _type,
      institutionId: _institutionId,
      institutionName: _institutionName,
      creationDate: _creationDate,
      createdAt: _createdAt,
      ...fields
    } = patch;

    const defined = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined)
    );

    if (Object.keys(defined).length === 0) {
      return;
    }

    await updateDoc(activeClassroomDoc(docId), { ...defined, updatedAt: serverTimestamp() });
  }

  /**
   * Moves a classroom from the live collection to the trash. ATOMIC.
   *
   *   classrooms/{docId} -> classrooms/trash/DeletedClassrooms/{docId}
   *
   * A transaction rather than two sequential writes, for the reason its
   * institution counterpart is one: copy-then-delete has a window where the tab
   * closes between the two, leaving the SAME classroom in both collections —
   * visible in the list AND in the trash, with a restore that would then
   * overwrite the live copy.
   *
   * The entire document body crosses verbatim, so a restore returns fields this
   * app does not render yet.
   */
  async moveToTrash(docId: string): Promise<TrashedClassroom> {
    // Throws if signed out, before any read is attempted.
    this.auth.requireUid();
    const activeRef = activeClassroomDoc(docId);
    const trashRef = trashClassroomDoc(docId);

    return runTransaction(db, async transaction => {
      const snapshot = await transaction.get(activeRef);

      if (!snapshot.exists()) {
        // Someone else deleted it, or it never existed. Aborting leaves the
        // trash untouched rather than creating an entry with no source.
        throw new Error('That classroom no longer exists.');
      }

      const trashed = { ...snapshot.data(), docId, trashAt: serverTimestamp() };

      transaction.set(trashRef, trashed);
      transaction.delete(activeRef);

      return { ...trashed, trashAt: Timestamp.now() } as TrashedClassroom;
    });
  }

  /**
   * Restores a classroom from the trash. ATOMIC, and the exact mirror of
   * moveToTrash.
   *
   * updatedAt is deliberately NOT touched: a restore returns the document to
   * its previous state rather than counting as an edit of it.
   */
  async restore(docId: string): Promise<Classroom> {
    // Throws if signed out, before any read is attempted — the same guard
    // moveToTrash carries. Without it a stale session reaches Firestore and
    // the permission-denied comes back indistinguishable from a lost race.
    this.auth.requireUid();
    const activeRef = activeClassroomDoc(docId);
    const trashRef = trashClassroomDoc(docId);

    return runTransaction(db, async transaction => {
      const snapshot = await transaction.get(trashRef);

      if (!snapshot.exists()) {
        throw new Error('That classroom is no longer in the trash.');
      }

      const restored = stripTrashMetadata(snapshot.data());

      transaction.set(activeRef, restored);
      transaction.delete(trashRef);

      return normaliseClassroom<Classroom>(docId, restored);
    });
  }

  /**
   * Permanent. Deletes from the TRASH subcollection only — a live classroom can
   * never be destroyed in one step, which is what makes a misclick recoverable.
   */
  async purge(docId: string): Promise<void> {
    // Same guard as restore: fail on the session, not on the write.
    this.auth.requireUid();
    await deleteDoc(trashClassroomDoc(docId));
  }

  /**
   * Empties the trash.
   *
   * Promise.all rather than allSettled: if any delete fails the caller needs to
   * know and re-read, because the local list can no longer be trusted.
   */
  async purgeAll(docIds: string[]): Promise<void> {
    await Promise.all(docIds.map(docId => this.purge(docId)));
  }

  describeError(error: unknown, fallback: string): string {
    const code = (error as { code?: string })?.code ?? '';

    if (code === 'permission-denied') {
      /**
       * Two very different causes share this code. The ownership rules read
       * resource.data.ownerId, which does not exist for a document that is not
       * there — so touching a row someone else already deleted is DENIED rather
       * than reported as missing. permission-denied is the expected outcome of
       * a race, not only of an undeployed ruleset.
       */
      return 'Could not complete that — the classroom may have just been ' +
             'deleted in another tab, or the Firestore rules for this app are ' +
             'not deployed. Reload to see the current state.';
    }

    if (code === 'unavailable') {
      return 'Could not reach the database. Check your connection and retry.';
    }

    // Transaction aborts surface their own message, already written for a
    // human ("That classroom no longer exists.").
    const message = (error as { message?: string })?.message;
    return message && !message.startsWith('FIREBASE') ? message : fallback;
  }
}

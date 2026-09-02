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
  assignmentDoc,
  newAssignmentDoc,
  ownedAssignments,
  ownedTrashAssignments,
  trashAssignmentDoc
} from '../core/firestore-paths';
import {
  Assignment,
  AssignmentDraft,
  AssignmentType,
  TRASH_METADATA_FIELDS,
  TrashedAssignment,
  emptyFormPayload,
  emptyQuizPayload,
  emptyUploadPayload
} from '../models/teaching.model';
import { AuthService } from './auth.service';

/**
 * Fills the fields a production document does not carry.
 *
 * The same defence normaliseInstitution and normaliseClassroom exist for, and
 * for the same reason: production writes only the fields a given dialog
 * collects, so a document read straight into the interface leaves `undefined`
 * behind — which the type system cannot see and which Firestore rejects outright
 * on the way back in ("Unsupported field value: undefined").
 *
 * `type` is UPPERCASED on the way in. Production's own table does the same
 * (`(a?.type || '').toString().toUpperCase()`), which is the tell that mixed-case
 * values exist in the data.
 */
export function normaliseAssignment<T extends Assignment>(
  docId: string,
  data: Record<string, unknown>
): T {
  const type = String(data['type'] ?? '').toUpperCase() as AssignmentType;

  const base = {
    ...data,
    docId: String(data['docId'] ?? docId),
    displayName: String(data['displayName'] ?? ''),
    type,
    status: String(data['status'] ?? ''),
    creator: String(data['creator'] ?? ''),
    author: String(data['author'] ?? ''),
    ownerId: String(data['ownerId'] ?? ''),
    createdAt: (data['createdAt'] as Timestamp) ?? null,
    updatedAt: (data['updatedAt'] as Timestamp) ?? null
  };

  /*
   * THE PAYLOAD IS FILLED PER TYPE, and the defaults come FIRST so a stored value
   * always wins. A production document carries only what its dialog collected —
   * the `--default_assignments--` row, for instance, has four keys and no status
   * at all — so reading one straight into the interface leaves `undefined` on
   * every field it omits. That is the trap normaliseInstitution exists for: the
   * type cannot see it, and Firestore rejects the whole write on the way back in.
   *
   * An UNKNOWN type falls through with no payload. It keeps its base fields, so
   * it still counts in the total and renders a row, and nothing pretends it is one
   * of the three.
   */
  switch (type) {
    case 'QUIZ':
      return { ...emptyQuizPayload(), ...base } as T;
    case 'UPLOAD':
      return { ...emptyUploadPayload(), ...base } as T;
    case 'FORM':
      return { ...emptyFormPayload(), ...base } as T;
    default:
      return base as T;
  }
}

/**
 * Removes every `undefined`, at any depth.
 *
 * WHY THIS EXISTS. Firestore rejects `undefined` anywhere in a value tree and
 * fails the WHOLE write with "Unsupported field value: undefined". An assignment
 * is deeply nested — `questionsData[].options[]`, `.blanks{}[]`, `.subParts[]` —
 * so one absent field on one option kills the save, and the message names a path
 * rather than a cause.
 *
 * A SAFETY NET, NOT THE FIX. The wizard is careful not to invent absent keys (see
 * its `clone`), and it earned that care by getting it wrong: a copy that wrote
 * `options: undefined` onto a TEXT question made Update Quiz fail silently on a
 * document that was otherwise valid. This is here because these documents also
 * round-trip through production, whose own writers this app does not control, and
 * because losing an edit is a worse outcome than dropping a key that was already
 * meaningless.
 *
 * ARRAYS KEEP THEIR LENGTH. An `undefined` entry inside an array becomes `null`
 * rather than being spliced out, because `questionsData` and `workflowIds` are
 * read POSITIONALLY — closing a gap would shift every later entry onto the wrong
 * question.
 */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(entry => (entry === undefined ? null : stripUndefined(entry))) as T;
  }

  if (value !== null && typeof value === 'object') {
    // Timestamps and other class instances must cross unchanged: rebuilding one
    // as a plain object would strip the prototype Firestore recognises.
    if (value.constructor !== Object) {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, stripUndefined(entry)])
    ) as T;
  }

  return value;
}

/** Drops the metadata the trash added, so a restore is byte-identical. */
export function stripTrashMetadata(
  document: Record<string, unknown>
): Record<string, unknown> {
  const copy = { ...document };

  for (const field of TRASH_METADATA_FIELDS) {
    delete copy[field];
  }

  return copy;
}

@Injectable({ providedIn: 'root' })
export class AssignmentService {

  private auth = inject(AuthService);

  /**
   * The signed-in teacher's assignments, newest first.
   *
   * FILTERED BY ownerId, which production's equivalent is not: its
   * getAllAssignmentsLimited reads the whole collection. This app's rules require
   * the filter — every top-level query here carries it, and the isolation suite
   * fails a query that does not — so the two cannot be identical here. The
   * consequence is real and worth knowing: a teacher sees the assignments they
   * created, not every assignment in the project.
   *
   * SORTED IN MEMORY on `updatedAt`, not with orderBy. An orderBy alongside the
   * ownerId `where` needs a composite index, and the collection is small enough
   * that the read is the cost rather than the sort.
   */
  async list(): Promise<Assignment[]> {
    const snapshot = await getDocs(ownedAssignments(this.auth.requireUid()));

    return snapshot.docs
      .map(document => normaliseAssignment<Assignment>(document.id, document.data()))
      .sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
  }

  async listTrash(): Promise<TrashedAssignment[]> {
    const snapshot = await getDocs(ownedTrashAssignments(this.auth.requireUid()));

    return snapshot.docs
      .map(document => normaliseAssignment<TrashedAssignment>(document.id, document.data()))
      .sort((a, b) => (b.trashAt?.toMillis?.() ?? 0) - (a.trashAt?.toMillis?.() ?? 0));
  }

  /**
   * Creates one, and hands back what was written.
   *
   * `docId` is stored as a FIELD as well as being the path, which is production's
   * convention throughout — its table reads `assignment?.docId` rather than the
   * snapshot id, so a document without it renders a blank ID line.
   */
  async create(draft: AssignmentDraft): Promise<Assignment> {
    const uid = this.auth.requireUid();
    const reference = newAssignmentDoc();

    const payload = {
      ...draft,
      displayName: draft.displayName.trim(),
      author: draft.author.trim(),
      creator: draft.creator.trim(),
      docId: reference.id,
      ownerId: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(reference, stripUndefined(payload));

    /* A LOCAL timestamp on the object handed back. serverTimestamp() is a
       sentinel that resolves server-side only, so the written value is not
       readable here; the list is patched with this so the new row appears
       immediately, and the next load replaces it with the authoritative one. */
    const now = Timestamp.now();

    return { ...payload, createdAt: now, updatedAt: now } as Assignment;
  }

  /**
   * Edits one. PARTIAL: only the fields given are written.
   *
   * The identity fields are stripped rather than trusted — docId mirrors the
   * path, ownerId is not this method's to change (the rule requires it to match
   * what is stored, so sending it can only be a no-op or a rejection), and
   * createdAt is set once.
   */
  async update(docId: string, patch: Partial<Assignment>): Promise<void> {
    const {
      docId: _docId,
      ownerId: _ownerId,
      createdAt: _createdAt,
      ...fields
    } = patch;

    const defined = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined)
    );

    if (Object.keys(defined).length === 0) {
      return;
    }

    await updateDoc(
      assignmentDoc(docId),
      stripUndefined({ ...defined, updatedAt: serverTimestamp() })
    );
  }

  /**
   * Moves one to the trash. ATOMIC.
   *
   *   Assignments/{docId} -> Assignments/--trash--/DeletedAssignments/{docId}
   *
   * A transaction rather than two sequential writes, for the reason its four
   * counterparts are: copy-then-delete has a window where the tab closes between
   * the two, leaving the SAME row in both collections — visible in the list AND
   * in the trash, with a restore that would then overwrite the live copy.
   *
   * The entire document body crosses verbatim, so a restore returns fields this
   * app does not render — a quiz's questions among them.
   */
  async moveToTrash(docId: string): Promise<void> {
    const live = assignmentDoc(docId);
    const dead = trashAssignmentDoc(docId);

    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(live);

      if (!snapshot.exists()) {
        throw new Error('That assignment no longer exists.');
      }

      transaction.set(dead, { ...snapshot.data(), trashAt: serverTimestamp() });
      transaction.delete(live);
    });
  }

  /** The same move, back. `trashAt` is dropped on the way. */
  async restore(docId: string): Promise<void> {
    const live = assignmentDoc(docId);
    const dead = trashAssignmentDoc(docId);

    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(dead);

      if (!snapshot.exists()) {
        throw new Error('That assignment is no longer in the trash.');
      }

      transaction.set(live, stripTrashMetadata(snapshot.data()));
      transaction.delete(dead);
    });
  }

  /** Deletes for good, from the trash only. There is no undo. */
  async purge(docId: string): Promise<void> {
    await deleteDoc(trashAssignmentDoc(docId));
  }

  /**
   * Empties the trash.
   *
   * Issued in parallel — independent documents, so awaiting one at a time would
   * cost the sum of every round trip. Promise.all rather than allSettled: if any
   * delete fails the caller needs to know and re-read, because the local list can
   * no longer be trusted.
   *
   * The same helper every other service here has. This was the one collection
   * whose trash could only be emptied a row at a time.
   */
  async purgeAll(docIds: string[]): Promise<void> {
    await Promise.all(docIds.map(docId => this.purge(docId)));
  }

  /**
   * A message for a failed read or write.
   *
   * The same shape every other service here uses: permission-denied is the one
   * worth naming, because it means the rules refused rather than the network
   * failing, and the two need different responses from whoever reads it.
   */
  describeError(error: unknown, fallback: string): string {
    const code = (error as { code?: string })?.code ?? '';

    if (code === 'permission-denied') {
      return 'You do not have access to these assignments.';
    }

    if (code === 'unavailable') {
      return 'Could not reach the server. Check your connection and retry.';
    }

    return (error as { message?: string })?.message?.trim() || fallback;
  }
}

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
  activeTeacherDoc,
  newActiveTeacherDoc,
  trashTeacherDoc,
  activeTeachersCollection,
  trashTeachersCollection
} from '../core/firestore-paths';
import {
  TRASH_METADATA_FIELDS,
  Teacher,
  TeacherClass,
  TeacherDraft,
  TrashedTeacher
} from '../models/teaching.model';
import { AuthService } from './auth.service';

/**
 * Removes the fields an update must never carry.
 *
 * `docId` mirrors the document path rather than being editable. `ownerId` is
 * pinned by the security rule — including it gets the whole write rejected even
 * when unchanged, because the rule compares incoming to existing. `createdAt` is
 * set once. `institutionId` is here too, and that one is a JUDGEMENT rather than
 * a rule requirement: moving a teacher between schools is a real operation, but
 * it is not an EDIT of their details, and letting a name change carry a school
 * change alongside it is how a teacher silently ends up at the wrong institution.
 *
 * A standalone function rather than a private method so it can be tested
 * directly. It is exactly the kind of guard that is easy to assert against a
 * stub and never actually exercise.
 */
export function stripImmutableTeacherFields(patch: Partial<Teacher>): Partial<Teacher> {
  const { docId, ownerId, institutionId, createdAt, ...fields } = patch;
  return fields;
}

/**
 * Fills in fields a stored document may predate.
 *
 * Casting `document.data()` straight to Teacher is a lie whenever the interface
 * has grown since the row was written: the missing keys read as `undefined`, and
 * the type system cannot see it. That is not hypothetical — it is the bug that
 * broke Save Changes on institutions, where an update built by reading keys off
 * a loaded document sent `undefined` to Firestore, which rejects it outright.
 *
 * Normalising on the way IN means the rest of the app only ever holds a complete
 * Teacher. Any field added from here on needs a default here too.
 */
export function normaliseTeacher<T extends { docId: string }>(
  docId: string,
  data: Record<string, unknown>
): T {
  return {
    ...data,
    docId,
    institutionId: (data['institutionId'] as string | undefined) ?? '',
    firstName: (data['firstName'] as string | undefined) ?? '',
    lastName: (data['lastName'] as string | undefined) ?? '',
    teacherName: (data['teacherName'] as string | undefined) ?? '',
    email: (data['email'] as string | undefined) ?? '',
    countryCode: (data['countryCode'] as string | undefined) ?? '',
    phoneNumber: (data['phoneNumber'] as string | undefined) ?? '',
    role: (data['role'] as string | undefined) ?? '',
    classes: teacherClassesFrom(data),
    active: data['active'] !== false
  } as unknown as T;
}

/**
 * The class list, migrating the single-class shape this collection briefly had.
 *
 * The first teachers written here carried `grade`, `section`, `programmeId` and
 * `programmeName` as four FLAT fields, before the form grew a ⊕ that adds a
 * second class. Those documents are real and must not read back as a teacher who
 * takes nothing, so a flat row is folded into a one-element array here rather
 * than being migrated by a script — the read is the only place that needs to know
 * both shapes ever existed.
 *
 * The legacy keys are deliberately NOT deleted from the stored document. Nothing
 * reads them any more, and rewriting rows to tidy them up would be a migration
 * with nothing to gain.
 */
export function teacherClassesFrom(data: Record<string, unknown>): TeacherClass[] {
  const stored = data['classes'];

  if (Array.isArray(stored)) {
    return stored.map(entry => ({
      grade: (entry as TeacherClass)?.grade ?? '',
      section: (entry as TeacherClass)?.section ?? '',
      programmeId: (entry as TeacherClass)?.programmeId ?? '',
      programmeName: (entry as TeacherClass)?.programmeName ?? ''
    }));
  }

  const legacyGrade = data['grade'] as string | undefined;
  const legacyProgramme = data['programmeId'] as string | undefined;

  if (!legacyGrade && !legacyProgramme) {
    return [];
  }

  return [{
    grade: legacyGrade ?? '',
    section: (data['section'] as string | undefined) ?? '',
    programmeId: legacyProgramme ?? '',
    programmeName: (data['programmeName'] as string | undefined) ?? ''
  }];
}

/**
 * Drops keys whose value is undefined.
 *
 * A second line of defence behind normaliseTeacher: that keeps undefined out of
 * the model, this keeps it out of the write even if some future path builds a
 * patch another way. Firestore treats undefined as an error rather than as
 * "leave this field alone", so one stray key fails the whole update.
 */
export function withoutUndefinedTeacherFields(fields: Partial<Teacher>): Partial<Teacher> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  ) as Partial<Teacher>;
}

/**
 * One class, as a key — grade, section and programme together.
 *
 * The programme NAME is deliberately not part of it: it is a denormalised
 * snapshot, so two entries for the same class written either side of a rename
 * would otherwise read as different classes.
 */
export function classKey(row: TeacherClass): string {
  return `${row.grade}|${row.section}|${row.programmeId}`;
}

/**
 * The existing classes plus the new ones, with duplicates dropped.
 *
 * The FIRST occurrence wins, so a class the teacher already has keeps its stored
 * entry rather than being rewritten by an identical one. Re-submitting the same
 * class is therefore a no-op instead of a growing list of copies — which matters
 * because the lookup makes that easy to do by accident.
 */
export function mergeClasses(
  existing: readonly TeacherClass[],
  additions: readonly TeacherClass[]
): TeacherClass[] {
  const seen = new Set(existing.map(classKey));
  const merged = [...existing];

  for (const row of additions) {
    if (seen.has(classKey(row))) {
      continue;
    }

    seen.add(classKey(row));
    merged.push(row);
  }

  return merged;
}

/** first + last, collapsed. Stored denormalised, as institutions store their representative's. */
export function teacherFullName(first: string, last: string): string {
  return `${(first ?? '').trim()} ${(last ?? '').trim()}`.trim();
}

/**
 * Removes the trash bookkeeping, leaving the original document.
 *
 * Exported and tested directly: a restore that quietly carried trashAt back into
 * the live collection would leave a row that looks deleted but is not, and
 * nothing in the UI would show it.
 */
export function stripTeacherTrashMetadata(
  trashed: Record<string, unknown>
): Record<string, unknown> {
  const restored = { ...trashed };

  for (const field of TRASH_METADATA_FIELDS) {
    delete restored[field];
  }

  return restored;
}

/**
 * Teachers registered against an institution.
 *
 * DELIBERATELY THE SAME SERVICE AS InstitutionService, method for method. Two
 * collections that behave differently for no reason are worse than two that
 * behave identically, and every non-obvious decision here — the ownerId filter,
 * the client-allocated id, serverTimestamp over new Date, delete-as-a-move,
 * the transaction — is explained at length in institution.service.ts. What
 * follows notes only what differs.
 *
 * NO FIREBASE AUTH USER IS CREATED. A Teacher document is a record ABOUT a
 * person, not an identity they can sign in with. Auth is per-PROJECT, so minting
 * accounts here would add users to every other application in the project as
 * well. The email is stored regardless, so an invite flow can be added
 * later without reshaping a single document.
 */
@Injectable({
  providedIn: 'root'
})
export class TeacherService {

  private auth = inject(AuthService);

  /**
   * Every LIVE teacher the signed-in admin owns, newest first.
   *
   * No "not deleted" filter, because deleted rows are not in this collection at
   * all. Not filtered by institution either — see ownedTeachers(): a second
   * where() would need a composite index, and callers narrow client-side on a
   * result that is already owner-scoped.
   */
  async list(): Promise<Teacher[]> {
    const snapshot = await getDocs(activeTeachersCollection());

    return snapshot.docs
      .map(document => normaliseTeacher<Teacher>(document.id, document.data()))
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  }

  /** The teachers of ONE institution, filtered client-side on the owner-scoped list. */
  async listForInstitution(institutionId: string): Promise<Teacher[]> {
    const all = await this.list();

    return all.filter(teacher => teacher.institutionId === institutionId);
  }

  /** Everything in the admin's trash, most recently deleted first. */
  async listTrash(): Promise<TrashedTeacher[]> {
    const snapshot = await getDocs(trashTeachersCollection());

    return snapshot.docs
      .map(document => normaliseTeacher<TrashedTeacher>(document.id, document.data()))
      .sort((a, b) => (b.trashAt?.toMillis?.() ?? 0) - (a.trashAt?.toMillis?.() ?? 0));
  }

  /**
   * Registers one teacher, owned by the signed-in admin.
   *
   * ownerId comes from the session and never from the caller — a caller-supplied
   * owner is a value the user controls, and the rules reject it anyway.
   */
  async create(draft: TeacherDraft): Promise<Teacher> {
    const uid = this.auth.requireUid();
    const reference = newActiveTeacherDoc();

    const payload = {
      ...draft,
      docId: reference.id,
      ownerId: uid,
      teacherName: teacherFullName(draft.firstName, draft.lastName),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(reference, payload);

    /**
     * The returned object carries a LOCAL timestamp, not the server one.
     * serverTimestamp() is a sentinel that only resolves server-side, so the
     * written value is not readable here. Callers patch their list with this so
     * the row appears immediately; the next load replaces it with the
     * authoritative value.
     */
    const now = Timestamp.now();

    return { ...payload, createdAt: now, updatedAt: now } as Teacher;
  }

  /**
   * Registers several at once — what the Set Up Wizard's Submit hands over.
   *
   * SEQUENTIAL, not Promise.all, and that is the deliberate part. A partial
   * failure has to be reportable as "the first three landed, the fourth did
   * not": firing them in parallel and catching at the end leaves the caller
   * unable to say which ones exist, and re-running would duplicate the ones that
   * already succeeded. The cost is one round trip per teacher on a step that
   * runs once per school.
   *
   * NOT a batch write either. A batch would make all-or-nothing true, but it
   * fails whole on one bad row, and the row most likely to be bad is one the
   * user can fix — so failing the other nine with it helps nobody.
   *
   * Throws on the first failure, with everything created so far already
   * committed. `created` is attached to the error so the caller can report
   * exactly how far it got.
   */
  async createMany(drafts: TeacherDraft[]): Promise<Teacher[]> {
    const created: Teacher[] = [];

    for (const draft of drafts) {
      try {
        created.push(await this.create(draft));
      } catch (error) {
        throw Object.assign(
          error instanceof Error ? error : new Error(String(error)),
          { created }
        );
      }
    }

    return created;
  }

  /**
   * Adds classes to a teacher who already exists.
   *
   * WHAT THE PHONE LOOKUP CALLS. Typing a registered number on the Add Teachers
   * form finds that teacher, and submitting then has to extend them rather than
   * write a second document with the same phone number — which is what made this
   * method necessary rather than another create().
   *
   * IDENTITY IS NOT TOUCHED. Only `classes` is written: name, email and role are
   * whatever the teacher already had. The form locks those fields when it
   * recognises a number, so there is nothing here to save.
   *
   * Returns the teacher as it now stands, so the caller can patch its list
   * without a re-read. Returns it UNCHANGED, and writes nothing, when every class
   * offered is already on the document.
   */
  async appendClasses(existing: Teacher, additions: readonly TeacherClass[]): Promise<Teacher> {
    const classes = mergeClasses(existing.classes, additions);

    if (classes.length === existing.classes.length) {
      return existing;
    }

    await updateDoc(activeTeacherDoc(existing.docId), {
      classes,
      updatedAt: serverTimestamp()
    });

    return { ...existing, classes };
  }

  /** Saves an edit. Ownership and school membership are not editable here. */
  async update(docId: string, patch: Partial<Teacher>): Promise<void> {
    const fields = withoutUndefinedTeacherFields(stripImmutableTeacherFields(patch));

    if (Object.keys(fields).length === 0) {
      return;
    }

    if ('firstName' in fields || 'lastName' in fields) {
      fields.teacherName = teacherFullName(fields.firstName ?? '', fields.lastName ?? '');
    }

    await updateDoc(activeTeacherDoc(docId), { ...fields, updatedAt: serverTimestamp() });
  }

  /** In use or not. Its own method, so nothing else can be changed by accident. */
  async setActive(docId: string, active: boolean): Promise<void> {
    await updateDoc(activeTeacherDoc(docId), { active, updatedAt: serverTimestamp() });
  }

  /**
   * Moves a teacher into the trash. ATOMIC.
   *
   *   teachers/{docId} -> teachers/trash/DeletedTeachers/{docId}
   *
   * A transaction, not two sequential writes: copy-then-delete without one has a
   * window where the tab closes between the two, leaving the SAME teacher in
   * both collections — visible in the list AND in the trash, with a restore that
   * would then overwrite the live copy.
   */
  async moveToTrash(docId: string): Promise<TrashedTeacher> {
    // Throws if signed out, before any read is attempted.
    this.auth.requireUid();
    const activeRef = activeTeacherDoc(docId);
    const trashRef = trashTeacherDoc(docId);

    return runTransaction(db, async transaction => {
      const snapshot = await transaction.get(activeRef);

      if (!snapshot.exists()) {
        throw new Error('That teacher no longer exists.');
      }

      const trashed = { ...snapshot.data(), docId, trashAt: serverTimestamp() };

      transaction.set(trashRef, trashed);
      transaction.delete(activeRef);

      return { ...trashed, trashAt: Timestamp.now() } as TrashedTeacher;
    });
  }

  /**
   * Restores from the trash. ATOMIC, and the exact mirror of moveToTrash.
   *
   * updatedAt is deliberately NOT touched: a restore returns the document to its
   * previous state rather than counting as an edit of it.
   */
  async restore(docId: string): Promise<Teacher> {
    const activeRef = activeTeacherDoc(docId);
    const trashRef = trashTeacherDoc(docId);

    return runTransaction(db, async transaction => {
      const snapshot = await transaction.get(trashRef);

      if (!snapshot.exists()) {
        throw new Error('That teacher is no longer in the trash.');
      }

      const restored = stripTeacherTrashMetadata(snapshot.data());

      transaction.set(activeRef, restored);
      transaction.delete(trashRef);

      return normaliseTeacher<Teacher>(docId, restored);
    });
  }

  /**
   * Permanent. Deletes from the TRASH subcollection only, so an active teacher
   * can never be destroyed in one step.
   */
  async purge(docId: string): Promise<void> {
    await deleteDoc(trashTeacherDoc(docId));
  }

  /** Empties the trash. Promise.all, so the caller learns if any delete failed. */
  async purgeAll(docIds: string[]): Promise<void> {
    await Promise.all(docIds.map(docId => this.purge(docId)));
  }

  describeError(error: unknown, fallback: string): string {
    const code = (error as { code?: string })?.code ?? '';

    if (code === 'permission-denied') {
      /**
       * Two very different causes share this code, and the message has to cover
       * both honestly. The ownership rules read resource.data.ownerId, which
       * does not exist for a document that is not there — so acting on a row
       * someone else already deleted is denied rather than reported as missing.
       */
      return 'Could not complete that — the teacher may have just been deleted ' +
             'in another tab, or the Firestore rules for this app are not ' +
             'deployed. Reload and try again.';
    }

    if (code === 'unavailable') {
      return 'Could not reach the database. Check your connection and try again.';
    }

    return error instanceof Error && error.message ? error.message : fallback;
  }
}

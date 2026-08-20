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
  activeInstitutionDoc,
  newActiveInstitutionDoc,
  trashInstitutionDoc,
  activeInstitutionsCollection,
  trashInstitutionsCollection
} from '../core/firestore-paths';
import {
  Institution,
  InstitutionAddress,
  InstitutionDraft,
  TRASH_METADATA_FIELDS,
  TrashedInstitution
} from '../models/teaching.model';
import { AuthService } from './auth.service';

/**
 * Removes the fields an update must never carry.
 *
 * `docId` mirrors the document path rather than being editable. `ownerId` is
 * pinned by the security rule — including it gets the whole write rejected even
 * when unchanged. `createdAt` and `creationDate` are set once.
 *
 * A standalone function rather than a private method so it can be tested
 * directly. It is exactly the kind of guard that is easy to assert against a
 * stub and never actually exercise.
 */
export function stripImmutableFields(patch: Partial<Institution>): Partial<Institution> {
  const { docId, ownerId, createdAt, creationDate, ...fields } = patch;
  return fields;
}

/**
 * An address with every key present and empty.
 *
 * The spread base for normalising a document read back from Firestore: a row
 * written before a key existed simply has no such key, and the interface says
 * otherwise.
 */
const EMPTY_ADDRESS: InstitutionAddress = {
  city: '',
  country: '',
  district: '',
  landmark: '',
  pincode: '',
  state: '',
  street: '',
  subDistrict: '',
  village: ''
};

/**
 * Fills in fields a stored document may predate.
 *
 * WHY THIS EXISTS. Casting `document.data()` straight to Institution is a lie
 * whenever the interface has grown since the row was written: the missing keys
 * read as `undefined`, and the type system cannot see it. That surfaced as a
 * real bug — the edit modal builds its patch by reading keys off the loaded
 * document, so `customerSchool` and `institutionAddress.landmark` went into
 * updateDoc() as undefined, which the SDK rejects outright with "Unsupported
 * field value: undefined". Save Changes failed on every row created before those
 * two fields were added, and the error surfaced behind the modal where nobody
 * could see it.
 *
 * Normalising on the way IN means the rest of the app only ever holds a complete
 * Institution, so no caller has to know which fields are new. Any field added
 * from here on needs a default here too.
 */
export function normaliseInstitution<T extends { docId: string }>(
  docId: string,
  data: Record<string, unknown>
): T {
  return {
    ...data,
    docId,
    customerSchool: data['customerSchool'] === true,
    institutionCode: (data['institutionCode'] as string | undefined) ?? '',
    institutionAddress: {
      ...EMPTY_ADDRESS,
      ...((data['institutionAddress'] as Partial<InstitutionAddress> | undefined) ?? {})
    }
  } as unknown as T;
}

/**
 * Drops keys whose value is undefined.
 *
 * A second line of defence behind normaliseInstitution: that keeps undefined out
 * of the model, and this keeps it out of the write even if some future path
 * builds a patch another way. Firestore treats undefined as an error rather than
 * as "leave this field alone", so one stray key fails the whole update.
 */
export function withoutUndefined(fields: Partial<Institution>): Partial<Institution> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  ) as Partial<Institution>;
}

/** first + last, collapsed. Production stores this denormalised. */
export function representativeName(first: string, last: string): string {
  return `${(first ?? '').trim()} ${(last ?? '').trim()}`.trim();
}

/**
 * Removes the trash bookkeeping, leaving the original document.
 *
 * Exported and tested directly: a restore that quietly carried trashedAt back
 * into the live collection would leave a row that looks deleted but is not, and
 * nothing in the UI would show it.
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

@Injectable({
  providedIn: 'root'
})
export class InstitutionService {

  private auth = inject(AuthService);

  /**
   * Every LIVE institution the signed-in teacher owns.
   *
   * No "not deleted" filter, because deleted rows are not in this collection at
   * all. That is the point of moving them rather than flagging them: a query
   * cannot forget to exclude what is not there.
   *
   * ownedByUser() applies the ownerId filter, which is required rather than
   * tidy: this is a top-level collection whose rule reads resource.data, and
   * Firestore rejects any query it cannot prove will return only permitted
   * documents.
   */
  async list(): Promise<Institution[]> {
    const snapshot = await getDocs(activeInstitutionsCollection());

    return snapshot.docs
      .map(document => normaliseInstitution<Institution>(document.id, document.data()))
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  }

  /** Everything in the teacher's trash, most recently deleted first. */
  async listTrash(): Promise<TrashedInstitution[]> {
    const snapshot = await getDocs(trashInstitutionsCollection());

    return snapshot.docs
      .map(document => normaliseInstitution<TrashedInstitution>(document.id, document.data()))
      .sort((a, b) => (b.trashAt?.toMillis?.() ?? 0) - (a.trashAt?.toMillis?.() ?? 0));
  }

  /**
   * Creates an institution owned by the signed-in teacher.
   *
   * ownerId comes from the session and never from the form — a form-supplied
   * owner is a value the user controls, and the rules reject it anyway.
   *
   * serverTimestamp() rather than new Date(): the client clock can be wrong or
   * deliberately set, and createdAt is what orders the list.
   */
  async create(draft: InstitutionDraft): Promise<Institution> {
    const uid = this.auth.requireUid();
    const reference = newActiveInstitutionDoc();

    const payload = {
      ...draft,
      docId: reference.id,
      ownerId: uid,
      classroomCounter: 0,
      teachersRegistered: 0,
      representativeName: representativeName(
        draft.representativeFirstName,
        draft.representativeLastName
      ),
      createdAt: serverTimestamp(),
      creationDate: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(reference, payload);

    /**
     * The returned object carries a LOCAL timestamp, not the server one.
     * serverTimestamp() is a sentinel that only resolves server-side, so the
     * written value is not readable here. The list is patched with this so the
     * new row appears immediately; the next load replaces it with the
     * authoritative value.
     */
    const now = Timestamp.now();

    return { ...payload, createdAt: now, creationDate: now, updatedAt: now } as Institution;
  }

  /**
   * Saves one tab's worth of fields from the edit modal.
   *
   * A partial update, not a whole-document write: the modal saves per tab, and
   * writing the whole working copy from the Address tab would push back Basic
   * Info fields the user never opened.
   */
  async update(docId: string, patch: Partial<Institution>): Promise<void> {
    const fields = withoutUndefined(stripImmutableFields(patch));

    if (Object.keys(fields).length === 0) {
      return;
    }

    if ('representativeFirstName' in fields || 'representativeLastName' in fields) {
      fields.representativeName = representativeName(
        fields.representativeFirstName ?? '',
        fields.representativeLastName ?? ''
      );
    }

    await updateDoc(activeInstitutionDoc(docId), { ...fields, updatedAt: serverTimestamp() });
  }

  /**
   * The VERIFICATION toggle in the table.
   *
   * Writes `verified` and nothing else. The two booleans on an institution mean
   * different things and are deliberately not wired together: `verified` is the
   * Verified / Unverified state the list filters on, `active` is whether the
   * institution is in use. A single write that touched both would make one
   * unreachable from the UI and silently change the other.
   */
  async setVerified(docId: string, verified: boolean): Promise<void> {
    await updateDoc(activeInstitutionDoc(docId), { verified, updatedAt: serverTimestamp() });
  }

  /**
   * Active / inactive, kept SEPARATE from verification.
   *
   * No control drives this today — the table's toggle became the verification
   * toggle — but the field is still stored, still read, and this is the one place
   * that writes it, so wiring a control to it later needs nothing else.
   */
  async setActive(docId: string, active: boolean): Promise<void> {
    await updateDoc(activeInstitutionDoc(docId), { active, updatedAt: serverTimestamp() });
  }

  /**
   * Moves an institution from schema to trash. ATOMIC.
   *
   *   tcdev_institutions/institutions/schema/{docId}
   *     -> tcdev_institutions/institutions/trash/{docId}
   *
   * A real move, not a flag. After this the document is not in schema at all,
   * so no query has to remember to exclude it and none can accidentally show a
   * deleted institution.
   *
   * A transaction, not two sequential writes, and that is the whole point of
   * this method. Copy-then-delete without one has a window where the network
   * drops or the tab closes between the two, leaving the SAME institution in
   * both collections — visible in the list AND in the trash, with a restore
   * that would then overwrite the live copy. A transaction makes both writes
   * land or neither does.
   *
   * The entire document body is carried across verbatim. Nothing is picked out
   * for display, so a restore returns fields this app does not even render yet.
   */
  async moveToTrash(docId: string): Promise<TrashedInstitution> {
    // Throws if signed out, before any read is attempted.
    this.auth.requireUid();
    const activeRef = activeInstitutionDoc(docId);
    const trashRef = trashInstitutionDoc(docId);

    return runTransaction(db, async transaction => {
      const snapshot = await transaction.get(activeRef);

      if (!snapshot.exists()) {
        // Someone else deleted it, or it never existed. Aborting leaves the
        // trash untouched rather than creating an entry with no source.
        throw new Error('That institution no longer exists.');
      }

      const original = snapshot.data();

      // The whole document, plus production's single trashAt marker.
      const trashed = { ...original, docId, trashAt: serverTimestamp() };

      transaction.set(trashRef, trashed);
      transaction.delete(activeRef);

      return { ...trashed, trashAt: Timestamp.now() } as TrashedInstitution;
    });
  }

  /**
   * Restores an institution from trash back into schema. ATOMIC, and the exact
   * mirror of moveToTrash.
   *
   *   tcdev_institutions/institutions/trash/{docId}
   *     -> tcdev_institutions/institutions/schema/{docId}
   *
   * The trash metadata is stripped, so what lands back in the live collection
   * is byte-identical to what was deleted. updatedAt is deliberately NOT
   * touched: a restore returns the document to its previous state rather than
   * counting as an edit of it.
   */
  async restore(docId: string): Promise<Institution> {
    const activeRef = activeInstitutionDoc(docId);
    const trashRef = trashInstitutionDoc(docId);

    return runTransaction(db, async transaction => {
      const snapshot = await transaction.get(trashRef);

      if (!snapshot.exists()) {
        throw new Error('That institution is no longer in the trash.');
      }

      const restored = stripTrashMetadata(snapshot.data());

      transaction.set(activeRef, restored);
      transaction.delete(trashRef);

      return normaliseInstitution<Institution>(docId, restored);
    });
  }

  /**
   * Permanent. There is no recovering from this one.
   *
   * Deletes from the TRASH subcollection only. An active institution can never
   * be destroyed in one step — it has to be moved to trash first, which is what
   * makes an accidental click recoverable.
   */
  async purge(docId: string): Promise<void> {
    await deleteDoc(trashInstitutionDoc(docId));
  }

  /**
   * Empties the trash.
   *
   * Issued in parallel — independent documents, so awaiting one at a time would
   * cost the sum of every round trip. Promise.all rather than allSettled: if any
   * delete fails the caller needs to know and re-read, because the local list
   * can no longer be trusted.
   */
  async purgeAll(docIds: string[]): Promise<void> {
    await Promise.all(docIds.map(docId => this.purge(docId)));
  }

  describeError(error: unknown, fallback: string): string {
    const code = (error as { code?: string })?.code ?? '';

    if (code === 'permission-denied') {
      /**
       * Two very different causes share this code, and the message has to
       * cover both honestly.
       *
       * The ownership rules read resource.data.ownerId, which does not exist
       * for a document that is not there — so reading a row someone else
       * already deleted is denied rather than reported as missing. That means
       * permission-denied is the expected outcome of a race, not only of an
       * undeployed ruleset.
       */
      return 'Could not complete that — the institution may have just been ' +
             'deleted in another tab, or the Firestore rules for this app are ' +
             'not deployed. Reload to see the current state.';
    }

    if (code === 'unavailable') {
      return 'Could not reach the database. Check your connection and retry.';
    }

    // Transaction aborts surface their own message, which is already written
    // for a human ("That institution no longer exists.").
    const message = (error as { message?: string })?.message;
    return message && !message.startsWith('FIREBASE') ? message : fallback;
  }
}

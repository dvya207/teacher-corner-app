import { Injectable } from '@angular/core';
import {
  FieldPath,
  Timestamp,
  WriteBatch,
  deleteDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch
} from 'firebase/firestore';

import { db } from '../core/firebase';
import {
  learningUnitResourceDoc,
  newLearningUnitResourceDoc,
  resourcesForLearningUnit,
  trashLearningUnitResourceDoc,
  trashLearningUnitResourcesCollection,
  trashedResourcesForLearningUnit
} from '../core/firestore-paths';
import { LEARNING_UNIT_RESOURCE_SCHEMA } from '../data/learning-unit-resource-schema';
import {
  LearningUnit,
  LearningUnitResource,
  TRASH_METADATA_FIELDS,
  TrashedLearningUnitResource
} from '../models/teaching.model';

/**
 * One edit to one slot.
 *
 * Addressed by maturity as well as category and key, because a unit has one
 * resource document per rung and the same slot key exists on more than one.
 */
export interface ResourceSlotEdit {
  maturity: string;
  category: string;
  key: string;
  value: string;
}

/**
 * Reads and writes learningUnitResources — the uploaded files and pasted links
 * a learning unit is made of, one document per maturity rung.
 *
 * WHAT THIS CANNOT DO YET. Uploading. Every file slot needs Cloud Storage, which
 * this app has never used; what it can do is the LINK slots — TAC Video (URL)
 * and its siblings — which are typed, not uploaded, and so need nothing but
 * Firestore.
 *
 * PERMISSION ERRORS ARE SWALLOWED ON READ, deliberately. The rules for this
 * collection are in firestore.rules but have not been deployed, so every query
 * is denied today. A denied read is reported as "this unit has no resource
 * documents", which is indistinguishable from the truth for a unit that has
 * none, and leaves the tabs rendering their empty state instead of an error.
 * The day the rules are deployed this starts working with no code change.
 */
@Injectable({
  providedIn: 'root'
})
export class LearningUnitResourceService {

  /**
   * Every resource document belonging to one unit, keyed by maturity.
   *
   * Keyed rather than listed because that is how the editor asks for them: it
   * shows one rung at a time. Maturity is capitalised on the document — 'Gold' —
   * and that is the key used here, matching what the selector holds.
   */
  async byMaturity(learningUnitDocId: string): Promise<Map<string, LearningUnitResource>> {
    const found = new Map<string, LearningUnitResource>();

    if (!learningUnitDocId) {
      return found;
    }

    let snapshot;

    try {
      snapshot = await getDocs(resourcesForLearningUnit(learningUnitDocId));
    } catch {
      // See the note above: undeployed rules read as "nothing here".
      return found;
    }

    for (const document of snapshot.docs) {
      const resource = normaliseResource(document.id, document.data());
      found.set(resource.maturity, resource);
    }

    return found;
  }

  /**
   * Writes slot edits, one document per maturity touched.
   *
   * A DOTTED FIELD PATH per slot rather than a whole-map write:
   * `resources.video.tacVideoUrl` replaces one leaf and leaves every sibling
   * alone. Writing the map wholesale would drop the slots this app does not
   * show — and there are always some, because the schema's slot list for a rung
   * is wider than any one tab.
   *
   * A rung with no document yet gets one, stamped from the schema for the unit's
   * type so it carries exactly the slots that rung has and no others.
   *
   * ONE BATCH, NOT ONE ROUND TRIP PER RUNG. This awaited an `updateDoc` inside
   * the loop, so saving edits that spanned four maturity rungs meant four
   * sequential server acknowledgements — each one waiting for the last, and each
   * one a full round trip on whatever the connection happened to be. That is
   * what made Save sit on "Saving…" far longer than the single write it looks
   * like. The rungs are independent and already known by this point, so they go
   * up together and the wait is one ack instead of N.
   *
   * It is also atomic now, which the loop was not: a failure halfway through
   * used to leave some rungs written and the rest not, with the modal reporting
   * a single failure for a half-applied save.
   */
  async saveSlots(unit: LearningUnit, edits: readonly ResourceSlotEdit[]): Promise<void> {
    if (edits.length === 0) {
      return;
    }

    const existing = await this.byMaturity(unit.docId);
    const byMaturity = new Map<string, ResourceSlotEdit[]>();

    for (const edit of edits) {
      const forRung = byMaturity.get(edit.maturity) ?? [];
      forRung.push(edit);
      byMaturity.set(edit.maturity, forRung);
    }

    const batch = writeBatch(db);

    for (const [maturity, rungEdits] of byMaturity) {
      const document = existing.get(maturity);

      if (document) {
        const patch: Record<string, unknown> = { updatedAt: serverTimestamp() };

        for (const edit of rungEdits) {
          patch[`resources.${edit.category}.${edit.key}`] = edit.value;
        }

        batch.update(learningUnitResourceDoc(document.docId), patch);
        continue;
      }

      this.stageRung(batch, unit, maturity, rungEdits);
    }

    await batch.commit();
  }

  /**
   * Points a grade-dependent slot at the board documents filed for it.
   *
   * Production's rung document holds, inside the slot,
   * `CBSE: '<a BoardGradeResources document id>'` beside its
   * `universalGradeBoardResourcePath`. Without this the slot reads empty on the
   * rung document even though files exist for it, which is how it looked before.
   *
   * A FieldPath, not a dotted string: the category can be '3S', and a dotted
   * path segment starting with a digit is not a legal field path.
   * `universalGradeBoardResourcePath` is left alone — the sheet collects a file
   * per board and grade, never the universal fallback.
   */
  async linkBoardDocuments(
    unit: LearningUnit,
    maturity: string,
    category: string,
    subCategory: string,
    byBoard: Record<string, string>
  ): Promise<void> {
    const boards = Object.keys(byBoard);

    if (boards.length === 0) {
      return;
    }

    const existing = await this.byMaturity(unit.docId);
    const document = existing.get(maturity);

    if (!document) {
      // No rung document yet: nothing to point at it from. The next save of a
      // plain slot creates one, and filing again will link it.
      return;
    }

    const updates: unknown[] = [];

    for (const board of boards) {
      updates.push(new FieldPath('resources', category, subCategory, board), byBoard[board]);
    }

    await updateDoc(
      learningUnitResourceDoc(document.docId),
      new FieldPath('updatedAt'),
      serverTimestamp(),
      ...updates
    );
  }

  /**
   * A resource document for one rung, stamped from the schema.
   *
   * Created only when something is actually being written into it. Creating all
   * four up front would leave empty documents for rungs a unit may never reach,
   * which is not what production's own tree looks like: it has one per rung the
   * unit has, and no more.
   *
   * STAGES onto the caller's batch rather than writing — the id comes from
   * newLearningUnitResourceDoc(), so it is known before the write and needs no
   * round trip of its own. Renamed from createRung to say so.
   */
  private stageRung(
    batch: WriteBatch,
    unit: LearningUnit,
    maturity: string,
    edits: readonly ResourceSlotEdit[]
  ): void {
    const reference = newLearningUnitResourceDoc();
    const resources = skeletonFor(unit.type, maturity);

    for (const edit of edits) {
      resources[edit.category] = { ...(resources[edit.category] ?? {}), [edit.key]: edit.value };
    }

    // THE EIGHT FIELDS PRODUCTION WRITES TODAY. Not `id`, and not `archives`:
    // both appear only on documents from a 2024-12 to 2025-03 window and on
    // nothing since, so writing them would make a new document look older than
    // the ones beside it. The model reads them where they exist.
    batch.set(reference, {
      docId: reference.id,
      learningUnitDocId: unit.docId,
      learningUnitId: unit.learningUnitId,
      maturity,
      type: unit.type,
      resources,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }

  /* ======================================================================
     Trash

       learningUnitResources/trash/DeletedLearningUnitResources/{docId}

     The same four operations the other trashes expose, and the same rule: the
     deleted document keeps ITS OWN id, so restoring puts it back exactly where
     it was and nothing that referenced it by id has to be rewritten.
     ====================================================================== */

  /**
   * Moves one resource document to the trash. ATOMIC.
   *
   * A transaction rather than a delete-then-write, for the reason the learning
   * unit's own moveToTrash uses one: the two halves must not be separable. A
   * write that lands without the delete leaves the resource visible in both
   * places, and a delete that lands without the write destroys it.
   */
  async moveToTrash(docId: string): Promise<TrashedLearningUnitResource> {
    const activeRef = learningUnitResourceDoc(docId);
    const trashRef = trashLearningUnitResourceDoc(docId);

    return runTransaction(db, async transaction => {
      const snapshot = await transaction.get(activeRef);

      if (!snapshot.exists()) {
        throw new Error('That resource document no longer exists.');
      }

      const trashed = { ...snapshot.data(), docId, trashAt: serverTimestamp() };

      transaction.set(trashRef, trashed);
      transaction.delete(activeRef);

      // serverTimestamp() is a sentinel until it lands, and the caller wants a
      // date it can show now. Close enough for a list ordering, and the next
      // read replaces it with the stored value.
      return normaliseTrashedResource(docId, { ...trashed, trashAt: Timestamp.now() });
    });
  }

  /** Restores one resource document from the trash. The exact mirror. */
  async restore(docId: string): Promise<LearningUnitResource> {
    const activeRef = learningUnitResourceDoc(docId);
    const trashRef = trashLearningUnitResourceDoc(docId);

    return runTransaction(db, async transaction => {
      const snapshot = await transaction.get(trashRef);

      if (!snapshot.exists()) {
        throw new Error('That resource document is no longer in the trash.');
      }

      const restored = stripTrashMetadata(snapshot.data());

      transaction.set(activeRef, restored);
      transaction.delete(trashRef);

      return normaliseResource(docId, restored);
    });
  }

  /** Deletes one trashed resource document for good. */
  async purge(docId: string): Promise<void> {
    await deleteDoc(trashLearningUnitResourceDoc(docId));
  }

  /**
   * Every trashed resource document, newest first.
   *
   * Permission errors are swallowed here for the same reason byMaturity
   * swallows them — see the note on this class. An empty trash and a denied
   * read are indistinguishable to the reader, and the tab's empty state is the
   * honest rendering of both.
   */
  async listTrash(): Promise<TrashedLearningUnitResource[]> {
    let snapshot;

    try {
      snapshot = await getDocs(trashLearningUnitResourcesCollection());
    } catch {
      return [];
    }

    return snapshot.docs
      .map(document => normaliseTrashedResource(document.id, document.data()))
      .sort((a, b) => (b.trashAt?.toMillis?.() ?? 0) - (a.trashAt?.toMillis?.() ?? 0));
  }

  /**
   * Trashes every resource document belonging to one learning unit.
   *
   * A BATCH, not a transaction: a unit has one document per maturity rung, so
   * this is a handful of writes with no read-decide-write step between them —
   * the rungs are already known from the query. A batch is atomic for exactly
   * that shape and does not carry a transaction's retry cost.
   *
   * Returns what it moved, so a caller that also trashed the unit can report
   * the count and, if it has to roll back, knows what to put back.
   */
  async trashAllForUnit(learningUnitDocId: string): Promise<TrashedLearningUnitResource[]> {
    if (!learningUnitDocId) {
      return [];
    }

    let snapshot;

    try {
      snapshot = await getDocs(resourcesForLearningUnit(learningUnitDocId));
    } catch {
      return [];
    }

    if (snapshot.empty) {
      return [];
    }

    const batch = writeBatch(db);
    const moved: TrashedLearningUnitResource[] = [];

    for (const document of snapshot.docs) {
      const trashed = { ...document.data(), docId: document.id, trashAt: serverTimestamp() };

      batch.set(trashLearningUnitResourceDoc(document.id), trashed);
      batch.delete(learningUnitResourceDoc(document.id));
      moved.push(
        normaliseTrashedResource(document.id, { ...trashed, trashAt: Timestamp.now() })
      );
    }

    await batch.commit();

    return moved;
  }

  /**
   * Restores every trashed resource document belonging to one learning unit.
   *
   * The mirror of trashAllForUnit, for a unit coming back out of the trash. It
   * queries the TRASH by learningUnitDocId rather than taking a list of ids,
   * so a unit restored in a later session — where no list survives — recovers
   * its resources too.
   */
  async restoreAllForUnit(learningUnitDocId: string): Promise<LearningUnitResource[]> {
    if (!learningUnitDocId) {
      return [];
    }

    let snapshot;

    try {
      snapshot = await getDocs(trashedResourcesForLearningUnit(learningUnitDocId));
    } catch {
      return [];
    }

    if (snapshot.empty) {
      return [];
    }

    const batch = writeBatch(db);
    const restored: LearningUnitResource[] = [];

    for (const document of snapshot.docs) {
      const data = stripTrashMetadata(document.data());

      batch.set(learningUnitResourceDoc(document.id), data);
      batch.delete(trashLearningUnitResourceDoc(document.id));
      restored.push(normaliseResource(document.id, data));
    }

    await batch.commit();

    return restored;
  }

  /**
   * Deletes for good every TRASHED resource document belonging to one unit.
   *
   * For the unit being purged rather than restored. Without this, purging a
   * unit would leave its resource documents in the resource trash with the unit
   * they name gone from both collections — unreachable from any screen and
   * indistinguishable from a resource waiting to be restored.
   *
   * Returns how many it deleted, so the caller can say so.
   */
  async purgeAllForUnit(learningUnitDocId: string): Promise<number> {
    if (!learningUnitDocId) {
      return 0;
    }

    let snapshot;

    try {
      snapshot = await getDocs(trashedResourcesForLearningUnit(learningUnitDocId));
    } catch {
      return 0;
    }

    if (snapshot.empty) {
      return 0;
    }

    const batch = writeBatch(db);

    for (const document of snapshot.docs) {
      batch.delete(trashLearningUnitResourceDoc(document.id));
    }

    await batch.commit();

    return snapshot.size;
  }
}

/**
 * The empty slot map for a type and rung, straight from the schema.
 *
 * ONLY the slots that combination has. The schema is the same table the tabs
 * render from, so a document stamped here carries exactly what the editor can
 * show and nothing it cannot.
 */
function skeletonFor(type: string, maturity: string): Record<string, Record<string, unknown>> {
  const schema = LEARNING_UNIT_RESOURCE_SCHEMA as unknown as Record<
    string,
    Record<string, Record<string, Record<string, unknown>>>
  >;

  const categories =
    schema[String(type ?? '').replace(/\s+/g, '')]?.[String(maturity ?? '').toLowerCase()];

  if (!categories) {
    return {};
  }

  // Cloned, not referenced: the schema is a frozen shared constant and the
  // caller is about to write into what it gets back.
  return JSON.parse(JSON.stringify(categories)) as Record<string, Record<string, unknown>>;
}

/**
 * Removes the trash bookkeeping, leaving the original document.
 *
 * Duplicated from learning-unit.service.ts rather than shared, on the note
 * given there: each trash names the fields ITS trash adds, and they are only
 * identical for as long as every trash adds exactly `trashAt`.
 */
function stripTrashMetadata(trashed: Record<string, unknown>): Record<string, unknown> {
  const restored = { ...trashed };

  for (const field of TRASH_METADATA_FIELDS) {
    delete restored[field];
  }

  return restored;
}

/** normaliseResource, plus the one field the trash adds. */
function normaliseTrashedResource(
  docId: string,
  data: Record<string, unknown>
): TrashedLearningUnitResource {
  return {
    ...normaliseResource(docId, data),
    trashAt: (data['trashAt'] as Timestamp | undefined) ?? Timestamp.now()
  };
}

/** Fills in fields a stored resource document may predate, as every reader here does. */
function normaliseResource(
  docId: string,
  data: Record<string, unknown>
): LearningUnitResource {
  return {
    ...data,
    docId,
    id: data['id'] as string | undefined,
    learningUnitDocId: (data['learningUnitDocId'] as string | undefined) ?? '',
    learningUnitId: (data['learningUnitId'] as string | undefined) ?? '',
    maturity: (data['maturity'] as string | undefined) ?? '',
    type: (data['type'] as string | undefined) ?? '',
    // Present only on the legacy documents; left undefined rather than
    // defaulted to [], so a write never reintroduces the field.
    archives: Array.isArray(data['archives'])
      ? (data['archives'] as string[]).map(String)
      : undefined,
    resources: (data['resources'] as LearningUnitResource['resources'] | undefined) ?? {},
    createdAt: (data['createdAt'] as Timestamp | undefined) ?? null,
    updatedAt: (data['updatedAt'] as Timestamp | undefined) ?? null
  } as LearningUnitResource;
}

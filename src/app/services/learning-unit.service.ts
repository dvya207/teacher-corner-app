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
  learningUnitDoc,
  newLearningUnitDoc,
  trashLearningUnitDoc,
  learningUnitsCollection,
  trashLearningUnitsCollection
} from '../core/firestore-paths';
import { learningUnitIdOf } from '../data/learning-unit-options';
import { isActiveStatus } from '../data/programme-options';
import {
  LearningUnit,
  LearningUnitDraft,
  PickableUnit,
  TRASH_METADATA_FIELDS,
  TrashedLearningUnit
} from '../models/teaching.model';
import { AuthService } from './auth.service';

/**
 * Fills in fields a stored learning unit may predate.
 *
 * The fourth of these, for the fourth entity, and for the same reason as the
 * first three: casting `document.data()` straight to the interface is a lie the
 * moment the interface grows, the missing keys read as `undefined`, and Firestore
 * rejects undefined outright if that object is ever written back.
 *
 * `difficultyLevel` is coerced with String() and `totalTime` with Number()
 * because production types both as `number | string` and stores both.
 */
export function normaliseLearningUnit<T extends { docId: string }>(
  docId: string,
  data: Record<string, unknown>
): T {
  const name = (data['learningUnitName'] as string | undefined) ?? '';
  const difficulty = data['difficultyLevel'];
  const total = Number(data['totalTime']);

  return {
    ...data,
    docId,
    learningUnitId: (data['learningUnitId'] as string | undefined) ?? docId,
    learningUnitCode: (data['learningUnitCode'] as string | undefined) ?? '',
    learningUnitName: name,
    learningUnitDisplayName:
      (data['learningUnitDisplayName'] as string | undefined)?.trim() || name,
    isoCode: (data['isoCode'] as string | undefined) ?? '',
    version: (data['version'] as string | undefined) ?? '',
    status: (data['status'] as LearningUnit['status'] | undefined) ?? 'LIVE',
    type: (data['type'] as string | undefined) ?? '',
    typeCode: (data['typeCode'] as string | undefined) ?? '',
    // Capital M is production's field name, not a typo — see the interface.
    Maturity: (data['Maturity'] as string | undefined) ?? '',
    subjectCode: (data['subjectCode'] as string | undefined) ?? '',
    subjectName: (data['subjectName'] as string | undefined) ?? '',
    domainCode: (data['domainCode'] as string | undefined) ?? '',
    domainName: (data['domainName'] as string | undefined) ?? '',
    subDomainCode: (data['subDomainCode'] as string | undefined) ?? '',
    subDomainName: (data['subDomainName'] as string | undefined) ?? '',
    compositeCode: (data['compositeCode'] as string | undefined) ?? '',
    tacOwnerName: (data['tacOwnerName'] as string | undefined) ?? '',
    shortDescription: (data['shortDescription'] as string | undefined) ?? '',
    difficultyLevel:
      difficulty === undefined || difficulty === null ? '' : String(difficulty),
    // NaN would render as "NaN" and break the totals; an unparseable time is 0.
    totalTime: Number.isFinite(total) ? total : 0
  } as unknown as T;
}

/**
 * Removes the trash bookkeeping, leaving the original document.
 *
 * Duplicated across the services that have a trash rather than shared: each one
 * names the fields ITS trash adds, and they are only identical for as long as
 * every trash adds exactly `trashAt`.
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
 * Collapses units sharing a code into one pickable row.
 *
 * WHY THIS EXISTS. Production stores ONE LANGUAGE PER DOCUMENT — a unit that
 * exists in Tamil and English is two documents sharing `learningUnitCode`. The
 * programme picker shows one row reading "PT12 DIY Sundial / TA · EN · vV22", so
 * something has to fold the family back together, and doing it here means the
 * picker never has to know the storage shape.
 *
 * The FIRST document of a code wins for name and version, and the languages
 * accumulate. Sorting by code AND THEN BY docId is what makes that
 * deterministic: localeCompare returns 0 for two documents sharing a code, and
 * Array.sort is stable, so sorting by code alone leaves the winner decided by
 * query order — and the winner's docId is what EditProgramme persists into
 * learningUnitsIds, so it decides which language variant a programme references.
 *
 * Only LIVE units are offered — via isActiveStatus, NOT a strict
 * `status === 'LIVE'`. Production data carries both 'LIVE' and 'ACTIVE' in mixed
 * case, which is why that helper exists, and the Learning Units table counts and
 * filters with it. A strict comparison here would show a unit as Live in the
 * table and silently omit it from the picker.
 */
export function toPickableUnits(units: LearningUnit[]): PickableUnit[] {
  const byCode = new Map<string, PickableUnit>();

  const live = units
    .filter(unit => isActiveStatus(unit.status))
    .sort((a, b) =>
      a.learningUnitCode.localeCompare(b.learningUnitCode) ||
      a.docId.localeCompare(b.docId)
    );

  for (const unit of live) {
    // A unit with no code cannot be grouped, so it stands alone under its id.
    const key = unit.learningUnitCode || unit.docId;
    const existing = byCode.get(key);

    if (existing) {
      if (unit.isoCode && !existing.languages.includes(unit.isoCode)) {
        existing.languages.push(unit.isoCode);
      }
      continue;
    }

    byCode.set(key, {
      docId: unit.docId,
      code: unit.learningUnitCode,
      name: unit.learningUnitDisplayName || unit.learningUnitName,
      languages: unit.isoCode ? [unit.isoCode] : [],
      version: unit.version
    });
  }

  return [...byCode.values()];
}

@Injectable({
  providedIn: 'root'
})
export class LearningUnitService {

  private auth = inject(AuthService);

  /** Every LIVE learning unit the teacher owns, newest first. */
  async list(): Promise<LearningUnit[]> {
    const snapshot = await getDocs(learningUnitsCollection());

    return snapshot.docs
      .map(document => normaliseLearningUnit<LearningUnit>(document.id, document.data()))
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  }

  /** Everything in the teacher's learning-unit trash, most recently deleted first. */
  async listTrash(): Promise<TrashedLearningUnit[]> {
    const snapshot = await getDocs(trashLearningUnitsCollection());

    return snapshot.docs
      .map(document =>
        normaliseLearningUnit<TrashedLearningUnit>(document.id, document.data())
      )
      .sort((a, b) => (b.trashAt?.toMillis?.() ?? 0) - (a.trashAt?.toMillis?.() ?? 0));
  }

  /**
   * Creates a learning unit — or a new VERSION of an existing one — owned by the
   * signed-in teacher.
   *
   * There is no separate "add version" path, because there is no difference at
   * this level: a new version is a new document that happens to share
   * `learningUnitCode` with others and carries a higher `version`. Production
   * works the same way, which is why its dialog is titled "Add a New Learning
   * Unit or Version" and why three AE04 cards sit side by side in its list.
   *
   * `learningUnitId` is NOT the document id. Production mints a Firestore id for
   * the document and stores a readable identity beside it —
   * 'TA-AE04-EN-V10' — so the family is legible in an export without a join,
   * while two documents can never collide on the id itself.
   */
  async create(draft: LearningUnitDraft): Promise<LearningUnit> {
    const uid = this.auth.requireUid();
    const reference = newLearningUnitDoc();

    const payload = {
      ...draft,
      learningUnitDisplayName:
        draft.learningUnitDisplayName?.trim() || draft.learningUnitName,
      // Denormalised at creation, as production does: the Trash table's Owner
      // column reads it off the deleted document, where no profile join is
      // possible.
      tacOwnerName: draft.tacOwnerName?.trim() || this.auth.displayName(),
      docId: reference.id,
      learningUnitId: learningUnitIdOf(
        draft.typeCode,
        draft.learningUnitCode,
        // Back to the form's label form ('EN-V10') from the two stored fields.
        `${draft.isoCode}-${draft.version}`
      ),
      ownerId: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(reference, payload);

    // A LOCAL timestamp on the way back: serverTimestamp() is a sentinel that
    // only resolves server-side, so the written value is not readable here.
    const now = Timestamp.now();

    return { ...payload, createdAt: now, updatedAt: now } as LearningUnit;
  }

  /**
   * Saves an edit.
   *
   * The identity fields are stripped rather than trusted: docId and
   * learningUnitId mirror the path, ownerId is stripped because it is not
   * this method's to change — the rule requires it to match what is already
   * stored, so sending it can only ever be a no-op or a rejection — and
   * createdAt is set once.
   */
  async update(docId: string, patch: Partial<LearningUnit>): Promise<void> {
    const {
      docId: _docId,
      learningUnitId: _id,
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

    await updateDoc(learningUnitDoc(docId), { ...defined, updatedAt: serverTimestamp() });
  }

  /**
   * Moves a learning unit into the trash. ATOMIC.
   *
   *   learningUnits/{docId} -> learningUnits/trash/DeletedLearningUnits/{docId}
   *
   * A transaction for the reason its three siblings are: copy-then-delete has a
   * window where the tab closes between the two, leaving the same unit in both
   * collections — offered by the pickers AND sitting in the trash, with a
   * restore that would overwrite the live copy.
   */
  async moveToTrash(docId: string): Promise<TrashedLearningUnit> {
    // Throws if signed out, before any read is attempted.
    this.auth.requireUid();
    const activeRef = learningUnitDoc(docId);
    const trashRef = trashLearningUnitDoc(docId);

    return runTransaction(db, async transaction => {
      const snapshot = await transaction.get(activeRef);

      if (!snapshot.exists()) {
        throw new Error('That learning unit no longer exists.');
      }

      const trashed = { ...snapshot.data(), docId, trashAt: serverTimestamp() };

      transaction.set(trashRef, trashed);
      transaction.delete(activeRef);

      return { ...trashed, trashAt: Timestamp.now() } as TrashedLearningUnit;
    });
  }

  /** Restores from the trash. ATOMIC, and the exact mirror of moveToTrash. */
  async restore(docId: string): Promise<LearningUnit> {
    // Throws if signed out, before any read is attempted — the same guard
    // moveToTrash carries. Without it a stale session reaches Firestore and
    // the permission-denied comes back indistinguishable from a lost race.
    this.auth.requireUid();
    const activeRef = learningUnitDoc(docId);
    const trashRef = trashLearningUnitDoc(docId);

    return runTransaction(db, async transaction => {
      const snapshot = await transaction.get(trashRef);

      if (!snapshot.exists()) {
        throw new Error('That learning unit is no longer in the trash.');
      }

      const restored = stripTrashMetadata(snapshot.data());

      transaction.set(activeRef, restored);
      transaction.delete(trashRef);

      return normaliseLearningUnit<LearningUnit>(docId, restored);
    });
  }

  /** Permanent. Deletes from the TRASH subcollection only. */
  async purge(docId: string): Promise<void> {
    // Same guard as restore: fail on the session, not on the write.
    this.auth.requireUid();
    await deleteDoc(trashLearningUnitDoc(docId));
  }

  /** Empties the trash. */
  async purgeAll(docIds: string[]): Promise<void> {
    await Promise.all(docIds.map(docId => this.purge(docId)));
  }

  describeError(error: unknown, fallback: string): string {
    const code = (error as { code?: string })?.code ?? '';

    if (code === 'permission-denied') {
      return 'Could not complete that — the learning unit may have just been ' +
             'deleted in another tab, or the Firestore rules for this app are ' +
             'not deployed. Reload to see the current state.';
    }

    if (code === 'unavailable') {
      return 'Could not reach the database. Check your connection and retry.';
    }

    const message = (error as { message?: string })?.message;
    return message && !message.startsWith('FIREBASE') ? message : fallback;
  }
}

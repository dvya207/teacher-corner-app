import { Injectable, inject } from '@angular/core';
import {
  Timestamp,
  deleteDoc,
  getDoc,
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
  emptyLearningUnitResources,
  ladderKeysFor,
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
/** A stored id list. A field Firestore has never seen reads back undefined. */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/** A stored timing, coerced the way totalTime is: unparseable or absent is 0. */
function finiteOrZero(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

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
    longDescription: (data['longDescription'] as string | undefined) ?? '',
    alternateShortDescription:
      (data['alternateShortDescription'] as string | undefined) ?? '',
    alternateLongDescription:
      (data['alternateLongDescription'] as string | undefined) ?? '',
    tinyDescription: (data['tinyDescription'] as string | undefined) ?? '',
    learningUnitImage: (data['learningUnitImage'] as string | undefined) ?? '',
    learningUnitPreviewImage:
      (data['learningUnitPreviewImage'] as string | undefined) ?? '',
    // SPREAD, so every key this app does not name survives being read and
    // written back. A document's resources map holds a dozen paths the Images
    // tab never shows, and rebuilding it from the two it does show would delete
    // them.
    resources: {
      ...emptyLearningUnitResources(),
      ...((data['resources'] as Record<string, unknown> | undefined) ?? {})
    } as LearningUnit['resources'],

    // The rest of production's document. Defaulted rather than left absent for
    // the reason every field above is: undefined cannot be written back, so one
    // missing key would fail the whole update.
    makingTime: finiteOrZero(data['makingTime']),
    observationTime: finiteOrZero(data['observationTime']),
    firstLiveDate: (data['firstLiveDate'] as string | undefined) ?? '',
    masterDocId: (data['masterDocId'] as string | undefined) ?? '',
    containsResources: (data['containsResources'] as boolean | undefined) ?? false,
    domain: (data['domain'] as string | undefined) ?? '',
    numberOfTemplates: (data['numberOfTemplates'] as string | undefined) ?? '',
    samples: (data['samples'] as string | undefined) ?? '',
    tools: (data['tools'] as string | undefined) ?? '',
    topicCodes: (data['topicCodes'] as string | undefined) ?? '',
    totalViews: finiteOrZero(data['totalViews']),
    userFeedback: (data['userFeedback'] as string | undefined) ?? '',
    versionNotes: (data['versionNotes'] as string | undefined) ?? '',
    tacOwnerCountryCode: (data['tacOwnerCountryCode'] as string | undefined) ?? '',
    tacOwnerPhoneNumber: (data['tacOwnerPhoneNumber'] as string | undefined) ?? '',
    tacArchitectName: (data['tacArchitectName'] as string | undefined) ?? '',
    tacArchitectCountryCode: (data['tacArchitectCountryCode'] as string | undefined) ?? '',
    tacArchitectPhoneNumber: (data['tacArchitectPhoneNumber'] as string | undefined) ?? '',
    tacMentorName: (data['tacMentorName'] as string | undefined) ?? '',
    tacMentorCountryCode: (data['tacMentorCountryCode'] as string | undefined) ?? '',
    tacMentorPhoneNumber: (data['tacMentorPhoneNumber'] as string | undefined) ?? '',
    associatedLearningUnits: stringList(data['associatedLearningUnits']),
    prerequisiteLearningUnits: stringList(data['prerequisiteLearningUnits']),
    replacementLearningUnits: stringList(data['replacementLearningUnits']),
    similarLearningUnits: stringList(data['similarLearningUnits']),
    tags: stringList(data['tags']),
    additionalResources: Array.isArray(data['additionalResources'])
      ? (data['additionalResources'] as unknown[])
      : [],
    linkedClassroomIds: stringList(data['linkedClassroomIds']),
    linkedProgrammeIds: stringList(data['linkedProgrammeIds']),
    linkedWorkflowIds: stringList(data['linkedWorkflowIds']),
    difficultyLevel:
      difficulty === undefined || difficulty === null ? '' : String(difficulty),
    // NaN would render as "NaN" and break the totals; an unparseable time is 0.
    totalTime: Number.isFinite(total) ? total : 0,
    // The other two timings, defaulted the same way and for the same reason. A
    // document written before these existed reads them as undefined, which
    // Firestore refuses on the way back in.
    exploreTime: finiteOrZero(data['exploreTime']),
    learnTime: finiteOrZero(data['learnTime'])
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
 * The LIVE learning units, as the programme picker's rows.
 *
 * PRODUCTION'S OWN TRANSFORM, which is a filter and a sort and nothing else —
 * learning-list.component.ts does:
 *
 *   allLearningUnits.filter(lu => lu.status === 'LIVE')
 *                   .sort((a, b) => b.creationDate - a.creationDate)
 *
 * NO GROUPING. This used to collapse a code's language variants into one row,
 * on a misreading of production's row meta: "TA · EN · vV22" is
 * typeCode · isoCode · version, not two languages. A unit that exists in Tamil
 * and English is TWO rows in production's panel, and two here — which is the
 * honest shape, because `learningUnitsIds` stores one docId and therefore picks
 * one language variant. Collapsing made that choice invisible.
 *
 * STATUS: isActiveStatus, NOT production's strict `=== 'LIVE'`. Production data
 * carries both 'LIVE' and 'ACTIVE' in mixed case — the Learning Units table
 * counts and filters with that helper, and a strict comparison here would show a
 * unit as Live in the table and silently omit it from the picker. That is a
 * deliberate divergence, and the only one.
 *
 * NEWEST FIRST, as production sorts. A missing createdAt sorts last rather than
 * first, so a document predating the field does not jump the queue.
 */
export function toPickableUnits(units: LearningUnit[]): PickableUnit[] {
  return units
    .filter(unit => isActiveStatus(unit.status))
    .map(unit => ({
      docId: unit.docId,
      code: unit.learningUnitCode,
      name: unit.learningUnitDisplayName || unit.learningUnitName,
      typeCode: unit.typeCode,
      isoCode: unit.isoCode,
      version: unit.version,
      // `?? null`, not the raw value: a document predating the field reads back
      // undefined, and undefined is the one value Firestore refuses outright if
      // the object is ever written again.
      createdAt: unit.createdAt ?? null
    }))
    .sort(
      (a, b) =>
        (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0) ||
        a.code.localeCompare(b.code)
    );
}

@Injectable({
  providedIn: 'root'
})
export class LearningUnitService {

  private auth = inject(AuthService);

  /**
   * Every LIVE learning unit IN THE DATABASE, newest first. NOT the caller's own.
   *
   * NOT OWNER-SCOPED, despite what this comment used to say. See
   * classroom.service.ts list() — the same is true of every collection here, and
   * ownedLearningUnits() is the unused filtered version.
   */
  async list(): Promise<LearningUnit[]> {
    const snapshot = await getDocs(learningUnitsCollection());

    return snapshot.docs
      .map(document => normaliseLearningUnit<LearningUnit>(document.id, document.data()))
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  }

  /**
   * One learning unit, by id.
   *
   * A DIRECT DOCUMENT READ, which is what production's classroom page does —
   * learning-list's getLearningUnits maps each id through `luService.get(id)`
   * rather than scanning the collection.
   *
   * NO STATUS FILTER, deliberately, and unlike toPickableUnits. A unit already
   * ATTACHED to a programme must still render on the classroom page after
   * someone moves it back to development — the class is running it either way,
   * and hiding it would make the programme look shorter than it is. The picker
   * filters on the way IN; this is the way out.
   *
   * Returns null for a missing document, so a stale id in learningUnitsIds is
   * skipped rather than throwing.
   */
  async get(docId: string): Promise<LearningUnit | null> {
    const id = docId.trim();

    if (!id) {
      return null;
    }

    try {
      const snapshot = await getDoc(learningUnitDoc(id));

      return snapshot.exists()
        ? normaliseLearningUnit<LearningUnit>(snapshot.id, snapshot.data())
        : null;
    } catch {
      // A denied read is one missing unit, not a broken page.
      return null;
    }
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
      /*
       * The ladder keys are added HERE, not in the empty draft, because they
       * depend on the maturity the form has just collected. A Silver unit gets
       * `silver` alone and a Gold one `silver` and `gold` — cumulative, the way
       * production's own 1200 units carry them.
       */
      resources: { ...draft.resources, ...ladderKeysFor(draft.Maturity) },
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

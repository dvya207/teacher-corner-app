import { Injectable, inject } from '@angular/core';
import {
  deleteDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'firebase/firestore';

import { db } from '../core/firebase';
import {
  newTrashWorkflowTemplateStepDoc,
  newWorkflowTemplateDoc,
  allTrashWorkflowTemplates,
  allWorkflowTemplates,
  trashWorkflowTemplateDoc,
  workflowTemplateDoc
} from '../core/firestore-paths';
import {
  TrashedWorkflowTemplate,
  WorkflowContent,
  WorkflowStep,
  WorkflowTemplate,
  WorkflowTemplateDraft,
  emptyWorkflowContent,
  emptyWorkflowStep
} from '../models/teaching.model';
import { AuthService } from './auth.service';

/** The fields the trash adds, stripped on restore. */
export const WORKFLOW_TRASH_FIELDS = ['trashAt'] as const;

/**
 * A stored template read into the interface, WITHOUT LOSING WHAT IT ALREADY HAS.
 *
 * Production's documents carry `masterDocId` and `templateId` that this app does
 * not model; the spread keeps them, so editing one here does not strip them.
 *
 * EVERY FIELD DEFAULTED, because documents written before a field existed do not
 * carry it and `undefined` is the one value Firestore refuses outright if such an
 * object is written back. The nested steps and contents are normalised for the
 * same reason: a content block sits three levels down, and one absent key there
 * fails the whole template's write.
 */
export function normaliseWorkflowTemplate(
  docId: string,
  data: Record<string, unknown>
): WorkflowTemplate {
  return {
    ...(data as unknown as WorkflowTemplate),
    docId: (data['docId'] as string) || docId,
    templateId: (data['templateId'] as string) || docId,
    templateName: (data['templateName'] as string) ?? '',
    templateType: (data['templateType'] as string) ?? '',
    learningUnitType: (data['learningUnitType'] as string) ?? '',
    maturity: (data['maturity'] as string) ?? '',
    subject: (data['subject'] as string) ?? '',
    type: (data['type'] as string) ?? '',
    status: (data['status'] as string) ?? '',
    ownerId: (data['ownerId'] as string) ?? '',
    createdAt: (data['createdAt'] as WorkflowTemplate['createdAt']) ?? null,
    updatedAt: (data['updatedAt'] as WorkflowTemplate['updatedAt']) ?? null,
    workflowSteps: normaliseSteps(data['workflowSteps'])
  };
}

/**
 * The steps, sorted by `sequenceNumber` and renumbered from 1.
 *
 * SORTED ON READ because the field is what production orders by, and a document
 * whose array order and sequence numbers disagree would render in one order and
 * save in another. Renumbered because a gap left by an old deletion would put the
 * editor's positions out of step with the stored ones.
 */
function normaliseSteps(value: unknown): WorkflowStep[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(entry => (entry ?? {}) as Record<string, unknown>)
    .map(entry => ({
      ...emptyWorkflowStep(Number(entry['sequenceNumber']) || 0),
      ...entry,
      workflowStepName: (entry['workflowStepName'] as string) ?? '',
      workflowStepDescription: (entry['workflowStepDescription'] as string) ?? '',
      workflowStepDuration:
        (entry['workflowStepDuration'] as number | string | null) ?? '',
      viewUnlab: entry['viewUnlab'] !== false,
      workflowLocation: (entry['workflowLocation'] as string) ?? '',
      allowAccess: (entry['allowAccess'] as WorkflowStep['allowAccess']) ?? '',
      canSkipWorkflowStep:
        (entry['canSkipWorkflowStep'] as WorkflowStep['canSkipWorkflowStep']) ?? null,
      allowArtefactUpload: entry['allowArtefactUpload'] === true,
      scannedArtefacts: Array.isArray(entry['scannedArtefacts'])
        ? (entry['scannedArtefacts'] as unknown[])
        : [],
      contents: normaliseContents(entry['contents'])
    }))
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    .map((step, index) => ({ ...step, sequenceNumber: index + 1 }));
}

function normaliseContents(value: unknown): WorkflowContent[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(entry => (entry ?? {}) as Record<string, unknown>)
    .map(entry => ({
      ...emptyWorkflowContent(),
      ...entry,
      contentName: (entry['contentName'] as string) ?? '',
      contentCategory: (entry['contentCategory'] as string) ?? '',
      contentSubCategory: (entry['contentSubCategory'] as string) ?? '',
      contentType: (entry['contentType'] as string) ?? '',
      resourcePath: (entry['resourcePath'] as string) ?? '',
      gameName: (entry['gameName'] as string) ?? '',
      additionalResourceType: (entry['additionalResourceType'] as string) ?? ''
    }));
}

/**
 * Removes every `undefined` from a value tree, at any depth.
 *
 * FIRESTORE REJECTS `undefined` ANYWHERE and fails the WHOLE write. A template
 * nests three levels — workflowSteps[].contents[] — so one absent field on one
 * content block kills the entire save with an error that names a path rather than
 * a cause. The same net the assignments service carries, and for the same reason.
 *
 * ARRAYS KEEP THEIR LENGTH: `workflowSteps` is read positionally, so splicing out
 * a hole would shift every later step onto the wrong number.
 */
export function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(entry => (entry === undefined ? null : stripUndefined(entry)));
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  // A class instance — a Timestamp, say — crosses unchanged: rebuilding it as a
  // plain object would strip the prototype Firestore recognises.
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return value;
  }

  const out: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      out[key] = stripUndefined(entry);
    }
  }

  return out;
}

/** Drops the trash bookkeeping, so a restored row matches what was deleted. */
export function stripTrashMetadata(
  data: Record<string, unknown>
): Record<string, unknown> {
  const copy = { ...data };

  for (const field of WORKFLOW_TRASH_FIELDS) {
    delete copy[field];
  }

  return copy;
}

/**
 * Workflow templates — reusable blueprints for a learning unit's steps.
 *
 * THE SIXTH COLLECTION BUILT TO THIS SHAPE, and identical to the others where the
 * behaviour is identical on purpose: list by owner, create with a generated id,
 * update by patch, and a trash that MOVES the document rather than flagging it.
 *
 * THE TRASH CONTAINER IS '--trash--', not 'trash'. That is production's spelling
 * for this collection — `WorkflowTemplates/--trash--/DeletedWorkflowTemplates`
 * exists there — and using this app's own 'trash' would put deleted templates
 * somewhere production's tooling cannot see. See PRODUCTION_TRASH_DOC.
 */
@Injectable({ providedIn: 'root' })
export class WorkflowTemplateService {

  private auth = inject(AuthService);

  /** The teacher's own templates, newest first. */
  async list(): Promise<WorkflowTemplate[]> {
    const snapshot = await getDocs(allWorkflowTemplates());

    return snapshot.docs
      .map(document => normaliseWorkflowTemplate(document.id, document.data()))
      .sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
  }

  /** Everything in the trash, most recently deleted first. */
  async listTrash(): Promise<TrashedWorkflowTemplate[]> {
    const snapshot = await getDocs(allTrashWorkflowTemplates());

    return snapshot.docs
      .map(document => ({
        ...normaliseWorkflowTemplate(document.id, document.data()),
        trashAt: document.data()['trashAt']
      }) as TrashedWorkflowTemplate)
      .sort((a, b) => (b.trashAt?.toMillis?.() ?? 0) - (a.trashAt?.toMillis?.() ?? 0));
  }

  /**
   * Creates one, and returns it as the caller can render it immediately.
   *
   * `templateId` IS THE DOC ID, which is production's own redundancy: every one of
   * its templates carries the two equal. `status: 'LIVE'` because that is the only
   * status in the collection.
   */
  async create(draft: WorkflowTemplateDraft): Promise<WorkflowTemplate> {
    const uid = this.auth.requireUid();
    const reference = newWorkflowTemplateDoc();

    const payload = {
      ...draft,
      docId: reference.id,
      templateId: reference.id,
      ownerId: uid,
      status: draft.status || 'LIVE',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(reference, stripUndefined(payload) as Record<string, unknown>);

    return normaliseWorkflowTemplate(reference.id, {
      ...payload,
      createdAt: null,
      updatedAt: null
    } as unknown as Record<string, unknown>);
  }

  /**
   * Patches one.
   *
   * The identity fields are stripped rather than trusted: a form-supplied `docId`
   * or `ownerId` could only be wrong, and letting one through would move a
   * document out of its owner's reach.
   */
  async update(docId: string, patch: Partial<WorkflowTemplate>): Promise<void> {
    const {
      docId: _docId,
      templateId: _templateId,
      ownerId: _ownerId,
      createdAt: _createdAt,
      ...fields
    } = patch;

    const defined = stripUndefined({ ...fields, updatedAt: serverTimestamp() }) as Record<
      string,
      unknown
    >;

    await updateDoc(workflowTemplateDoc(docId), defined);
  }

  /**
   * Moves one to the trash. ATOMIC.
   *
   *   WorkflowTemplates/{docId} -> WorkflowTemplates/--trash--/DeletedWorkflowTemplates/{docId}
   *
   * A transaction because it is two writes that must both land: a delete without
   * the copy loses the template, and a copy without the delete leaves it in both
   * places, with a restore that would then overwrite the live one.
   */
  /**
   * Records steps that a save is about to discard.
   *
   * THE SAME REASON AS THE WORKFLOW ONE, and the same shape:
   * `WorkflowTemplates/--trash--/DeletedWorkflowTemplateSteps`. A step is an entry
   * in an array, so removing one and saving overwrites the array — nothing was
   * deleted, so no trash held it, and there is no undo in the rail.
   *
   * BEST EFFORT. A failure here must not fail the save; the caller catches.
   */
  async trashSteps(
    steps: readonly WorkflowStep[],
    where: { templateId: string; templateName: string }
  ): Promise<void> {
    if (steps.length === 0) {
      return;
    }

    await Promise.all(
      steps.map(step =>
        setDoc(
          newTrashWorkflowTemplateStepDoc(),
          stripUndefined({
            ...where,
            step,
            trashAt: serverTimestamp()
          }) as Record<string, unknown>
        )
      )
    );
  }

  async moveToTrash(docId: string): Promise<void> {
    const live = workflowTemplateDoc(docId);
    const dead = trashWorkflowTemplateDoc(docId);

    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(live);

      if (!snapshot.exists()) {
        throw new Error('That workflow template no longer exists.');
      }

      transaction.set(dead, { ...snapshot.data(), trashAt: serverTimestamp() });
      transaction.delete(live);
    });
  }

  /** The same move, back. `trashAt` is dropped on the way. */
  async restore(docId: string): Promise<void> {
    const live = workflowTemplateDoc(docId);
    const dead = trashWorkflowTemplateDoc(docId);

    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(dead);

      if (!snapshot.exists()) {
        throw new Error('That workflow template is no longer in the trash.');
      }

      transaction.set(live, stripTrashMetadata(snapshot.data()));
      transaction.delete(dead);
    });
  }

  /** Deletes for good, from the trash only. There is no undo. */
  async purge(docId: string): Promise<void> {
    await deleteDoc(trashWorkflowTemplateDoc(docId));
  }

  /**
   * Empties the trash.
   *
   * Issued in parallel — independent documents, so awaiting one at a time would
   * cost the sum of every round trip. Promise.all rather than allSettled: a
   * failure means the caller has to re-read, because the local list can no longer
   * be trusted.
   */
  async purgeAll(docIds: string[]): Promise<void> {
    await Promise.all(docIds.map(docId => this.purge(docId)));
  }

  /**
   * A message for a failed read or write.
   *
   * permission-denied is the one worth naming: it means the rules refused rather
   * than the network failing, and the two need different responses from whoever
   * reads it.
   */
  describeError(error: unknown, fallback: string): string {
    const code = (error as { code?: string })?.code ?? '';

    if (code === 'permission-denied') {
      return (
        'Could not complete that — the template may have just been deleted in ' +
        'another tab, or the Firestore rules for workflow templates are not ' +
        'deployed. Reload to see the current state.'
      );
    }

    if (code === 'unavailable') {
      return 'The database is unreachable. Check the connection and try again.';
    }

    return fallback;
  }
}

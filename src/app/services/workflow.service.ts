import { Injectable, inject } from '@angular/core';
import {
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
  activeClassroomDoc,
  newTrashWorkflowStepDoc,
  newWorkflowDoc,
  trashWorkflowDoc,
  trashWorkflowsCollection,
  workflowDoc
} from '../core/firestore-paths';
import {
  ClassroomProgramme,
  ClassroomProgrammeWorkflow,
  TrashedWorkflow,
  Workflow,
  WorkflowDraft,
  WorkflowStep,
  WorkflowTrashOrigin
} from '../models/teaching.model';
import { normaliseWorkflowTemplate, stripUndefined } from './workflow-template.service';

/**
 * What this app puts in `createdSource`.
 *
 * PRODUCTION'S FIELD, ITS CONVENTION, A NEW VALUE. Every one of its nine values
 * names the flow that made the workflow — 'set-up-wizard',
 * 'unlab-contest-registration' — so a workflow made here has to say so rather than
 * borrow a label describing something else. It is provenance, and provenance that
 * lies is worse than none.
 */
export const WORKFLOW_CREATED_SOURCE = 'teacher-corner-classroom-stepper';

/**
 * Whether this is running on a developer's machine.
 *
 * PRODUCTION RECORDS THIS ON EVERY WORKFLOW (397 of 398) and it earns its place:
 * it is how a document created while testing can be told apart from a real one
 * afterwards. Computed from the hostname rather than from a build flag so it stays
 * true when a production build is served locally.
 */
function isLocalHost(): boolean {
  const host = globalThis.location?.hostname ?? '';

  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/**
 * Workflows — a template instantiated for one learning unit in one classroom.
 *
 * THE LOOKUP IS INDIRECT, and that is the shape of the feature rather than an
 * inconvenience. Nothing queries this collection: the classroom holds
 * `programmes[programmeId].workflowIds[]`, one entry per learning unit, and the
 * entry's `workflowId` is the document id. So reaching a workflow means reading
 * the classroom first, and a unit whose entry has `workflowId: ''` — or no entry
 * at all — simply has no workflow yet.
 *
 * WHY NOT A QUERY. `workflows` has no classroom field on it; production's
 * documents carry `linkedClassrooms`, but as a map with no index behind it. The
 * classroom's own array is the authoritative link in both apps, and using it means
 * this app and production disagree about nothing.
 */
@Injectable({ providedIn: 'root' })
export class WorkflowService {

  private classrooms = inject(ClassroomWorkflowLink);

  /**
   * Reads one workflow.
   *
   * `null` FOR A MISSING DOCUMENT rather than a throw: a classroom entry can name
   * a workflow that has since been deleted, and the honest answer to "what is this
   * unit's workflow" is then "there isn't one" — which is the same state as never
   * having had one, and the page already renders it.
   */
  async get(workflowId: string): Promise<Workflow | null> {
    const snapshot = await getDoc(workflowDoc(workflowId));

    if (!snapshot.exists()) {
      return null;
    }

    return normaliseWorkflow(snapshot.id, snapshot.data());
  }

  /**
   * Creates a workflow and LINKS IT TO THE CLASSROOM, in that order.
   *
   * THE ORDER MATTERS AND SO DOES THE FAILURE MODE. A workflow written but not
   * linked is invisible — nothing can find it again, because the classroom's array
   * is the only route to it — so the link is written immediately after and any
   * failure there is surfaced rather than swallowed. The reverse order would be
   * worse: a link to a document that does not exist reads as a deleted workflow.
   *
   * NOT A TRANSACTION, deliberately. The two writes are to different collections
   * and the classroom document is large; a failed link leaves an orphan workflow,
   * which costs a document and nothing else, while a transaction here would make
   * every save contend on the whole classroom.
   */
  async create(
    draft: WorkflowDraft,
    link: { classroomId: string; programmeId: string; learningUnitId: string }
  ): Promise<Workflow> {
    const reference = newWorkflowDoc();

    const document = {
      ...draft,
      docId: reference.id,
      /* THE ID TWICE, which is production's own redundancy on every one of its
         workflow documents. Kept so a document written here reads identically. */
      workflowId: reference.id,

      /*
       * PRODUCTION'S OWN THREE PROVENANCE FIELDS, measured across 398 of its real
       * documents. See the model for why the `--schema--` sentinel was not the
       * source: it lists two fields no real document carries.
       */
      createdSource: WORKFLOW_CREATED_SOURCE,
      isLocalHost: isLocalHost(),
      /* EMPTY, as all 324 of production's are. Vestigial; the classroom's own
         `workflowIds` is the link. Written so the shape matches. */
      linkedClassrooms: {},

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(reference, stripUndefined(document) as Record<string, unknown>);
    await this.classrooms.link(link, reference.id);

    return normaliseWorkflow(reference.id, document as Record<string, unknown>);
  }

  /**
   * Replaces the steps on an existing workflow.
   *
   * THE TEMPLATE FIELDS GO WITH THEM. Applying a different template changes what
   * the workflow was made from, so leaving `templateName` pointing at the old one
   * would make the stepper's own dropdown disagree with the document it saved.
   */
  async update(docId: string, draft: WorkflowDraft): Promise<void> {
    await updateDoc(
      workflowDoc(docId),
      stripUndefined({ ...draft, updatedAt: serverTimestamp() }) as Record<string, unknown>
    );
  }

  /**
   * Moves a workflow to the trash and UNLINKS IT FROM THE CLASSROOM.
   *
   * `workflows/--trash--/DeletedWorkflows/{id}`, which is production's own path —
   * matching it means a workflow deleted here appears where its console and
   * tooling already look.
   *
   * THE COPY AND THE DELETE ARE ONE TRANSACTION, so a workflow cannot be removed
   * from the live collection without arriving in the trash. The classroom link is
   * cleared AFTER, deliberately: it is a different document in a different
   * collection, and a transaction spanning both would make every delete contend on
   * the whole classroom. A link left pointing at a trashed workflow reads as "no
   * workflow yet" to the stepper, which is the state it is about to be in anyway.
   *
   * TRASHED, NOT DELETED, because a workflow is a term's worth of a teacher's
   * arrangement of a unit — the same reason templates and assignments get a trash.
   *
   * ==========================================================================
   * WHERE IT CAME FROM IS RECORDED, AND PRODUCTION'S TRASH DOES NOT RECORD IT.
   *
   * Measured, not assumed: production's `Workflows/--trash--/DeletedWorkflows`
   * holds 3912 documents, and of 300 sampled only 8 carry `trashAt` and 8 carry
   * any `linked*` field. A workflow document has no classroom, programme or unit
   * on it — `linkedClassrooms` is `{}` in all 324 that have it, and the trio of
   * `linked*Ids` arrays appears on 13 live documents where it holds HUNDREDS of
   * classrooms, a contest broadcast rather than one unit's link. So nothing in a
   * production trashed workflow says which unit it belonged to.
   *
   * WHICH MEANS PRODUCTION CANNOT RESTORE ONE. The classroom's own
   * `programmes[id].workflowIds[]` is the only route to a workflow, that entry
   * was cleared when the workflow was trashed, and the trashed copy carries no
   * way to work out which entry it was. Its trash is an archive, not a
   * restorable bin.
   *
   * `trashedFrom` IS THIS APP'S ADDITION, and it is what makes Restore a real
   * action rather than a button that puts a document back where nothing can find
   * it. It carries the three ids the link needs. It is additive — production
   * ignores fields it does not read — and it is what the trash view filters on so
   * one unit's deleted workflows cannot be restored onto another unit.
   */
  async moveToTrash(
    docId: string,
    link?: { classroomId: string; programmeId: string; learningUnitId: string }
  ): Promise<void> {
    const live = workflowDoc(docId);
    const dead = trashWorkflowDoc(docId);

    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(live);

      if (!snapshot.exists()) {
        throw new Error('That workflow no longer exists.');
      }

      transaction.set(dead, {
        ...snapshot.data(),
        trashAt: serverTimestamp(),
        /* OMITTED RATHER THAN WRITTEN EMPTY when the caller has no link: an
           absent `trashedFrom` says "unknown", where one full of blanks would
           claim a unit whose id is ''. Firestore refuses undefined outright, so
           the key has to go or carry a value. */
        ...(link ? { trashedFrom: { ...link } } : {})
      });
      transaction.delete(live);
    });

    if (link) {
      await this.classrooms.link(link, '');
    }
  }

  /**
   * The same move, back. `trashAt` is dropped on the way.
   *
   * THE LINK IS RESTORED TOO where the caller supplies one, because a workflow
   * with no entry pointing at it is unreachable — the classroom's array is the
   * only route to it.
   */
  async restore(
    docId: string,
    link?: { classroomId: string; programmeId: string; learningUnitId: string }
  ): Promise<void> {
    const live = workflowDoc(docId);
    const dead = trashWorkflowDoc(docId);
    let recorded: WorkflowTrashOrigin | null = null;

    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(dead);

      if (!snapshot.exists()) {
        throw new Error('That workflow is no longer in the trash.');
      }

      const restored = { ...snapshot.data() };

      recorded = (restored['trashedFrom'] as WorkflowTrashOrigin) ?? null;

      /* BOTH BOOKKEEPING FIELDS GO, so a restored workflow is byte-identical to
         what was deleted rather than carrying a tombstone around with it. */
      delete restored['trashAt'];
      delete restored['trashedFrom'];

      transaction.set(live, restored);
      transaction.delete(dead);
    });

    /*
     * THE RECORDED ORIGIN IS THE FALLBACK, not the override. A caller that names
     * a link means it — restoring into the unit the reader is looking at — and
     * only where it says nothing does the stored origin decide. Neither means the
     * workflow stays unreachable, which is what a plain document-level restore
     * would leave behind.
     */
    const target = link ?? recorded;

    if (target) {
      await this.classrooms.link(target, docId);
    }
  }

  /**
   * Records steps that a save is about to discard.
   *
   * WHY THIS EXISTS. A step is an entry in the `workflowSteps` array, not a
   * document, so removing one and saving overwrites the array — the step is gone
   * and no trash holds it, because nothing was deleted. It was rewritten. That is
   * several minutes of arrangement (the content blocks, their categories, their
   * access levels) discarded by one click on a bin icon in a rail with no undo.
   *
   * BEST EFFORT, AND DELIBERATELY SO. This runs alongside the save, and a failure
   * here must not fail the save: the reader asked to store their steps, not to
   * archive the ones they removed. Errors are swallowed and the caller does not
   * wait on the outcome.
   *
   * ONE DOCUMENT PER REMOVED STEP, carrying where it came from — the workflow, and
   * the classroom, programme and unit — because the step itself names none of
   * those and an archive nothing can attribute is not an archive.
   */
  async trashSteps(
    steps: readonly WorkflowStep[],
    where: {
      workflowId: string;
      classroomId: string;
      programmeId: string;
      learningUnitId: string;
    }
  ): Promise<void> {
    if (steps.length === 0) {
      return;
    }

    await Promise.all(
      steps.map(step =>
        setDoc(
          newTrashWorkflowStepDoc(),
          stripUndefined({
            ...where,
            step,
            trashAt: serverTimestamp()
          }) as Record<string, unknown>
        )
      )
    );
  }

  /** Everything in the trash, most recently deleted first. */
  async listTrash(): Promise<TrashedWorkflow[]> {
    const snapshot = await getDocs(trashWorkflowsCollection());

    return snapshot.docs
      .map(document => ({
        ...normaliseWorkflow(document.id, document.data()),
        trashAt: document.data()['trashAt'],
        /* `null` FOR A WORKFLOW WITH NO RECORDED ORIGIN, which every one trashed
           by production is. The trash view shows those as unattributed and will
           not offer to restore them onto a unit it cannot prove they came from. */
        trashedFrom: (document.data()['trashedFrom'] as WorkflowTrashOrigin) ?? null
      }) as TrashedWorkflow)
      .sort((a, b) => (b.trashAt?.toMillis?.() ?? 0) - (a.trashAt?.toMillis?.() ?? 0));
  }

  /** Gone for good. Only reachable from the trash. */
  async purge(docId: string): Promise<void> {
    await deleteDoc(trashWorkflowDoc(docId));
  }

  /** What the page says when a read or a write is refused. */
  describeError(error: unknown, fallback: string): string {
    const code = (error as { code?: string })?.code ?? '';

    if (code === 'permission-denied') {
      return 'You do not have permission to change this workflow. The Firestore rules for workflows may not be deployed.';
    }

    if (code === 'unavailable') {
      return 'Could not reach the database. Check your connection and try again.';
    }

    return fallback;
  }
}

/**
 * The classroom half of the link, kept separate from the workflow half.
 *
 * A SEPARATE CLASS BECAUSE IT IS A DIFFERENT COLLECTION AND A DIFFERENT RISK. It
 * rewrites one entry inside a map inside a large document, and the guard it needs
 * — never clobber the other entries, never reorder the array — has nothing to do
 * with reading or writing a workflow.
 */
@Injectable({ providedIn: 'root' })
export class ClassroomWorkflowLink {

  /**
   * Finds the classroom's entry for a learning unit, or null.
   *
   * MATCHES ON `learningUnitId`, which is the document id of the unit. Production
   * matches on either that or the unit's own `learningUnitId` code depending on
   * whether it contains a hyphen; this app stores the document id in the entry
   * consistently — `toClassroomProgramme` builds the array from
   * `programme.learningUnitsIds` — so one comparison is enough here and a second
   * would only match a code against an id.
   */
  find(
    programme: ClassroomProgramme | undefined,
    learningUnitId: string
  ): ClassroomProgrammeWorkflow | null {
    return (
      (programme?.workflowIds ?? []).find(
        entry => entry.learningUnitId === learningUnitId
      ) ?? null
    );
  }

  /**
   * Writes a workflow id onto the classroom's entry for one learning unit.
   *
   * UPDATES THE EXISTING ENTRY WHERE THERE IS ONE, and only appends when there is
   * not. The array is POSITIONAL against the programme's `learningUnitsIds` —
   * `toClassroomProgramme` builds it that way and the locking editor reads it back
   * by the same rule — so appending a second entry for a unit that already has one
   * would attach one unit's dates to another. Production appends unconditionally
   * because its array is not pre-seeded; this app's is.
   *
   * THE WHOLE ARRAY IS WRITTEN BACK, not a single index. Firestore cannot update
   * one element of an array in place, and `arrayUnion` would append rather than
   * replace — so the array is read, the one entry changed, and the result written
   * to the programme's own key. Writing `programmes.{id}.workflowIds` by path
   * leaves every other programme on the classroom untouched.
   */
  async link(
    where: { classroomId: string; programmeId: string; learningUnitId: string },
    /** '' UNLINKS, which is what trashing a workflow does. */
    workflowId: string
  ): Promise<void> {
    const reference = activeClassroomDoc(where.classroomId);
    const snapshot = await getDoc(reference);

    if (!snapshot.exists()) {
      throw new Error('That classroom no longer exists.');
    }

    const programmes = ((snapshot.data() as Record<string, unknown>)['programmes'] ??
      {}) as Record<string, ClassroomProgramme>;
    const entries = [...(programmes[where.programmeId]?.workflowIds ?? [])];
    const index = entries.findIndex(
      entry => entry.learningUnitId === where.learningUnitId
    );

    if (index >= 0) {
      entries[index] = { ...entries[index], workflowId };
    } else {
      /*
       * NO ENTRY YET, which happens for a classroom written before this app
       * started seeding the array. The locking fields open as production's own
       * defaults rather than as undefined — Firestore rejects undefined anywhere
       * in the value tree and would fail the whole write.
       */
      entries.push({
        learningUnitId: where.learningUnitId,
        workflowId,
        openAt: '',
        closeAt: '',
        workflowLocked: false
      });
    }

    await updateDoc(reference, {
      [`programmes.${where.programmeId}.workflowIds`]: entries
    });
  }
}

/**
 * A stored workflow read into the interface.
 *
 * THE STEPS GO THROUGH THE TEMPLATE'S OWN NORMALISER, which is the point of doing
 * it this way: a workflow and a template hold the identical `workflowSteps` shape,
 * so a second copy of that logic is how the two would drift — and the step
 * normaliser is where sequence numbers are sorted, renumbered and every content
 * field defaulted.
 */
export function normaliseWorkflow(
  docId: string,
  data: Record<string, unknown>
): Workflow {
  const template = normaliseWorkflowTemplate(docId, data);

  return {
    ...(data as unknown as Workflow),
    docId: (data['docId'] as string) || docId,
    workflowId: (data['workflowId'] as string) || docId,
    templateId: (data['templateId'] as string) ?? '',
    templateName: (data['templateName'] as string) ?? '',
    createdSource: (data['createdSource'] as string) ?? '',
    isLocalHost: data['isLocalHost'] === true,
    linkedClassrooms:
      (data['linkedClassrooms'] as Record<string, unknown>) ?? {},
    workflowSteps: template.workflowSteps,
    createdAt: (data['createdAt'] as Workflow['createdAt']) ?? null,
    updatedAt: (data['updatedAt'] as Workflow['updatedAt']) ?? null
  };
}

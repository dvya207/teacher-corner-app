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
  activeClassroomDoc,
  learningUnitDoc,
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
  ClassroomProgrammeWorkflow,
  LearningUnit,
  Programme,
  TRASH_METADATA_FIELDS,
  TeacherClassroom,
  TrashedClassroom
} from '../models/teaching.model';
import { AuthService } from './auth.service';
import { TeacherService } from './teacher.service';

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
 * What a classroom keeps about a programme — INCLUDING its allotted learning
 * units.
 *
 * Exported because every writer needs it and they must agree: the Add form
 * attaches programmes at creation and the edit dialog rewrites them later. If
 * the two shapes drifted, editing a classroom would silently drop whichever
 * field the other one wrote. add-classroom.ts used to inline these fields rather
 * than call this, which is exactly that drift; it goes through here now.
 *
 * `workflowIds` AND `sequentiallyLocked` ARE NOW WRITTEN. The comment here used
 * to say they were "deliberately NOT carried" because the locking flow did not
 * exist. Two things changed: the flow does exist (programme-locking.ts), and the
 * consequence of not seeding the array was that a classroom stored no record of
 * which learning units it had been allotted at all — so the locking editor had no
 * rows to show and nothing downstream could answer "what is this class working
 * on". Production's structure, verbatim:
 *
 *   classrooms/{id}.programmes.{programmeId} = {
 *     displayName, programmeCode, programmeId, programmeName,
 *     sequentiallyLocked: false,
 *     workflowIds: [ { learningUnitId, workflowId, openAt, closeAt,
 *                      workflowLocked }, … ]
 *   }
 *
 * POSITIONAL AGAINST THE PROGRAMME'S learningUnitsIds, which is production's own
 * rule and not a convenience: its learning-details form builds this array by
 * mapping over `learningUnitsIds` index for index and reading the stored entry at
 * the same index. An array in a different order attaches one unit's dates to
 * another unit.
 *
 * WORKFLOWS THEMSELVES ARE SKIPPED, on instruction. `workflowId` is carried
 * through when a document already has one and written as '' otherwise; nothing
 * here creates a workflow document or a template. That mirrors production's own
 * default (`workflowId: [wf?.workflowId ?? '']`), so a classroom written by this
 * app is readable by production's forms and vice versa.
 *
 * `existing` is the entry ALREADY on the classroom, when there is one. Passing it
 * preserves per-unit locking across a re-save: without it, re-attaching a
 * programme — or any edit that rewrites the map — would silently reset every date
 * and lock on that class to empty.
 */
export function toClassroomProgramme(
  programme: Programme,
  existing?: ClassroomProgramme,
  units?: ReadonlyMap<string, LearningUnit>
): ClassroomProgramme {
  const stored = existing?.workflowIds ?? [];

  return {
    programmeId: programme.programmeId,
    programmeName: programme.programmeName,
    programmeCode: programme.programmeCode,
    displayName: programme.displayName?.trim() || programme.programmeName,
    sequentiallyLocked: existing?.sequentiallyLocked ?? false,
    workflowIds: (programme.learningUnitsIds ?? []).map((learningUnitId, index) => {
      /*
       * THE ID IS CHECKED, not just the index. A stored entry only carries over
       * if it is about the same unit: the programme's unit list can change after
       * the locks were written, and adopting an entry by position alone would
       * move one unit's dates onto whatever now sits at that index. The same
       * guard programme-locking.ts applies when it reads these back.
       */
      const previous = stored[index];
      const aligned =
        previous && (!previous.learningUnitId || previous.learningUnitId === learningUnitId)
          ? previous
          : undefined;

      /*
       * THE SPLIT THAT MATTERS: locking is PRESERVED, description is RE-DERIVED.
       *
       * The dates and locks are the classroom's own data and exist nowhere else,
       * so losing them is unrecoverable. The code, name, type, version and
       * language are a copy of the catalogue, so re-reading them on every write
       * is what keeps a renamed or re-versioned unit from going stale here —
       * carrying the old copy forward would preserve a name the catalogue no
       * longer has.
       */
      const unit = units?.get(learningUnitId);

      return {
        learningUnitId,
        workflowId: aligned?.workflowId ?? '',
        openAt: aligned?.openAt ?? '',
        closeAt: aligned?.closeAt ?? '',
        workflowLocked: aligned?.workflowLocked ?? false,

        /*
         * '' WHEN THE UNIT IS NOT IN THE CATALOGUE, never omitted, and the id is
         * kept regardless. A unit can be trashed while a classroom still
         * references it, and a caller can legitimately pass no catalogue at all —
         * dropping the entry in either case would delete the allotment, which is
         * a far worse answer than an entry that names an id and no title. Falls
         * back to whatever the previous entry recorded, so a re-save without a
         * catalogue does not blank detail that was already there.
         */
        learningUnitCode: unit?.learningUnitCode ?? aligned?.learningUnitCode ?? '',
        learningUnitName:
          unit?.learningUnitDisplayName?.trim() ||
          unit?.learningUnitName ||
          aligned?.learningUnitName ||
          '',
        learningUnitType: unit?.type ?? aligned?.learningUnitType ?? '',
        learningUnitVersion: unit?.version ?? aligned?.learningUnitVersion ?? '',
        learningUnitIsoCode: unit?.isoCode ?? aligned?.learningUnitIsoCode ?? ''
      };
    })
  };
}

/**
 * Indexes a learning-unit catalogue for `toClassroomProgramme`.
 *
 * KEYED BOTH WAYS, by `docId` and by `learningUnitId`. This app always stores
 * docIds in `learningUnitsIds`, but production's own code reads its classroom
 * entries either way —
 *
 *   wfs['learningUnitId'].includes('-') ? … === d.learningUnitId : … === d.docId
 *
 * — because the composite form ('TA-AE04-EN-V10') appears in some documents. A
 * classroom imported from there would otherwise resolve to no unit and be
 * written back with empty detail.
 */
export function indexLearningUnits(
  units: readonly LearningUnit[]
): ReadonlyMap<string, LearningUnit> {
  const index = new Map<string, LearningUnit>();

  for (const unit of units) {
    if (unit.docId) {
      index.set(unit.docId, unit);
    }

    // Second, so a docId collision can never be shadowed by a composite id.
    if (unit.learningUnitId && !index.has(unit.learningUnitId)) {
      index.set(unit.learningUnitId, unit);
    }
  }

  return index;
}

/**
 * The programmes map keyed by id, which is the shape Firestore stores.
 *
 * `existing` is the classroom's current map, threaded through so each entry can
 * keep its own locking. Omitted at creation, where there is nothing to keep.
 */
export function toProgrammeMap(
  programmes: Programme[],
  existing?: Record<string, ClassroomProgramme>,
  units?: ReadonlyMap<string, LearningUnit>
): Record<string, ClassroomProgramme> {
  return Object.fromEntries(
    programmes.map(programme => [
      programme.programmeId,
      toClassroomProgramme(programme, existing?.[programme.programmeId], units)
    ])
  );
}

@Injectable({
  providedIn: 'root'
})
export class ClassroomService {

  private auth = inject(AuthService);
  private teachers = inject(TeacherService);

  /**
   * Every LIVE classroom IN THE DATABASE, newest first. NOT the caller's own.
   *
   * THIS IS NOT OWNER-SCOPED, despite what this comment used to say. Reads
   * authorise on authentication alone, so this returns every classroom any
   * teacher has created. ownerId is still stamped on create; nothing reads it
   * back. ownedClassrooms() in core/firestore-paths.ts is the filtered version
   * and has no callers.
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
  /**
   * One classroom, by id.
   *
   * A DIRECT DOCUMENT READ, not a find over list(): the classroom page is
   * opened by URL — including on a hard refresh or a shared link — and pulling
   * the whole collection to locate one row would scale with everyone else's
   * classrooms rather than with this one.
   *
   * Returns null for a missing document rather than throwing, so the page can
   * say "that classroom no longer exists" instead of showing an error banner
   * that reads like a fault.
   */
  async get(docId: string): Promise<Classroom | null> {
    if (!docId) {
      return null;
    }

    const snapshot = await getDoc(activeClassroomDoc(docId));

    return snapshot.exists()
      ? normaliseClassroom<Classroom>(snapshot.id, snapshot.data())
      : null;
  }

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

    payload.programmes = await this.describeAllottedUnits(payload.programmes);

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

    if (defined['programmes']) {
      defined['programmes'] = await this.describeAllottedUnits(
        defined['programmes'] as Record<string, ClassroomProgramme>
      );
    }

    await updateDoc(activeClassroomDoc(docId), { ...defined, updatedAt: serverTimestamp() });
  }

  /**
   * Fills in WHAT each allotted learning unit is, before the map is written.
   *
   * WHY IN THE SERVICE AND NOT IN EACH CALLER. Four places build this map — Add
   * Classroom, the edit dialog, the setup wizard and registration — and only the
   * first two have a learning-unit catalogue loaded. Threading one through the
   * other two would mean each of them reading the whole collection for a field
   * they never render, and any fifth writer added later would silently store ids
   * with no detail. Doing it here means every write is described, once.
   *
   * READS ONLY THE UNITS IT NEEDS, and only those still missing detail, so a
   * classroom whose map already carries codes and names costs nothing. Each read
   * is a document GET by id — no query, no index.
   *
   * NEVER FAILS THE WRITE. A refused or missing learning unit leaves that entry's
   * detail empty and the allotment intact: the id is the load-bearing part, and
   * losing an allotment because a title could not be read would be a far worse
   * outcome than an entry with no title.
   */
  private async describeAllottedUnits(
    programmes: Record<string, ClassroomProgramme> | undefined
  ): Promise<Record<string, ClassroomProgramme>> {
    if (!programmes) {
      return {};
    }

    const wanted = new Set<string>();

    for (const entry of Object.values(programmes)) {
      for (const workflow of entry.workflowIds ?? []) {
        if (workflow.learningUnitId && !workflow.learningUnitCode) {
          wanted.add(workflow.learningUnitId);
        }
      }
    }

    if (wanted.size === 0) {
      return programmes;
    }

    /*
     * The five fields, read defensively rather than through a normaliser.
     *
     * normaliseClassroom is for CLASSROOMS — running a learning unit through it
     * would fill in classroomName and grade, which is nonsense here — and the
     * learning-unit service's own normaliser would make this service depend on
     * it for five strings. `String(… ?? '')` cannot produce undefined, which is
     * the only property that matters on the way into Firestore.
     */
    const found = new Map<string, ClassroomProgrammeWorkflow>();

    await Promise.all(
      [...wanted].map(async id => {
        try {
          const snapshot = await getDoc(learningUnitDoc(id));

          if (!snapshot.exists()) {
            return;
          }

          const data = snapshot.data();
          const display = String(data['learningUnitDisplayName'] ?? '').trim();

          found.set(id, {
            learningUnitId: id,
            workflowId: '',
            openAt: '',
            closeAt: '',
            workflowLocked: false,
            learningUnitCode: String(data['learningUnitCode'] ?? ''),
            learningUnitName: display || String(data['learningUnitName'] ?? ''),
            learningUnitType: String(data['type'] ?? ''),
            learningUnitVersion: String(data['version'] ?? ''),
            learningUnitIsoCode: String(data['isoCode'] ?? '')
          });
        } catch {
          // Swallowed deliberately — see the note above. The entry keeps its id.
        }
      })
    );

    return Object.fromEntries(
      Object.entries(programmes).map(([programmeId, entry]) => [
        programmeId,
        {
          ...entry,
          workflowIds: (entry.workflowIds ?? []).map(workflow => {
            const described = found.get(workflow.learningUnitId);

            if (!described) {
              return workflow;
            }

            // The workflow's OWN fields win: this only fills in description, and
            // must never touch a date or a lock.
            return {
              ...workflow,
              learningUnitCode: described.learningUnitCode,
              learningUnitName: described.learningUnitName,
              learningUnitType: described.learningUnitType,
              learningUnitVersion: described.learningUnitVersion,
              learningUnitIsoCode: described.learningUnitIsoCode
            };
          })
        }
      ])
    );
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

    const moved = await runTransaction(db, async transaction => {
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

    /*
     * THEN DETACH IT FROM EVERY TEACHER WHO TAUGHT IT.
     *
     * The dashboard cards and the sidebar tree are built from
     * `teachers/{id}.classrooms`, NOT from this collection — so without this a
     * deleted class stayed on both surfaces forever, and re-reading could not
     * help because the data still said the teacher taught it.
     *
     * AFTER the classroom has moved, and not inside the transaction: a
     * transaction cannot run the query that finds which teachers list it. The
     * order is the same trade the learning-unit resources cascade makes —
     * classroom first, so a failure here leaves the links pointing at a class
     * that is in the trash, which is recoverable, rather than stripping a
     * teacher's classes off a class that is still live.
     *
     * The removed entries are stashed ON THE TRASH DOCUMENT so restore can put
     * them back exactly: the entry carries denormalised fields — name, grade,
     * section, institution, programmes — that this document does not hold.
     */
    const links = await this.teachers.detachClassroom(docId);

    if (links.length > 0) {
      await updateDoc(trashClassroomDoc(docId), { detachedTeacherLinks: links });
    }

    return moved;
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

    const { classroom, detached } = await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(trashRef);

      if (!snapshot.exists()) {
        throw new Error('That classroom is no longer in the trash.');
      }

      const stored = stripTrashMetadata(snapshot.data());

      /*
       * `detachedTeacherLinks` is TRASH BOOKKEEPING, not part of the classroom.
       *
       * moveToTrash stashes it here so this restore can rebuild the teacher
       * entries; writing it back onto the live document would leave a field
       * nothing reads on every classroom that had ever been deleted.
       */
      const links = (stored['detachedTeacherLinks'] ?? []) as {
        teacherDocId: string;
        entry: TeacherClassroom;
      }[];

      delete stored['detachedTeacherLinks'];

      transaction.set(activeRef, stored);
      transaction.delete(trashRef);

      return {
        classroom: normaliseClassroom<Classroom>(docId, stored),
        detached: links
      };
    });

    /*
     * PUT THE TEACHER LINKS BACK, from what moveToTrash stashed.
     *
     * Rebuilt from the stored entries rather than from this document: the entry
     * carries denormalised fields — the programmes attached to the class among
     * them — that a classroom document does not hold, so reconstructing it would
     * quietly return the class to every teacher with its programmes gone.
     *
     * A restore with nothing stashed is a classroom deleted before this cascade
     * existed. Nothing to put back, and nothing to report.
     */
    await this.teachers.reattachClassrooms(detached);

    return classroom;
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

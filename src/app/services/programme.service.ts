import { Injectable, inject } from '@angular/core';
import {
  Timestamp,
  deleteDoc,
  deleteField,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'firebase/firestore';

import { db } from '../core/firebase';
import {
  activeClassroomDoc,
  activeTeacherDoc,
  activeTeachersCollection,
  newProgrammeDoc,
  programmeCounterDoc,
  programmeDoc,
  trashProgrammeDoc,
  programmesCollection,
  trashProgrammesCollection
} from '../core/firestore-paths';
import {
  FIRST_PROGRAMME_NUMBER,
  formatProgrammeCode,
  highestProgrammeNumber,
  isActiveStatus,
  programmeCodeNumber
} from '../data/programme-options';
import {
  Classroom,
  Programme,
  ProgrammeDraft,
  ProgrammeType,
  TRASH_METADATA_FIELDS,
  TeacherClassroom,
  TrashedProgramme
} from '../models/teaching.model';
import { AuthService } from './auth.service';

/**
 * Whether a teacher's class rows hold an out-of-date copy of a programme's name.
 *
 * `key` is the programme's DOC ID, not its programmeId — a teacher's class rows
 * carry the docId under a field named programmeId. See propagateRename.
 */
export function classroomsAreStale(
  classrooms: Record<string, TeacherClassroom>,
  programmeId: string,
  name: string
): boolean {
  return Object.values(classrooms).some(entry =>
    entry.programmes.some(
      programme =>
        programme.programmeId === programmeId &&
        (programme.programmeName !== name || programme.displayName !== name)
    )
  );
}

/**
 * The same classrooms map with one programme's names refreshed everywhere it
 * appears, and everything else verbatim.
 *
 * Returns a new object at every level it changes and never mutates: the caller
 * writes back only the classroom entries that moved, and a shared reference
 * would make "did this change?" unanswerable.
 *
 * ONE KEY, unlike the classroom cascade's. A teacher's programme entries are
 * copied from the classroom's own programmes map, which is keyed by
 * `programmeId`, so both sides of this cascade now agree on that field. The
 * earlier shape stored the programme's docId here instead, and the mismatch was
 * the trap this replaced.
 */
export function classroomsWithRenamed(
  classrooms: Record<string, TeacherClassroom>,
  programmeId: string,
  next: { programmeName: string; displayName: string; programmeCode: string }
): Record<string, TeacherClassroom> {
  return Object.fromEntries(
    Object.entries(classrooms).map(([classroomId, entry]) => [
      classroomId,
      {
        ...entry,
        programmes: entry.programmes.map(programme =>
          programme.programmeId === programmeId
            ? {
                ...programme,
                programmeName: next.programmeName,
                displayName: next.displayName,
                programmeCode: next.programmeCode
              }
            : programme
        )
      }
    ])
  );
}

/**
 * Fills in fields a stored programme may predate.
 *
 * The same defence normaliseInstitution and normaliseClassroom provide, for the
 * same reason: casting `document.data()` straight to the interface is a lie the
 * moment the interface grows, the missing keys read as `undefined`, and
 * Firestore rejects undefined outright if that object is ever written back.
 *
 * `grades` and `age` are coerced element by element because production stores
 * numeric grades as numbers. A row imported from there arrives as [8], and every
 * comparison in this app expects '8'.
 */
export function normaliseProgramme(docId: string, data: Record<string, unknown>): Programme {
  const name = (data['programmeName'] as string | undefined) ?? '';

  return {
    ...data,
    docId,
    programmeId: (data['programmeId'] as string | undefined) ?? docId,
    programmeName: name,
    programmeCode: (data['programmeCode'] as string | undefined) ?? '',
    displayName: (data['displayName'] as string | undefined)?.trim() || name,
    programmeDescription: (data['programmeDescription'] as string | undefined) ?? '',
    institutionId: (data['institutionId'] as string | undefined) ?? '',
    institutionName: (data['institutionName'] as string | undefined) ?? '',
    grades: toStringList(data['grades']),
    age: toStringList(data['age']),
    type: (data['type'] as ProgrammeType | undefined) ?? 'REGULAR',
    programmeStatus: (data['programmeStatus'] as Programme['programmeStatus'] | undefined) ?? 'LIVE',
    programmeImagePath: (data['programmeImagePath'] as string | undefined) ?? '',
    learningUnitsIds: toStringList(data['learningUnitsIds']),
    assignmentIds: toStringList(data['assignmentIds'])
  } as unknown as Programme;
}

/**
 * A list of strings from whatever was stored.
 *
 * Production writes `age: ''` when a programme is grade-scoped rather than
 * omitting it or writing [], so a bare `?? []` leaves a string where the
 * interface promises an array — and `.length` on it then reports the character
 * count. Anything that is not an array becomes an empty list.
 */
function toStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(entry => String(entry)) : [];
}

/**
 * Removes the trash bookkeeping, leaving the original document.
 *
 * Duplicated deliberately across the three services that have a trash rather
 * than shared: each one names the fields ITS trash adds, and they are only
 * identical for as long as all three trashes add exactly `trashAt`. A shared
 * helper would make the first divergence a silent bug in the other two.
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
 * The catalogue behind the Programme page and the classroom pickers.
 *
 * Reads are UNFILTERED beyond ownership and narrowed in memory. That is a
 * deliberate choice over `where('institutionId', '==', …)`: every extra where()
 * on top of the mandatory ownerId equality needs its own composite index, and a
 * teacher's catalogue is small enough that fetching it once and filtering it
 * three ways costs less than three indexed queries and their deploys.
 */
@Injectable({
  providedIn: 'root'
})
export class ProgrammeService {

  private auth = inject(AuthService);

  /** Every programme the signed-in teacher owns, newest first. */
  async list(): Promise<Programme[]> {
    const snapshot = await getDocs(programmesCollection());

    return snapshot.docs
      .map(document => normaliseProgramme(document.id, document.data()))
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  }

  /** Everything in the teacher's programme trash, most recently deleted first. */
  async listTrash(): Promise<TrashedProgramme[]> {
    const snapshot = await getDocs(trashProgrammesCollection());

    return snapshot.docs
      .map(document => ({
        ...normaliseProgramme(document.id, document.data()),
        trashAt: document.data()['trashAt']
      }) as TrashedProgramme)
      .sort((a, b) => (b.trashAt?.toMillis?.() ?? 0) - (a.trashAt?.toMillis?.() ?? 0));
  }

  /**
   * Allocates the next programme code. ATOMIC.
   *
   * A transaction on the teacher's own counter document, not a read followed by
   * a write: two tabs creating a programme at the same moment would otherwise
   * both read the same number and both write it, and the code is the one field
   * whose entire purpose is being distinct.
   *
   * `floor` seeds the counter the first time it is used, from the highest code
   * already present in the teacher's catalogue. Starting from zero instead would
   * hand out codes that already exist for any teacher whose programmes were
   * imported rather than created here.
   */
  async allocateCode(floor: number): Promise<string> {
    const uid = this.auth.requireUid();
    const counterRef = programmeCounterDoc(uid);

    return runTransaction(db, async transaction => {
      const snapshot = await transaction.get(counterRef);
      const stored = snapshot.exists()
        ? programmeCodeNumber(String(snapshot.data()['programmeCode'] ?? ''))
        : null;

      // The higher of the two: the counter may lag behind an import, and the
      // import may lag behind a counter whose programmes were since deleted.
      const next = Math.max(stored ?? 0, floor, FIRST_PROGRAMME_NUMBER - 1) + 1;
      const code = formatProgrammeCode(next);

      transaction.set(counterRef, { programmeCode: code, updatedAt: serverTimestamp() });

      return code;
    });
  }

  /**
   * Creates a programme owned by the signed-in teacher.
   *
   * `existing` is the caller's already-loaded catalogue, used only to seed the
   * counter. Passing it keeps this method free of a second query and makes the
   * sequencing testable without a database.
   */
  async create(draft: ProgrammeDraft, existing: Programme[] = []): Promise<Programme> {
    const uid = this.auth.requireUid();
    const code = await this.allocateCode(highestProgrammeNumber(existing));
    const reference = newProgrammeDoc();

    const payload = {
      ...draft,
      displayName: draft.displayName?.trim() || draft.programmeName,
      programmeCode: code,
      docId: reference.id,
      programmeId: reference.id,
      ownerId: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(reference, payload);

    // A LOCAL timestamp on the way back: serverTimestamp() is a sentinel that
    // only resolves server-side, so the written value is not readable here.
    const now = Timestamp.now();

    return { ...payload, createdAt: now, updatedAt: now } as Programme;
  }

  /**
   * Saves an edit.
   *
   * The identity fields are stripped rather than trusted: docId and programmeId
   * mirror the path, ownerId is stripped because it is not this
   * method's to change — the rule requires it to match what is already stored,
   * so sending it can only ever be a no-op or a rejection, programmeCode is allocated
   * once and never reassigned, and createdAt is set once.
   */
  async update(docId: string, patch: Partial<Programme>): Promise<void> {
    const {
      docId: _docId,
      programmeId: _programmeId,
      ownerId: _ownerId,
      programmeCode: _code,
      createdAt: _createdAt,
      ...fields
    } = patch;

    const defined = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined)
    );

    if (Object.keys(defined).length === 0) {
      return;
    }

    await updateDoc(programmeDoc(docId), { ...defined, updatedAt: serverTimestamp() });
  }

  /**
   * Detaches a programme from every classroom carrying it.
   *
   * WHY THIS EXISTS. A classroom stores a denormalised COPY of each programme in
   * its `programmes` map, so deleting the catalogue entry does not remove it from
   * the classrooms using it — they would keep rendering a programme that no
   * longer exists, and Manage Programmes would show it in Selected with no way
   * to get it back if removed. Production does the same cascade
   * (`removeProgrammeFromClassroomsAndClassroomMaster`).
   *
   * deleteField() on the one map key, not a rewrite of the whole map: another
   * tab may have changed a different programme on the same classroom, and
   * writing the map back wholesale would revert that.
   *
   * Issued in parallel — independent documents, so awaiting one at a time would
   * cost the sum of every round trip.
   *
   * Returns the classroom ids it touched, so the caller can patch its own list
   * rather than re-reading.
   */
  async detachFromClassrooms(programmeId: string, classrooms: Classroom[]): Promise<string[]> {
    const affected = classrooms.filter(classroom =>
      Object.prototype.hasOwnProperty.call(classroom.programmes ?? {}, programmeId)
    );

    await Promise.all(
      affected.map(classroom =>
        updateDoc(activeClassroomDoc(classroom.docId), {
          [`programmes.${programmeId}`]: deleteField(),
          updatedAt: serverTimestamp()
        })
      )
    );

    return affected.map(classroom => classroom.docId);
  }

  /**
   * Pushes a renamed programme out to every document holding a COPY of its name.
   *
   * WHY THIS EXISTS. Both classrooms and teachers denormalise the programme's
   * name at attach time, so a rename left them rendering the old one
   * indefinitely. The id was always right, so this was a display fault rather
   * than data loss — but it made the catalogue disagree with every page that
   * shows a programme, and the edit modal could only report the count.
   *
   * TWO DIFFERENT WRITES, because the two shapes differ:
   *
   *   classrooms  programmes is a MAP keyed by programme id, so the copy is
   *               reachable by dotted path and only the changed leaves are
   *               written. Nothing else on the classroom is touched.
   *   teachers    classes is an ARRAY, which has no addressable inner field.
   *               The whole array is rewritten, with untouched rows preserved
   *               verbatim.
   *
   * TEACHERS SNAPSHOT `displayName || programmeName`, matching what the setup
   * wizard resolved when it wrote them, so the same rule is applied here rather
   * than a bare programmeName — otherwise a programme with a display name would
   * be propagated as the wrong string.
   *
   * NOT ATOMIC, and cannot be: this spans two collections and an unbounded
   * number of documents. A partial run leaves some copies updated and the rest
   * stale, which is the state the app was permanently in before, and is fixed by
   * saving again. The programme itself is written first by update(), so the
   * catalogue is never the thing left behind.
   *
   * Returns what it touched, so the caller can report honestly.
   */
  async propagateRename(
    programme: Programme,
    classrooms: Classroom[]
  ): Promise<{ classrooms: number; teachers: number }> {
    /*
     * TWO DIFFERENT KEYS, and getting this wrong silently propagates nothing.
     *
     *   classrooms  keyed by programmeId — see addProgramme(), which writes
     *               `programmes[programme.programmeId]`, and
     *               detachFromClassrooms(), called with target.programmeId.
     *   teachers    keyed by docId — the setup wizard's assignableProgrammes()
     *               emits `{ id: programme.docId }`, and that id is what lands
     *               in each class row's programmeId field.
     *
     * The field is called programmeId in both places while holding different
     * values, which is a trap worth naming rather than quietly working around.
     */
    /*
     * ONE KEY NOW. Classrooms key their programmes map by programmeId, and a
     * teacher's entries are copies of those, so both sides agree. The previous
     * shape stored the programme's docId on the teacher, and using one key for
     * both silently propagated nothing.
     */
    const classroomKey = programme.programmeId;
    const snapshotName = programme.displayName || programme.programmeName;

    const affectedClassrooms = classrooms.filter(classroom =>
      Object.prototype.hasOwnProperty.call(classroom.programmes ?? {}, classroomKey)
    );

    await Promise.all(
      affectedClassrooms.map(classroom =>
        updateDoc(activeClassroomDoc(classroom.docId), {
          [`programmes.${classroomKey}.programmeName`]: programme.programmeName,
          [`programmes.${classroomKey}.displayName`]: programme.displayName,
          [`programmes.${classroomKey}.programmeCode`]: programme.programmeCode,
          updatedAt: serverTimestamp()
        })
      )
    );

    /*
     * Read-modify-write per teacher, because the programmes live inside an array
     * nested in a map — Firestore can address the classroom entry but not a
     * programme inside its array, so each changed classroom entry is rewritten
     * whole. Only teachers whose stored copy has actually drifted are written.
     */
    const snapshot = await getDocs(activeTeachersCollection());

    const next = {
      programmeName: programme.programmeName,
      displayName: programme.displayName,
      programmeCode: programme.programmeCode
    };

    const staleTeachers = snapshot.docs
      .map(document => ({
        docId: document.id,
        classrooms:
          (document.data()['classrooms'] as Record<string, TeacherClassroom> | undefined) ?? {}
      }))
      .filter(teacher => classroomsAreStale(teacher.classrooms, classroomKey, snapshotName));

    await Promise.all(
      staleTeachers.map(teacher => {
        const updated = classroomsWithRenamed(teacher.classrooms, classroomKey, next);

        return updateDoc(activeTeacherDoc(teacher.docId), {
          ...Object.fromEntries(
            Object.entries(updated).map(([classroomId, entry]) => [
              `classrooms.${classroomId}`,
              entry
            ])
          ),
          updatedAt: serverTimestamp()
        });
      })
    );

    return { classrooms: affectedClassrooms.length, teachers: staleTeachers.length };
  }

  /**
   * Moves a programme into the trash. ATOMIC.
   *
   *   programmes/{docId} -> programmes/trash/DeletedProgrammes/{docId}
   *
   * A transaction for the reason its two siblings are: copy-then-delete has a
   * window where the tab closes between the two, leaving the same programme in
   * both collections — offered by the pickers AND sitting in the trash, with a
   * restore that would overwrite the live copy.
   *
   * This does NOT detach the programme from classrooms. That is a separate,
   * non-atomic cascade across many documents, and the caller runs it first —
   * see detachFromClassrooms. Ordering it that way means a failure leaves the
   * programme live with some classrooms detached, which is recoverable by
   * retrying; the reverse order would leave classrooms pointing at a programme
   * that is already gone.
   */
  async moveToTrash(docId: string): Promise<TrashedProgramme> {
    // Throws if signed out, before any read is attempted.
    this.auth.requireUid();
    const activeRef = programmeDoc(docId);
    const trashRef = trashProgrammeDoc(docId);

    return runTransaction(db, async transaction => {
      const snapshot = await transaction.get(activeRef);

      if (!snapshot.exists()) {
        throw new Error('That programme no longer exists.');
      }

      const trashed = { ...snapshot.data(), docId, trashAt: serverTimestamp() };

      transaction.set(trashRef, trashed);
      transaction.delete(activeRef);

      return { ...trashed, trashAt: Timestamp.now() } as TrashedProgramme;
    });
  }

  /**
   * Restores a programme from the trash. ATOMIC, and the exact mirror of
   * moveToTrash.
   *
   * The classrooms it was detached from are NOT re-attached, and cannot be: the
   * cascade above records nothing about which classrooms carried it. Production
   * has the same one-way door and says so in its delete confirmation — "These
   * assignments will have to be set manually in case the programme is restored."
   * The confirmation text on this page says the same.
   */
  async restore(docId: string): Promise<Programme> {
    // Throws if signed out, before any read is attempted — the same guard
    // moveToTrash carries. Without it a stale session reaches Firestore and
    // the permission-denied comes back indistinguishable from a lost race.
    this.auth.requireUid();
    const activeRef = programmeDoc(docId);
    const trashRef = trashProgrammeDoc(docId);

    return runTransaction(db, async transaction => {
      const snapshot = await transaction.get(trashRef);

      if (!snapshot.exists()) {
        throw new Error('That programme is no longer in the trash.');
      }

      const restored = stripTrashMetadata(snapshot.data());

      transaction.set(activeRef, restored);
      transaction.delete(trashRef);

      return normaliseProgramme(docId, restored);
    });
  }

  /** Permanent. Deletes from the TRASH subcollection only. */
  async purge(docId: string): Promise<void> {
    // Same guard as restore: fail on the session, not on the write.
    this.auth.requireUid();
    await deleteDoc(trashProgrammeDoc(docId));
  }

  /** Empties the trash. */
  async purgeAll(docIds: string[]): Promise<void> {
    await Promise.all(docIds.map(docId => this.purge(docId)));
  }

  describeError(error: unknown, fallback: string): string {
    const code = (error as { code?: string })?.code ?? '';

    if (code === 'permission-denied') {
      return 'Could not complete that — the programme may have just been ' +
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

/**
 * The programmes offered for one classroom, in the order the picker shows them.
 *
 * A standalone function rather than a service method, because it touches no
 * database and is the piece most worth testing directly: get the filter wrong
 * and the picker silently offers nothing, which reads as "there are none" and
 * not as a bug.
 *
 * Three narrowings, matching production's:
 *
 *   status       only live programmes are ever offered, judged by isActiveStatus
 *   institution  a programme belongs to one school
 *   type         REGULAR for a classroom, STEM-CLUB for a club
 *
 * Grade is a FOURTH narrowing and applies only to classrooms — production's
 * `filteredProgrammes.filter(e => e?.grades?.includes(grade))`. A STEM club has
 * no grade, so applying it there would filter everything out.
 *
 * A programme with an EMPTY grades list survives the grade filter. Production
 * would drop it; dropping it here means an age-scoped programme, or one created
 * without grades, is invisible with no way to tell why — so it is treated as
 * "applies to any grade".
 */
export function programmesFor(
  all: Programme[],
  options: { institutionId: string; type: ProgrammeType; grade?: string }
): Programme[] {
  return all.filter(programme => {
    // isActiveStatus, NOT `!== 'LIVE'`. Production stores both 'LIVE' and
    // 'ACTIVE' in mixed case, which is why that helper exists and why the
    // Programme table counts with it. A strict comparison here showed a
    // programme as Active on its own page while silently hiding it from every
    // picker.
    if (!isActiveStatus(programme.programmeStatus)) {
      return false;
    }

    if (programme.institutionId !== options.institutionId) {
      return false;
    }

    if (programme.type !== options.type) {
      return false;
    }

    if (options.type === 'STEM-CLUB' || !options.grade) {
      return true;
    }

    return programme.grades.length === 0 || programme.grades.includes(options.grade);
  });
}

/**
 * How production names a programme it generates: school, academic year, grade,
 * subject. Offered as the placeholder in the create forms so hand-made
 * programmes look like the imported ones rather than drifting from them.
 */
export function suggestedProgrammeName(
  institutionName: string,
  grade: string,
  subject: string
): string {
  const year = academicYearLabel();
  const scope = grade ? ` Grade ${grade}` : '';

  return `${institutionName} ${year}${scope} - ${subject}`.trim();
}

/**
 * "26-27" for the academic year containing today.
 *
 * The Indian academic year opens in April, so January to March still belongs to
 * the year that started the previous April.
 */
export function academicYearLabel(today: Date = new Date()): string {
  const APRIL = 3;
  const startYear = today.getMonth() >= APRIL ? today.getFullYear() : today.getFullYear() - 1;

  return `${String(startYear % 100).padStart(2, '0')}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

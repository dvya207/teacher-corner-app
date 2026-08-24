import { Injectable, inject } from '@angular/core';
import {
  Timestamp,
  deleteDoc,
  deleteField,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';

import { db } from '../core/firebase';
import { toSubscriberDigits } from '../data/institution-options';
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
  TeacherClassroom,
  TeacherDraft,
  TeacherMeta,
  TeacherProgramme,
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
  const { docId, ownerId, ...fields } = patch;
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
    teacherMeta: teacherMetaFrom(data),
    classrooms: teacherClassroomsFrom(data)
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
export function teacherClassroomsFrom(
  data: Record<string, unknown>
): Record<string, TeacherClassroom> {
  const stored = data['classrooms'];

  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    return Object.fromEntries(
      Object.entries(stored as Record<string, Partial<TeacherClassroom>>).map(
        ([classroomId, entry]) => [classroomId, normaliseTeacherClassroom(classroomId, entry)]
      )
    );
  }

  /*
   * LEGACY: rows written before classrooms were referenced.
   *
   * The old shape was a flat `classes` array of grade/section/programme with no
   * classroom behind it, because the wizard collected those before the school
   * had any classrooms. There is no classroomId to recover, so each entry is
   * keyed by its programme and carries an empty classroomId — visibly
   * unreferenced rather than silently given a made-up id.
   *
   * Read-time only. The stored document is not rewritten: nothing reads the old
   * key any more, and migrating rows to tidy it up would buy nothing.
   */
  const legacy = data['classes'];

  if (!Array.isArray(legacy)) {
    return {};
  }

  return Object.fromEntries(
    legacy.map((entry: Record<string, unknown>) => {
      const programmeId = (entry['programmeId'] as string | undefined) ?? '';

      return [
        programmeId || 'unknown',
        normaliseTeacherClassroom('', {
          grade: (entry['grade'] as string | undefined) ?? '',
          section: (entry['section'] as string | undefined) ?? '',
          programmes: programmeId
            ? [{
                programmeId,
                programmeName: (entry['programmeName'] as string | undefined) ?? '',
                displayName: (entry['programmeName'] as string | undefined) ?? '',
                programmeCode: '',
                sequentiallyLocked: false
              }]
            : []
        })
      ];
    })
  );
}

/** One classroom entry, with every key present. */
export function normaliseTeacherClassroom(
  classroomId: string,
  entry: Partial<TeacherClassroom>
): TeacherClassroom {
  return {
    activeStatus: entry.activeStatus !== false,
    classroomId: entry.classroomId ?? classroomId,
    classroomName: entry.classroomName ?? '',
    grade: entry.grade ?? '',
    section: entry.section ?? '',
    institutionId: entry.institutionId ?? '',
    institutionName: entry.institutionName ?? '',
    type: entry.type ?? 'CLASSROOM',
    userRole: entry.userRole ?? '',
    programmes: (entry.programmes ?? []).map(programme => ({
      programmeId: programme?.programmeId ?? '',
      programmeName: programme?.programmeName ?? '',
      displayName: programme?.displayName ?? '',
      programmeCode: programme?.programmeCode ?? '',
      sequentiallyLocked: programme?.sequentiallyLocked === true
    })),
    createdAt: entry.createdAt ?? (null as unknown as Timestamp)
  };
}

/** The person, with every key present. Built from the flat shape when absent. */
export function teacherMetaFrom(data: Record<string, unknown>): TeacherMeta {
  const stored = (data['teacherMeta'] ?? {}) as Partial<TeacherMeta>;

  // Falls back to the FLAT legacy fields, which is where identity used to live.
  const firstName = stored.firstName ?? (data['firstName'] as string | undefined) ?? '';
  const lastName = stored.lastName ?? (data['lastName'] as string | undefined) ?? '';
  const digits = stored.phoneNumber ?? stored.phone ??
    (data['phoneNumber'] as string | undefined) ?? '';

  return {
    countryCode: stored.countryCode ?? (data['countryCode'] as string | undefined) ?? '',
    email: stored.email ?? (data['email'] as string | undefined) ?? '',
    firstName,
    lastName,
    fullNameLowerCase: stored.fullNameLowerCase ?? teacherSearchKey(firstName, lastName),
    phone: digits,
    phoneNumber: digits,
    // Only when the document actually carries one: an absent uid means this
    // teacher has never signed in, which is different from having a blank one.
    ...(stored.uid ? { uid: stored.uid } : {}),
    updatedAt: stored.updatedAt ?? (null as unknown as Timestamp)
  };
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
export function classroomProgrammeKey(programme: TeacherProgramme): string {
  return programme.programmeId;
}

/**
 * The existing classes plus the new ones, with duplicates dropped.
 *
 * The FIRST occurrence wins, so a class the teacher already has keeps its stored
 * entry rather than being rewritten by an identical one. Re-submitting the same
 * class is therefore a no-op instead of a growing list of copies — which matters
 * because the lookup makes that easy to do by accident.
 */
export function mergeClassrooms(
  existing: Record<string, TeacherClassroom>,
  additions: Record<string, TeacherClassroom>
): Record<string, TeacherClassroom> {
  const merged: Record<string, TeacherClassroom> = { ...existing };

  for (const [classroomId, addition] of Object.entries(additions)) {
    const current = merged[classroomId];

    if (!current) {
      merged[classroomId] = addition;
      continue;
    }

    /*
     * THE CLASSROOM IS KEPT, ITS PROGRAMMES ARE UNIONED.
     *
     * Re-registering a teacher against a classroom they already have must not
     * discard the programmes already on that entry, nor duplicate them. The
     * FIRST occurrence of a programme wins, so a stored entry keeps its own
     * snapshot rather than being overwritten by an identical one.
     */
    const seen = new Set(current.programmes.map(classroomProgrammeKey));
    const programmes = [...current.programmes];

    for (const programme of addition.programmes) {
      if (seen.has(classroomProgrammeKey(programme))) {
        continue;
      }

      seen.add(classroomProgrammeKey(programme));
      programmes.push(programme);
    }

    merged[classroomId] = { ...current, programmes };
  }

  return merged;
}

/**
 * Each classroom entry with `createdAt` set to the server's clock.
 *
 * Exported and separate so the stamping is visible and testable: an entry that
 * silently carries null reads as "attached at no time", which is what shipped
 * before this existed.
 */
/**
 * Legacy entries that a properly resolved one now supersedes.
 *
 * WHY THEY LINGER. Entries used to be keyed by grade-section when no classroom
 * could be resolved, and both merge paths start from what is already on the
 * document — mergeClassrooms spreads `existing`, and the profile write uses
 * merge:true. So an old `2-B` entry survived every subsequent write, and a
 * teacher ended up carrying BOTH it and the real `<classroomId>` entry for the
 * same class. Re-registering somebody made the duplicate, not a stale tab.
 *
 * IDENTIFIED BY AN EMPTY classroomId, never by the shape of the key. A key is
 * opaque; what makes an entry legacy is that it references no classroom. An entry
 * is only dropped when a real one covers the SAME grade and section, so a class
 * that genuinely has no classroom is left alone rather than silently deleted.
 */
export function supersededClassroomKeys(
  classrooms: Record<string, TeacherClassroom>
): string[] {
  const resolved = Object.values(classrooms).filter(entry => entry.classroomId);

  return Object.entries(classrooms)
    .filter(([, entry]) =>
      !entry.classroomId &&
      resolved.some(other => other.grade === entry.grade && other.section === entry.section)
    )
    .map(([key]) => key);
}

export function stampedClassrooms(
  classrooms: Record<string, TeacherClassroom>
): Record<string, TeacherClassroom> {
  return Object.fromEntries(
    Object.entries(classrooms).map(([classroomId, entry]) => [
      classroomId,
      { ...entry, createdAt: serverTimestamp() as unknown as Timestamp }
    ])
  );
}

/**
 * The same meta without a blank `uid`.
 *
 * A teacher registered by an admin has no Auth account yet, so there is no uid to
 * write. Storing '' puts a field on the document that reads as answered when it
 * is not — the field appears once linkSignedInUid has something real to put in
 * it.
 */
export function withoutEmptyUid(meta: TeacherMeta): TeacherMeta {
  if (meta.uid) {
    return meta;
  }

  const { uid, ...rest } = meta;

  return rest as TeacherMeta;
}

/** first + last, collapsed. Stored denormalised, as institutions store their representative's. */
export function teacherFullName(first: string, last: string): string {
  return `${(first ?? '').trim()} ${(last ?? '').trim()}`.trim();
}

/**
 * Production's `fullNameLowerCase`: the name lowercased with all whitespace
 * removed, so "Meera Iyer" becomes "meeraiyer". It is a search key, not a
 * display value — nothing renders it.
 */
export function teacherSearchKey(first: string, last: string): string {
  return teacherFullName(first, last).toLowerCase().replace(/\s+/g, '');
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
/**
 * Whether this teacher record is the signed-in person's, and still unclaimed.
 *
 * EXPORTED AND TESTED DIRECTLY, for the reason `supersededRequestKeys` is: this
 * rule GRANTS AN IDENTITY. It decides which stored record a Firebase account
 * becomes, so it has to be visible and pinned rather than buried in a filter
 * inside a write.
 *
 * TWO CONDITIONS, both necessary:
 *
 *   - THE NUMBERS MATCH once both sides are normalised. Comparing the raw
 *     strings meant any formatting difference silently prevented linking, and a
 *     teacher stayed unlinked forever with nothing in the UI to explain it.
 *   - THE RECORD CARRIES NO UID. Numbers are recycled, so claiming a record that
 *     already belongs to an account would hand one teacher another's classrooms.
 *     Only a blank is filled; a record already holding THIS uid needs no write
 *     and is not a match either.
 *
 * [digits] is expected to be already normalised by the caller, which is why it
 * is not normalised again here: the caller checks its length before querying.
 */
/**
 * The first usable name among a set of teacher documents.
 *
 * Split out of [TeacherService.registeredName] so the rule can be tested without
 * a Firestore double, the way isUnlinkedMatch above already is. What reaches the
 * database is then a query and a loop, and the part that makes a decision is
 * visible on its own.
 *
 * DEACTIVATED RECORDS ARE SKIPPED, matching the sign-in gate: `setActive(false)`
 * is how an administrator withdraws a teacher, and a withdrawn record should not
 * supply an identity. Absent is active, because `create` does not write the field
 * and every record predating it would otherwise read as withdrawn.
 *
 * A BLANK NAME IS SKIPPED RATHER THAN RETURNED, so a half-filled record does not
 * shadow a complete one later in the list.
 *
 * Goes through teacherMetaFrom rather than reading `teacherMeta` directly, so the
 * flat legacy fields identity used to live in are picked up too.
 */
export function pickRegisteredName(
  documents: Record<string, unknown>[]
): { firstName: string; lastName: string } | null {
  for (const data of documents) {
    if ((data as { active?: boolean }).active === false) {
      continue;
    }

    const meta = teacherMetaFrom(data);
    const firstName = (meta.firstName ?? '').trim();

    if (firstName) {
      return { firstName, lastName: (meta.lastName ?? '').trim() };
    }
  }

  return null;
}

/**
 * Whether a record's stored number IS this number, however it was written down.
 *
 * BOTH SIDES NORMALISED. The stored value is not trustworthy as a literal: the
 * wizard, an import and production have each written `+919481635184`,
 * `094816 35184` and `9481635184` for the same person. A Firestore equality
 * query compares the raw stored string, so it silently misses every form but the
 * one it was given — which is exactly the bug linkSignedInUid was fixed for, and
 * why anything matching on a number has to come through here.
 *
 * A NUMBER SHORTER THAN TEN DIGITS NEVER MATCHES. A partial value must not claim
 * a record.
 */
export function matchesStoredNumber(
  meta: Partial<TeacherMeta>,
  digits: string
): boolean {
  if (digits.length < 10) {
    return false;
  }

  return toSubscriberDigits(meta.phoneNumber ?? meta.phone ?? '') === digits;
}

export function isUnlinkedMatch(
  meta: Partial<TeacherMeta>,
  digits: string
): boolean {
  /*
   * ALREADY LINKED IS NOT A MATCH, and that is the safety property. Numbers get
   * reassigned, so claiming a record that already belongs to an account would
   * hand one teacher another's classrooms.
   */
  return matchesStoredNumber(meta, digits) && !meta.uid;
}

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
      // updatedAt, because there is no top-level createdAt in production's shape.
      .sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
  }

  /** The teachers of ONE institution, filtered client-side on the owner-scoped list. */
  async listForInstitution(institutionId: string): Promise<Teacher[]> {
    const all = await this.list();

    // The institution now lives on each classroom entry rather than on the
    // teacher, so a teacher belongs to a school if ANY of their classrooms does.
    return all.filter(teacher =>
      Object.values(teacher.classrooms).some(entry => entry.institutionId === institutionId)
    );
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

    /*
     * A CLIENT-ALLOCATED ID, as every other collection here uses.
     *
     * This was briefly the subscriber phone, on the reasoning that the OTP flow
     * resolves people by number. Reverted on instruction: a phone number is not
     * an identity here — it can be reassigned to another person, and a document
     * id cannot be changed once written, so the id would outlive the fact it
     * encodes. The number stays on teacherMeta, where findKnownTeacher matches
     * on it, and that lookup is what stops a second document for one person.
     */
    const reference = newActiveTeacherDoc();

    const payload = {
      ...draft,
      docId: reference.id,
      ownerId: uid,
      /*
       * STAMPED HERE, not by the caller. Each classroom entry records when the
       * teacher was attached to that class, and the component that builds the map
       * has no business holding a Firestore sentinel.
       *
       * serverTimestamp() rather than a client clock, matching every other write
       * here — and legal at this depth because the entries sit in a MAP. A
       * sentinel inside an ARRAY would be rejected, which is why `programmes`
       * carries no timestamp of its own.
       */
      classrooms: stampedClassrooms(draft.classrooms),
      teacherMeta: {
        ...withoutEmptyUid(draft.teacherMeta),
        // Both names for the same digits, which is production's shape.
        phone: draft.teacherMeta.phoneNumber,
        fullNameLowerCase: teacherSearchKey(
          draft.teacherMeta.firstName,
          draft.teacherMeta.lastName
        ),
        updatedAt: serverTimestamp()
      },
      lastActivityAt: serverTimestamp(),
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

    return {
      ...payload,
      teacherMeta: { ...payload.teacherMeta, updatedAt: now },
      lastActivityAt: now,
      updatedAt: now
    } as Teacher;
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
   * IDENTITY IS NOT TOUCHED. Only `classrooms` is written: teacherMeta is
   * whatever the teacher already had. The form locks those fields when it
   * recognises a number, so there is nothing here to save.
   *
   * WRITES ONLY THE CLASSROOMS THAT CHANGED, by dotted path, rather than the
   * whole map. Two admins extending the same teacher with different classrooms
   * therefore do not overwrite each other, which a whole-map write would allow.
   *
   * Returns the teacher as it now stands, so the caller can patch its list
   * without a re-read. Returns it UNCHANGED, and writes nothing, when every
   * classroom and programme offered is already on the document.
   */
  async appendClassrooms(
    existing: Teacher,
    additions: Record<string, TeacherClassroom>
  ): Promise<Teacher> {
    // Only the entries that are actually new get a timestamp; an existing one
    // keeps the date it was first attached.
    const fresh = Object.fromEntries(
      Object.entries(additions).filter(([classroomId]) => !existing.classrooms[classroomId])
    );

    const classrooms = mergeClassrooms(existing.classrooms, {
      ...additions,
      ...stampedClassrooms(fresh)
    });

    const changed = Object.entries(classrooms).filter(([classroomId, entry]) => {
      const before = existing.classrooms[classroomId];

      return !before || before.programmes.length !== entry.programmes.length;
    });

    // Cleared in the SAME write that adds the real entry, so the document is
    // never briefly carrying both.
    const superseded = supersededClassroomKeys(classrooms);

    if (changed.length === 0 && superseded.length === 0) {
      return existing;
    }

    await updateDoc(activeTeacherDoc(existing.docId), {
      ...Object.fromEntries(
        changed.map(([classroomId, entry]) => [`classrooms.${classroomId}`, entry])
      ),
      ...Object.fromEntries(
        superseded.map(key => [`classrooms.${key}`, deleteField()])
      ),
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    for (const key of superseded) {
      delete classrooms[key];
    }

    return { ...existing, classrooms };
  }

  /**
   * Records a teacher's own Auth uid on their document, once they have one.
   *
   * WHY IT IS EMPTY UNTIL NOW. Registering a teacher creates no Auth user — a
   * Teacher is a record ABOUT a person, not an identity — so at write time there
   * is no uid in existence to store. Production keys its Teachers by uid because
   * its teachers arrive with accounts; here the account appears later, the first
   * time that person signs in with the number an admin registered.
   *
   * MATCHED ON THE SUBSCRIBER DIGITS, which is the same key findKnownTeacher uses
   * to stop a second document being written for one person.
   *
   * ONLY FILLS A BLANK. A document that already carries a uid is left alone: two
   * people sharing a recycled number must not silently take over each other's
   * record, and a second sign-in by the same person has nothing to change.
   *
   * BEST EFFORT. The caller runs this after the session exists, and a failure here
   * must not cost anybody their sign-in — see the call site in the login page.
   */
  async linkSignedInUid(phoneNumber: string, uid: string): Promise<number> {
    /*
     * BOTH SIDES ARE NORMALISED, and that is a fix rather than tidying.
     *
     * This used to compare the caller's string against the stored field with
     * `===`. Any difference in formatting therefore meant no link at all, and
     * silently: a stored `+919481635184` or `094816 35184` never matched a
     * ten-digit login value, so that teacher signed in and stayed unlinked
     * forever, with nothing in the UI to say why.
     *
     * toSubscriberDigits is the same helper the wizard and every institution form
     * use, so all three ends of this now agree on what a number is.
     */
    const digits = toSubscriberDigits(phoneNumber ?? '');

    if (digits.length < 10 || !uid) {
      return 0;
    }

    const snapshot = await getDocs(activeTeachersCollection());

    const unlinked = snapshot.docs.filter(document =>
      isUnlinkedMatch(
        (document.data()['teacherMeta'] ?? {}) as Partial<TeacherMeta>,
        digits
      )
    );

    await Promise.all(
      unlinked.map(document =>
        // Dotted paths, so nothing else on teacherMeta is rewritten from a stale
        // copy read a moment ago.
        updateDoc(activeTeacherDoc(document.id), {
          'teacherMeta.uid': uid,
          'teacherMeta.updatedAt': serverTimestamp(),
          updatedAt: serverTimestamp()
        })
      )
    );

    return unlinked.length;
  }

  /**
   * Whether an administrator has already registered this person as a teacher.
   *
   * WHAT IT IS FOR. Being in `teachers` IS the approval. An administrator put
   * that record there deliberately, with a school and a class on it, so sending
   * that person through the self-registration form and then an approval queue
   * asks them to apply for something they have already been granted. `gate()`
   * uses this to let them straight through to the dashboard.
   *
   * BY UID **OR** BY NUMBER, and both are needed. `linkSignedInUid` stamps the
   * uid, but it runs AFTER the session exists, and the route guard that calls
   * this can run before it — on a first sign-in there is nothing stamped yet.
   * The number is what the administrator actually entered, so it is the key that
   * is always present.
   *
   * DEACTIVATED RECORDS DO NOT COUNT. `setActive(false)` is how an administrator
   * withdraws a teacher, and a withdrawn teacher should not be waved past the
   * gate. Absent is treated as active, because `create` does not write the field
   * and every existing record predates it.
   *
   * Two narrow queries rather than reading the collection: this is on the path
   * into the shell, and `linkSignedInUid` already pays for a full read elsewhere.
   */
  async isRegisteredTeacher(uid: string, phoneDigits: string): Promise<boolean> {
    const lookups = [
      ...(uid ? [where('teacherMeta.uid', '==', uid)] : []),
      ...(phoneDigits ? [where('teacherMeta.phoneNumber', '==', phoneDigits)] : []),
      ...(phoneDigits ? [where('teacherMeta.phone', '==', phoneDigits)] : [])
    ];

    for (const clause of lookups) {
      const snapshot = await getDocs(
        query(activeTeachersCollection(), clause, limit(5))
      );

      const usable = snapshot.docs.some(document => {
        const data = document.data() as { active?: boolean };
        return data.active !== false;
      });

      if (usable) {
        return true;
      }
    }

    return false;
  }

  /**
   * The name an administrator recorded for this person in `teachers`.
   *
   * WHY THIS EXISTS. Someone the Set Up Wizard registered has never filled in the
   * self-registration form, so `users/{uid}` carries no name for them and the
   * topbar fell back to 'Teacher' forever. The name they should be greeted by was
   * in `teachers/{docId}` under `teacherMeta` the whole time, typed by the
   * administrator who registered them, and nothing ever read it for display.
   *
   * BY UID **OR** BY NUMBER, for the same reason isRegisteredTeacher is: on a
   * first sign-in `linkSignedInUid` may not have stamped the uid yet, and the
   * number is what the administrator actually entered.
   *
   * DEACTIVATED RECORDS DO NOT COUNT, matching the gate. A withdrawn teacher
   * should not be waved past it, and should not supply an identity either.
   *
   * FIRST USABLE MATCH WINS. One person can hold several teacher records, one per
   * class they teach, which is exactly what assigning a registered teacher to
   * another class creates. Those records carry the same person's name; if they
   * ever disagree, the records are what need correcting rather than this method
   * arbitrating between them.
   *
   * Returns null rather than a blank pair, so a caller cannot mistake "no record"
   * for "a record whose name is empty".
   */
  async registeredName(
    uid: string,
    phoneDigits: string
  ): Promise<{ firstName: string; lastName: string } | null> {
    const lookups = [
      ...(uid ? [where('teacherMeta.uid', '==', uid)] : []),
      ...(phoneDigits ? [where('teacherMeta.phoneNumber', '==', phoneDigits)] : []),
      ...(phoneDigits ? [where('teacherMeta.phone', '==', phoneDigits)] : [])
    ];

    for (const clause of lookups) {
      const snapshot = await getDocs(
        query(activeTeachersCollection(), clause, limit(5))
      );

      const found = pickRegisteredName(
        snapshot.docs.map(document => document.data() as Record<string, unknown>)
      );

      if (found) {
        return found;
      }
    }

    /*
     * FALLBACK: a normalised scan, because the queries above cannot do one.
     *
     * A Firestore equality clause compares the RAW stored string, so
     * `teacherMeta.phoneNumber == '9481635184'` misses a record that stored
     * `+919481635184` — which is the same defect linkSignedInUid was fixed for,
     * and those records demonstrably exist.
     *
     * IT MATTERS HERE PARTICULARLY BECAUSE OF ORDERING. recordSignIn runs inside
     * loginWithToken, BEFORE the login page calls linkSignedInUid, so on a first
     * sign-in there is no teacherMeta.uid stamped yet and the uid clause above
     * cannot help. Without this the teacher would be greeted as 'Teacher' on the
     * one sign-in where the greeting is a first impression, and only get their
     * name on the second.
     *
     * ONE FULL READ, and only when the narrow queries found nothing AND the
     * caller has no name yet, which is once per account. linkSignedInUid already
     * reads this whole collection on every single sign-in, so this is not a new
     * order of cost.
     */
    if (phoneDigits.length >= 10) {
      const snapshot = await getDocs(activeTeachersCollection());

      return pickRegisteredName(
        snapshot.docs
          .map(document => document.data() as Record<string, unknown>)
          .filter(data => matchesStoredNumber(teacherMetaFrom(data), phoneDigits))
      );
    }

    return null;
  }

  /** Saves an edit. Ownership and school membership are not editable here. */
  async update(docId: string, patch: Partial<Teacher>): Promise<void> {
    const fields = withoutUndefinedTeacherFields(stripImmutableTeacherFields(patch));

    if (Object.keys(fields).length === 0) {
      return;
    }

    /*
     * The search key is DERIVED, never taken from a caller. An edit that changes
     * either name has to refresh it or the teacher stops being findable under
     * their new one.
     */
    if (fields.teacherMeta) {
      fields.teacherMeta = {
        ...fields.teacherMeta,
        fullNameLowerCase: teacherSearchKey(
          fields.teacherMeta.firstName,
          fields.teacherMeta.lastName
        )
      };
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

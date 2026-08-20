import { Timestamp } from 'firebase/firestore';

import { UserRole } from '../services/auth.service';

/**
 * Firestore layout, in this app's OWN 'teacher-corner-dev' database:
 *
 *   users/{uid}                                  teacher profile
 *   institutions/{docId}                         schools, mirroring production
 *   institutions/trash/DeletedInstitutes/{docId}  deleted schools
 *   classrooms/{docId}                           classrooms and STEM clubs
 *   classrooms/trash/DeletedClassrooms/{docId}    deleted classrooms
 *   programmes/{docId}                           the programme catalogue
 *
 * Deletion is a MOVE between collections, never a flag — see
 * core/firestore-paths.ts, which is the only place any of these paths is built.
 */

/**
 * The address, stored as a NESTED MAP rather than flat fields.
 *
 * Mirrors ThinkTac production exactly, and is the better shape regardless: the
 * Address tab edits precisely this object, so saving that tab is one field
 * write rather than seven, and nothing outside the map can be touched by it.
 */
export interface InstitutionAddress {
  city: string;
  /**
   * Country NAME, not an ISO code: production stores "India".
   *
   * It lives inside the address rather than at the top level because that is
   * where production puts it. institution-info.component.ts reads and writes
   * `institutionAddress.country` throughout.
   */
  country: string;
  district: string;
  /**
   * Free text, e.g. "opposite the bus stand".
   *
   * Collected by the Add Institution form, which production shows a Landmark
   * field on. The edit modal's Address tab does NOT show it — production's
   * doesn't either — so a landmark entered at creation is currently write-once.
   */
  landmark: string;
  pincode: string;
  state: string;
  street: string;
  subDistrict: string;
  /** Production's Add form labels this "Locality Name"; the edit modal, "Village Name". */
  village: string;
}

/**
 * A school, using ThinkTac production's field names verbatim.
 *
 * The names are production's, not ours — `typeofSchool` keeps its lowercase
 * 'o' — because a schema that is NEARLY the same is worse than one that is
 * either identical or openly different. Any later import or export lines up
 * field for field.
 *
 * FOUR FIELDS ARE OURS, NOT PRODUCTION'S, marked below. They exist because this
 * app's security model and table need them; production solves the same problems
 * elsewhere.
 */
export interface Institution {
  /** Mirrors the Firestore document id, as production does. */
  docId: string;

  institutionName: string;
  /** Board CODE: CBSE, ICSE, IB, … */
  board: string;
  classroomCounter: number;
  /** Boys | Girls | Co-ed */
  genderType: string;

  institutionAddress: InstitutionAddress;
  /**
   * The school's own code, e.g. "1000789". Editable on the edit modal's Basic
   * Info tab — it is deliberately NOT collected at creation, because the
   * reference's Add form does not ask for it.
   */
  institutionCode: string;

  /** Language CODE, not label: "EN", "HI", "KN". */
  medium: string;
  registrationNumber: string;

  /**
   * Phone is SPLIT, exactly as production stores it — dial code and subscriber
   * number in separate fields, never one combined E.164 string. The UI shows
   * the dial code as a prefix, so the halves stay separate all the way down.
   */
  representativeCountryCode: string;
  representativePhoneNumber: string;

  representativeEmail: string;
  representativeFirstName: string;
  representativeLastName: string;
  /** Denormalised from first + last on write, as production does. */
  representativeName: string;

  teachersRegistered: number;
  /** Full LABEL, not a code: "Private School" | "Government School". */
  typeofSchool: string;

  /**
   * Whether this school is a paying customer. Shown as a Yes / No select on the
   * edit modal's Basic Info tab, with a red or green marker on the control.
   *
   * Boolean rather than the literal 'Yes' / 'No' the select shows, so nothing
   * downstream has to compare against display text. It is NOT collected when an
   * institution is created — the Add form has no such field — so a new row
   * starts false and is switched here.
   */
  customerSchool: boolean;

  /** Real Firestore Timestamps, not ISO strings. */
  createdAt: Timestamp;
  creationDate: Timestamp;
  updatedAt: Timestamp;

  // --- Ours, not production's -------------------------------------------

  /**
   * OURS. A top-level collection's rule has no uid in the path to compare
   * against, so ownership lives in this field. Production scopes access
   * differently and has no equivalent.
   */
  ownerId: string;

  /** OURS. The STATUS toggle. */
  active: boolean;
  /** OURS. The Verified / Unverified filters. */
  verified: boolean;
}

/**
 * What the Add form collects.
 *
 * Everything the server sets is excluded: the id, the owner, all three
 * timestamps, the denormalised representativeName, and the two counters that
 * are maintained by other parts of the system rather than typed in.
 */
export type InstitutionDraft = Omit<
  Institution,
  | 'docId' | 'ownerId'
  | 'createdAt' | 'creationDate' | 'updatedAt'
  | 'representativeName'
  | 'classroomCounter' | 'teachersRegistered'
>;

/**
 * An institution sitting in tcdev_institutions/--trash--/DeletedInstitutes.
 *
 * The ENTIRE original document is preserved verbatim — this extends Institution
 * rather than picking a few display fields, so a restore puts back exactly what
 * was deleted, including fields this app does not render yet.
 *
 * ONE added field, `trashAt`, matching ThinkTac production
 * (institutions.service.ts: `set({ ...instituteDetails, trashAt: … })`). No
 * trashedBy and no originalCollection: production has neither, the docId is
 * unchanged, and there is only one place a deleted institution can go back to.
 */
export interface TrashedInstitution extends Institution {
  trashAt: Timestamp;
}

/** Metadata added by the trash, and removed again by a restore. */
export const TRASH_METADATA_FIELDS = ['trashAt'] as const;

/* ==========================================================================
   Classrooms

   Field names are ThinkTac production's verbatim, exactly as the Institution
   above borrows production's. A classroom created here and one created by
   teachercorner.thinktac.com line up field for field.
   ========================================================================== */

/**
 * A classroom is one of two things, and the type decides which fields matter.
 *
 * Stored as the SCREAMING form production stores — 'CLASSROOM' / 'STEM-CLUB' —
 * not a prettified label, because the table filters on it and production data
 * would not match a prettier value.
 */
export type ClassroomType = 'CLASSROOM' | 'STEM-CLUB';

/**
 * Locking details for ONE learning unit of a programme, inside one classroom.
 *
 * PRODUCTION'S SHAPE AND NAMES, taken from its own
 * select-programmes/learning-details component: an ARRAY on the classroom's
 * programme entry, positional against that programme's `learningUnitsIds`, not a
 * map keyed by unit id. Kept positional so a document written here is readable
 * by production and vice versa.
 *
 * `openAt` and `closeAt` are a Timestamp or the EMPTY STRING, never undefined or
 * null — again production's convention, and the one Firestore accepts, since it
 * rejects undefined outright.
 *
 * Old documents use `lockAt` / `unlockAt` for the same two dates. They are read
 * as fallbacks and never written.
 */
export interface ClassroomProgrammeWorkflow {
  /** The learning unit this row is about. */
  learningUnitId: string;
  /** Production's own id for the workflow. Carried through, never originated. */
  workflowId: string;
  openAt: Timestamp | '';
  closeAt: Timestamp | '';
  /** Locked to the student regardless of the dates. */
  workflowLocked: boolean;
  /** @deprecated Read for old documents; openAt is written. */
  lockAt?: Timestamp | '';
  /** @deprecated Read for old documents; closeAt is written. */
  unlockAt?: Timestamp | '';
}

/**
 * A programme AS RECORDED ON A CLASSROOM — a denormalised copy, not a
 * reference.
 *
 * The first four fields are what the table and the picker render, copied at the
 * moment the programme is attached. That is production's shape and it is the
 * right one here: the classroom list shows a programme name per row, and
 * resolving a reference per row would turn one query into hundreds.
 *
 * The trade is that renaming a catalogue programme does not retitle it on
 * classrooms already carrying it. Production accepts that, and so does this.
 *
 * The two locking fields below are per classroom, not per catalogue programme:
 * the same programme can open on different dates in two different classrooms.
 */
export interface ClassroomProgramme {
  programmeId: string;
  programmeName: string;
  programmeCode: string;
  /** What the UI shows. Falls back to programmeName when never overridden. */
  displayName: string;

  /**
   * Units unlock in order, one after the previous is finished.
   *
   * OPTIONAL because production deletes the key in several flows rather than
   * storing false, so a document may simply not have it. Absent means false.
   *
   * Mutually exclusive with the dates, which is production's rule, not an
   * invention: turning this on clears every openAt and closeAt, because a
   * sequence and a calendar would otherwise disagree about what is open.
   */
  sequentiallyLocked?: boolean;

  /** Per-unit locking, positional against the programme's learningUnitsIds. */
  workflowIds?: ClassroomProgrammeWorkflow[];
}

/**
 * A classroom or STEM club.
 *
 * ONE DEVIATION FROM PRODUCTION, and it is deliberate. Production DELETES the
 * fields that do not apply — a STEM club document has no `classroomName`,
 * `grade` or `section` at all, a classroom has no `stemClubName`. This app
 * stores every field always, empty where it does not apply.
 *
 * The reason is a bug this codebase already paid for once: normaliseInstitution
 * exists because reading a document that predates a field yields `undefined`,
 * which the type system cannot see and which Firestore rejects outright on the
 * way back in ("Unsupported field value: undefined"). Optional-by-absence
 * reintroduces exactly that, per row, forever. An empty string is readable,
 * writable, and cannot surprise a caller that forgot which variant it holds.
 */
export interface Classroom {
  /** Mirrors the Firestore document id, as production does. */
  docId: string;
  /**
   * The same value again, under production's name for it.
   *
   * Two fields holding one string is redundant and is kept anyway: production
   * writes both, other production collections join on `classroomId`, and a
   * document missing it would not survive a round trip through those.
   */
  classroomId: string;

  /**
   * Per-institution sequence, zero-padded to three digits: '001', '002'.
   *
   * A STRING, not a number, because the padding is the point — it is shown and
   * exported as an identifier, and 7 sorting after 10 is not what anyone wants.
   */
  classroomCode: string;

  type: ClassroomType;

  /** 'CLASSROOM' only: "8 B" — grade and section joined. Empty for a club. */
  classroomName: string;
  /** 'STEM-CLUB' only: the club's given name. Empty for a classroom. */
  stemClubName: string;

  /**
   * 'CLASSROOM' only. A STRING even for numeric grades, because the list mixes
   * 1–10 with 'Pre-primary 1'; one type beats a union that every comparison
   * has to narrow.
   */
  grade: string;
  /** 'CLASSROOM' only: 'A'–'Z', or 'NA'. */
  section: string;

  /** Copied from the institution at creation, as production copies it. */
  board: string;
  institutionId: string;
  institutionName: string;

  /** Keyed by programmeId, matching production's map-not-array shape. */
  programmes: Record<string, ClassroomProgramme>;

  studentCounter: number;
  /**
   * Storage path of the generated student-credentials file.
   *
   * Always '' today: the enrolment flow that produces the file does not exist
   * in this app yet. The field is written anyway so the schema matches
   * production and the table's Credentials column starts working the moment
   * something fills it, with no migration.
   */
  studentCredentialStoragePath: string;

  /** OURS, not production's. Ownership for a top-level collection's rules. */
  ownerId: string;

  /** Real Firestore Timestamps, not ISO strings. */
  creationDate: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * What the Add Classroom form collects.
 *
 * Everything the service derives is excluded: the ids, the owner, the
 * timestamps, the sequence number, and the two fields that start at zero and
 * empty.
 */
export type ClassroomDraft = Omit<
  Classroom,
  | 'docId' | 'classroomId' | 'classroomCode' | 'ownerId'
  | 'creationDate' | 'createdAt' | 'updatedAt'
  | 'studentCounter' | 'studentCredentialStoragePath'
>;

/** A classroom sitting in classrooms/trash/DeletedClassrooms. */
export interface TrashedClassroom extends Classroom {
  trashAt: Timestamp;
}

/* ==========================================================================
   Programmes
   ========================================================================== */

/**
 * Which kind of classroom a programme can be attached to.
 *
 * 'REGULAR' rather than 'CLASSROOM' — production's classroom-create maps
 * type 'CLASSROOM' to programmeType 'REGULAR', and the catalogue stores the
 * latter. Keeping production's word means its programmes filter correctly here.
 */
export type ProgrammeType = 'REGULAR' | 'STEM-CLUB';

/**
 * The two values production's Create Programme form offers, verbatim.
 *
 * 'DEVELOPEMENT' IS MISSPELLED, and is kept misspelled on purpose. It is the
 * literal stored in production (`programStatus = ['LIVE', 'DEVELOPEMENT']` in
 * add-new-programme.component.ts), so correcting the spelling here would mean
 * this app writing a status production does not recognise, and failing to match
 * the rows production has already written. The list page's Active / Draft filter
 * treats anything that is not LIVE as a draft, so a third value arriving from
 * production would still be classified sensibly.
 *
 * Only LIVE programmes are offered by the classroom pickers, matching
 * production, which filters `programmeStatus === 'LIVE'` before showing
 * anything.
 */
export type ProgrammeStatus = 'LIVE' | 'DEVELOPEMENT';

/**
 * A programme, using ThinkTac production's field names verbatim.
 *
 * Wider than it needs to be for this app alone: `learningUnitsIds`,
 * `assignmentIds` and `programmeImagePath` are stored but never populated here,
 * because the Learning Units and Assignments collections and Firebase Storage
 * are not wired into this app yet. They are written as empty rather than omitted
 * so a programme created here is the same SHAPE as one created by production —
 * which means the wizard steps that fill them can be added later without a
 * migration, and a production row round-trips through this app losing nothing.
 */
export interface Programme {
  docId: string;
  /** The id again under production's name, as with classroomId above. */
  programmeId: string;

  programmeName: string;
  /**
   * Sequential code, 'P' then five digits: P11697.
   *
   * ALLOCATED, not typed. See programmeCounterDoc() in core/firestore-paths.ts
   * for where the sequence lives and why it is per-teacher here where
   * production's is global.
   */
  programmeCode: string;
  /** Overrides programmeName in the UI when set. Defaults to it. */
  displayName: string;
  programmeDescription: string;

  /** The institution this programme belongs to. */
  institutionId: string;
  institutionName: string;

  /**
   * Which grades it covers, as STRINGS.
   *
   * Production stores these as numbers for 1–10 and strings for the pre-primary
   * years, so a row read from there is coerced on the way in. Empty for a
   * programme scoped by age instead, and for a STEM-CLUB programme, which is not
   * grade-scoped.
   *
   * A RANGE IS STORED EXPANDED. Production's form offers a 1-to-10 range slider
   * and writes every grade the range covers (`getAllclsInArray`), so grades 4–6
   * is stored as ['4','5','6'] and not as its endpoints. The list column
   * re-derives "4 - 6" for display.
   */
  grades: string[];
  /**
   * The alternative to grades: the age band the programme is written for.
   *
   * Production's form is an either/or — a toggle picks grade or age, and the
   * other is cleared. Expanded the same way grades is.
   */
  age: string[];

  type: ProgrammeType;
  programmeStatus: ProgrammeStatus;

  /**
   * Storage path of the programme's thumbnail, e.g.
   * `programme_images/{id}.png`.
   *
   * Always '' here: Firebase Storage is not initialised in this app, so nothing
   * can upload one.
   *
   * NOT SURFACED ANYWHERE. The list's Image column and the edit dialog's Upload
   * button were both removed: a column that could only ever read "N/A" and a
   * button that could not work are worse than their absence. The field is still
   * stored, so both can come back the day Storage is wired up.
   */
  programmeImagePath: string;

  /** Learning units attached to this programme. Always [] here. */
  learningUnitsIds: string[];
  /** Assignments attached to this programme. Always [] here. */
  assignmentIds: string[];

  /** OURS. */
  ownerId: string;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * What the Create Programme wizard collects.
 *
 * programmeCode is excluded because it is ALLOCATED from the counter by the
 * service, not entered — a form-supplied code would let two programmes claim
 * the same number.
 */
export type ProgrammeDraft = Omit<
  Programme,
  'docId' | 'programmeId' | 'programmeCode' | 'ownerId' | 'createdAt' | 'updatedAt'
>;

/** A programme sitting in programmes/trash/DeletedProgrammes. */
export interface TrashedProgramme extends Programme {
  trashAt: Timestamp;
}


/**
 * A learning unit or assignment AS THE PICKER NEEDS IT.
 *
 * Production's `LearningUnit` interface has more than seventy fields — every
 * resource path, six people's names and phone numbers, nine timing figures,
 * four description variants. The Manage Learning Units panel renders exactly
 * four of them: the code, the name, the languages, and the version
 * ("PT12 · DIY Sundial · TA · EN · vV22").
 *
 * This is that subset and nothing else, because it is what the panel is for. It
 * is deliberately NOT called LearningUnit: a type of that name should mean
 * production's full document, and a seventy-field interface with four fields
 * filled in is worse than an honest four-field one. If the full document is
 * needed later — for a Learning Units page of its own — it gets its own
 * interface and this stays the projection the picker reads.
 *
 * Both tabs pick from the same shape, so one interface serves both. What differs
 * is which collection they come from and which field on the programme records
 * them: `learningUnitsIds` or `assignmentIds`.
 */
/* ==========================================================================
   Learning units
   ========================================================================== */

/**
 * Status vocabulary, shared with Programme deliberately.
 *
 * Production types `LearningUnit.status` as a bare `string` and this app has not
 * enumerated every value it holds, so the reading here is the same defensive one
 * the Programme list uses: LIVE (or ACTIVE) is live, and ANYTHING ELSE is a
 * draft. An unrecognised status from production therefore lands under Draft
 * rather than vanishing from both filters.
 *
 * 'DEVELOPEMENT' keeps production's misspelling for the same reason it does on
 * Programme — it is a stored value, not display text.
 */
export type LearningUnitStatus = ProgrammeStatus;

/**
 * A learning unit — the activity a programme is built from.
 *
 * A DELIBERATE SUBSET of production's interface, which carries more than seventy
 * fields: every resource path, six people's names and phone numbers, nine timing
 * figures, four description variants, and six cross-reference arrays. The fields
 * below are the ones this app's list and forms actually render, under
 * production's exact names, so a row read from there lines up field for field
 * and a row written here is a valid production document with the optional parts
 * absent.
 *
 * The alternative — declaring all seventy and filling in fourteen — is the lie
 * normaliseInstitution exists to prevent: the type would promise fields no
 * writer sets, and the first save that copied one back would send undefined and
 * fail the whole document.
 */
export interface LearningUnit {
  docId: string;
  /** The id again under production's name, as with classroomId and programmeId. */
  learningUnitId: string;

  /** Short code shown in bold in every picker: 'PT12', 'NF05'. */
  learningUnitCode: string;
  learningUnitName: string;
  /** Overrides the name in the UI when set. Defaults to it. */
  learningUnitDisplayName: string;

  /**
   * ISO language code of THIS document: 'EN', 'TA'.
   *
   * Singular, because production stores one language per document — a unit that
   * exists in Tamil and English is two documents sharing a code. The programme
   * picker collapses them into one row showing both languages, which is why
   * PickableUnit below has a `languages` array where this has a single code.
   */
  isoCode: string;
  /** Version label, shown verbatim: 'vV22'. */
  version: string;

  status: LearningUnitStatus;

  /**
   * Type of unit — 'TACtivity', 'Tool TAC'. Production's `Configuration`
   * vocabulary; see LEARNING_UNIT_TYPES.
   */
  type: string;
  /**
   * The type's short code, stored ALONGSIDE the name rather than derived.
   *
   * Production stores both, and `learningUnitId` is built from this one
   * ('TA-AE04-EN-V10'), so a unit whose type was renamed keeps the code its id
   * was minted with. Deriving it at read time would silently rewrite ids.
   */
  typeCode: string;

  /**
   * Maturity — 'Gold', 'Silver', 'Diamond', 'Platinum'.
   *
   * CAPITAL M, which is not this codebase's convention but IS production's field
   * name. Renaming it would break the "a row read from production lines up field
   * for field" promise this interface is built on.
   */
  Maturity: string;

  /**
   * Categorisation, as production names it.
   *
   * SIX fields, not two, and all six are DERIVED FROM THE CODE rather than
   * chosen: production looks the code's letter pair up in the taxonomy and fills
   * every one of these from the matching row. They are stored rather than
   * recomputed because the taxonomy is versioned config — a row edited later
   * must not retroactively recategorise units already written under it.
   */
  subjectCode: string;
  subjectName: string;
  domainCode: string;
  domainName: string;
  subDomainCode: string;
  subDomainName: string;
  /** The two letters of the code concatenated: 'AE' for AE04. */
  compositeCode: string;

  /**
   * Owner's display name, denormalised.
   *
   * The Trash table has an Owner column and reads it straight from the deleted
   * document — a join back to the profile would be a read per row for a name
   * that was already known when the unit was created.
   */
  tacOwnerName: string;

  shortDescription: string;
  /**
   * A STRING, not a number. Production types it `number | string` and stores
   * both, so one type here removes a branch at every comparison — the same
   * choice Classroom.grade makes.
   */
  difficultyLevel: string;
  /** Total minutes. A number, because the list right-aligns and sums it. */
  totalTime: number;

  /** OURS. Ownership for a top-level collection's rules. */
  ownerId: string;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** What the Add Learning Unit form collects. */
export type LearningUnitDraft = Omit<
  LearningUnit,
  'docId' | 'learningUnitId' | 'ownerId' | 'createdAt' | 'updatedAt'
>;

/** A learning unit sitting in learningUnits/trash/DeletedLearningUnits. */
export interface TrashedLearningUnit extends LearningUnit {
  trashAt: Timestamp;
}

export interface PickableUnit {
  /** Firestore document id, and what is stored in the programme's id array. */
  docId: string;
  /** Short code shown in bold: 'PT12', 'NF05'. */
  code: string;
  name: string;
  /**
   * ISO language codes the unit exists in: ['TA', 'EN'].
   *
   * Drives the panel's "All languages" filter. Production stores a single
   * `isoCode` per document and the panel shows several, so a unit is really a
   * family of rows; this collapses that to one row with several languages, which
   * is what the panel actually displays.
   */
  languages: string[];
  /** Version label, shown verbatim: 'vV22'. */
  version: string;
}

/* ==========================================================================
   Teachers

   NOT TeacherProfile, which is the next interface down. The distinction is the
   whole reason both exist:

     TeacherProfile   users/{uid}      WHO IS SIGNED IN. One per Firebase Auth
                                       account, keyed by uid, edited on /profile.

     Teacher          teachers/{id}    SOMEBODY A SIGNED-IN ADMIN REGISTERED.
                                       A record ABOUT a person, with no account
                                       behind it — they cannot sign in, and no
                                       Firebase Auth user is created for them.

   A Teacher is therefore data, not an identity. That was a deliberate choice:
   Firebase Auth is per-PROJECT, so creating accounts here would add users to
   every other application in the project as well. The `email` field is
   collected anyway, so an invite flow can be added later without reshaping a
   single stored document.
   ========================================================================== */

/**
 * One class a teacher takes: a grade, a section and the programme running in it.
 */
/**
 * One programme on a teacher's classroom entry.
 *
 * PRODUCTION'S SHAPE AND NAMES, taken from Teachers/{id}.classrooms[].programmes
 * in thinktac-india-production: an ARRAY on the classroom entry, carrying the
 * same five keys ClassroomProgramme does minus the workflow. Kept identical so a
 * document written here is readable by production and vice versa.
 *
 * The names are a SNAPSHOT at assignment time, the same trade ClassroomProgramme
 * makes. ProgrammeService.propagateRename refreshes them on a rename.
 */
export interface TeacherProgramme {
  /** programmes/{docId}. */
  programmeId: string;
  programmeName: string;
  displayName: string;
  programmeCode: string;
  sequentiallyLocked: boolean;
}

/**
 * One classroom a teacher takes, as stored ON THE TEACHER.
 *
 * A DENORMALISED COPY of classrooms/{docId}, not a reference. Production does
 * the same: a teacher's classrooms map carries the classroom's name, grade,
 * section, type and its school's name, so rendering a teacher costs one read
 * rather than one per classroom.
 *
 * `userRole` is PER CLASSROOM, not per teacher — production models a person who
 * is a schoolTeacher in one classroom and something else in another, and this
 * follows it rather than hoisting one role onto the teacher.
 */
export interface TeacherClassroom {
  /** In use or not. Production's per-classroom flag. */
  activeStatus: boolean;

  /** classrooms/{docId}. The key this entry is stored under, repeated inside. */
  classroomId: string;
  classroomName: string;

  /** Bare, as stored: '1', not 'Class 1'. Empty for a STEM club. */
  grade: string;
  /** A–Z, or 'NA'. Empty for a STEM club. */
  section: string;

  /** institutions/{docId}, and its name denormalised alongside. */
  institutionId: string;
  institutionName: string;

  type: ClassroomType;

  /** This teacher's role IN THIS CLASSROOM, e.g. 'schoolTeacher'. */
  userRole: string;

  programmes: TeacherProgramme[];

  createdAt: Timestamp;
}

/**
 * The person, grouped into one map.
 *
 * PRODUCTION'S `teacherMeta`. Identity lives here rather than at the top level
 * so the document splits cleanly into "who they are" and "what they teach", and
 * so a profile edit writes one field.
 *
 * `phone` AND `phoneNumber` both carry the subscriber digits. That duplication is
 * production's, kept deliberately: dropping either makes a document this app
 * writes unreadable to a production reader that expects the other.
 *
 * `uid` is the teacher's Firebase Auth uid, and is EMPTY until they sign in.
 * Registering a teacher creates no Auth user — see the Teacher/TeacherProfile
 * distinction above — so there is nothing to put here at creation time.
 */
export interface TeacherMeta {
  /** Dial code only, e.g. '+91'. Never folded into the number. */
  countryCode: string;

  email: string;

  firstName: string;
  lastName: string;

  /** first + last, lowercased and stripped of spaces. Production's search key. */
  fullNameLowerCase: string;

  /** Subscriber digits only — no dial code, no separators. */
  phone: string;
  /** The same digits under production's other name for them. */
  phoneNumber: string;

  /**
   * Firebase Auth uid — ABSENT until this teacher has signed in.
   *
   * OMITTED RATHER THAN EMPTY. Registering a teacher creates no Auth user, so
   * there is no uid to record; writing '' would put a field on the document that
   * looks answered and is not. ProfileService adds it the first time that person
   * signs in with the number an admin registered.
   */
  uid?: string;

  updatedAt: Timestamp;
}


/**
 * teachers/{teacherId} — a teacher registered against one institution.
 *
 * OWNERSHIP AND MEMBERSHIP ARE TWO DIFFERENT FIELDS, and conflating them is the
 * mistake this shape exists to prevent:
 *
 *   ownerId        the ADMIN who registered this teacher. What the security
 *                  rules check, and what every query filters on.
 *   institutionId  the SCHOOL they teach at. What the UI groups by.
 *
 * The phone is SPLIT, exactly as an institution's representative phone is —
 * dial code and subscriber digits in separate fields, never one combined E.164
 * string — so the two can never disagree about which country a number is from.
 */
export interface Teacher {
  /**
   * Mirrors the Firestore document id, as every other collection here does.
   *
   * A CLIENT-ALLOCATED ID, not the phone and not an Auth uid. A phone number can
   * be reassigned to another person and a document id cannot be changed once
   * written, so an id encoding the number would outlive the fact. The number
   * lives on teacherMeta, where findKnownTeacher matches on it — that lookup is
   * what stops a second document being written for one person.
   */
  docId: string;

  /**
   * The admin who registered them. Set from the session, never from a form.
   *
   * NOT PRODUCTION'S, and kept regardless: the trash queries and
   * ownedActiveTeachers filter on it, and the rules' ownership helpers read it.
   */
  ownerId: string;

  /** Who they are. */
  teacherMeta: TeacherMeta;

  /**
   * What they teach, KEYED BY classroomId.
   *
   * A MAP rather than an array, following production, and it is the better shape
   * here too: attaching one classroom is a single dotted-path write that cannot
   * disturb the others, where an array has to be rewritten whole.
   */
  classrooms: Record<string, TeacherClassroom>;

  /** Touched by activity, not by an edit. Production's field. */
  lastActivityAt: Timestamp;

  updatedAt: Timestamp;
}


/**
 * What the caller supplies. Everything else is the service's to set.
 *
 * `teacherName` is derived, `ownerId` comes from the session, and the three
 * timestamps are the server's — a caller-supplied value for any of them would
 * either be ignored or rejected by the rules.
 */
export type TeacherDraft = Omit<
  Teacher,
  'docId' | 'ownerId' | 'lastActivityAt' | 'updatedAt'
>;

/**
 * A teacher sitting in teachers/trash/DeletedTeachers.
 *
 * Extends Teacher rather than picking display fields, so a restore puts back
 * exactly what was deleted. One added field, `trashAt`, matching what
 * institutions, classrooms, programmes and learning units all do.
 */
export interface TrashedTeacher extends Teacher {
  trashAt: Timestamp;
}

/**
 * tcdev_users/{uid} — the teacher's own profile document.
 *
 * First and last name are stored separately rather than as one displayName,
 * because the form edits them as two fields and splitting a combined string
 * back apart guesses wrong on names with more than two parts.
 */
export interface TeacherProfile {
  uid: string;
  firstName: string;
  lastName: string;
  email: string;
  /** Subscriber digits; the dial code is held separately, as above. */
  phone: string;

  /**
   * What this account is. 'Teacher' today, because that is the only sign-in
   * this app offers.
   *
   * Stored on the document rather than derived at render, so the database is
   * self-describing: anyone reading users/{uid} in the console can see what the
   * account is without knowing which app wrote it.
   */
  role: UserRole;

  /** Set once, when the profile document is first written. Never rewritten. */
  createdAt: Timestamp;
  /** Moved on every save, so the console shows when the profile last changed. */
  updatedAt: Timestamp;

  /**
   * Sign-in bookkeeping, written on every successful sign-in.
   *
   * The point is that users/{uid} exists for EVERY teacher who has ever signed
   * in, not only for those who happened to open the profile form and save it.
   * Without this the collection recorded a subset of the people using the app,
   * so there was no way to answer "who has access" or to resolve a uid on an
   * institution back to a name.
   *
   * Optional because documents written before this existed have neither.
   */
  lastSignInAt?: Timestamp;
  signInCount?: number;
  /** Which provider was used last: 'password', 'google.com', … */
  lastSignInProvider?: string;

  /* ------------------------------------------------------------------------
     Registration — what Create Account collects.

     ALL OPTIONAL, and that is not laziness. users/{uid} is written by
     recordSignIn() on the very first sign-in, before the teacher has seen the
     registration form, so a document with none of these fields is the normal
     state rather than a broken one. Every reader has to cope with their absence.

     Stored on the user document rather than as an Institution and a Classroom,
     on instruction. `institutionId` is a reference to a real institutions/{id}
     when one was picked, so the link is not lost if that changes later.
     ------------------------------------------------------------------------ */

  /**
   * THE FLAG THE ROUTING TURNS ON. True only once Create Account has been
   * submitted successfully.
   *
   * Deliberately not inferred from "does firstName have a value": recordSignIn()
   * seeds firstName from the auth display name, and for a phone sign-in that
   * falls back to the literal 'Teacher', so a name-based check would treat every
   * brand-new phone user as already registered.
   */
  /**
   * One self-registration request, matching production's
   * Users/{uid}.selfRegTeacherApproval entries.
   *
   * An ADMIN flips `approvalStatus` from false to true, in the console or in the
   * admin app. Nothing in this app writes it — see ProfileService.gate(), which
   * only ever reads it.
   *
   * Production's entry carries the first four keys. The rest are carried here so
   * an approval has something to PROMOTE: the teaching details are not written to
   * the profile until the request is granted, so they have to survive somewhere in
   * the meantime, and the request itself is the honest place for them. A
   * production reader ignores the extra keys.
   */
  selfRegTeacherApproval?: Record<string, {
    approvalStatus: boolean;
    classroomId: string;
    classroomName: string;
    institutionName: string;

    institutionId?: string;
    grade?: string;
    section?: string;
    programmeId?: string;
    programmeName?: string;
  }>;

  profileComplete?: boolean;

  /**
   * Whether an administrator has let this teacher in.
   *
   * NAMED IN PascalCase, unlike every other field on this document, because that
   * is what already exists in Firestore. Matching the data beat renaming it: the
   * document was created by hand before this code read it.
   *
   * Written `false` by Create Account and flipped to `true` by hand in the
   * Firestore console. Until then the teacher sits on /approval-page: registered,
   * signed in, and with nothing else reachable.
   *
   * SEPARATE FROM profileComplete on purpose. One says "they finished the form",
   * the other says "we accepted them", and collapsing the two would mean either
   * admitting everyone who registers or being unable to tell a half-finished form
   * from a rejected application.
   *
   * Optional, and absence means NOT approved. Documents written before this field
   * existed therefore gate too, which is the safe direction: a teacher who should
   * be in gets let in by one edit, where the reverse would silently admit
   * everybody.
   */
  ApprovedStatus?: boolean;

  /* ------------------------------------------------------------------------
     Fields named to match production's Users/{uid} document, so a reader who
     knows that collection recognises this one.

     ADDITIVE ONLY. users/{uid} already exists in this project and is written by
     recordSignIn(); every field here is optional and every write uses
     merge:true, so nothing already on a document is removed or overwritten by
     registering.

     `phone` is NOT renamed to production's `phoneNumber`. It already carries the
     same value and is read across this app; adding a second name for one value
     is how two fields drift apart. `countryCode` is added alongside it because
     production keeps the dial code separate and this app did not store it at all.
     ------------------------------------------------------------------------ */

  /** Mirrors the document id, as production does. Redundant by design: it makes
   *  an exported row self-describing without its path. */
  docId?: string;
  id?: string;

  /** Dial code, kept apart from the subscriber digits in `phone`. */
  countryCode?: string;

  /** First write only, so it records when the account began rather than the last edit. */
  registeredAt?: Timestamp;

  /** How the account came into being: 'EXOTEL' for a phone OTP, otherwise the
   *  Firebase provider id. Production writes the same literal for its OTP users. */
  registeredFrom?: string;

  /**
   * The class this teacher registered against.
   *
   * A MAP rather than more top-level fields, mirroring production's
   * currentStudentInfo. The flat country/board/grade fields below record what was
   * typed on the form; this records what it resolved to, so a renamed institution
   * or a moved classroom can be followed by id instead of by matching strings.
   */
  currentClassInfo?: {
    institutionId: string;
    institutionName: string;
    classroomName: string;
    programmeId: string;
    programmeName: string;
  };

  country?: string;
  pincode?: string;
  /** Board CODE, e.g. 'CBSE' — the same code BOARDS uses, not the long label. */
  board?: string;
  institutionId?: string;
  /** Denormalised so a profile can be read without a second lookup. */
  institutionName?: string;
  grade?: string;
  section?: string;
  programmeId?: string;
  programmeName?: string;
}

/** What the dashboard banner shows. */
export interface DashboardCounts {
  institutions: number;
  classrooms: number;
}

/* ==========================================================================
   Notifications

   Stored per teacher at users/{uid}/notifications/{docId} — see the note in
   core/firestore-paths.ts for why that location rather than a shared collection.

   FIELD NAMES ARE PRODUCTION'S where production has an equivalent: `title`,
   `description`, `read`, and the three id fields its own Notification interface
   carries (institutionId, classroomId, programmeId). Its `time` is a string; this
   uses a real Timestamp, as every other date in this app does.
   ========================================================================== */

/** Which module the event came from. Drives the icon and the grouping. */
export type NotificationModule = 'institution' | 'classroom' | 'programme';

/**
 * What happened. One vocabulary across all three modules, so the feed can be
 * filtered or counted by action without knowing which module it came from.
 */
export type NotificationAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'restored'
  | 'verified'
  | 'unverified'
  | 'assigned'
  | 'unassigned'
  | 'status';

export interface TeacherNotification {
  /** Mirrors the Firestore document id. Named `id` because the panel keys on it. */
  id: string;

  module: NotificationModule;
  action: NotificationAction;

  /** One line, e.g. "Institution added". */
  title: string;
  /** The sentence beneath it, naming the thing that changed. */
  description: string;

  /**
   * The document the event was about, so a future click can navigate to it.
   * Only the field for this notification's own module is set.
   */
  institutionId?: string;
  classroomId?: string;
  programmeId?: string;

  read: boolean;
  createdAt: Timestamp;
}

/**
 * What the caller supplies. Everything else — the id, the timestamp and the
 * unread flag — belongs to the write.
 */
export type NotificationDraft = Omit<TeacherNotification, 'id' | 'read' | 'createdAt'>;

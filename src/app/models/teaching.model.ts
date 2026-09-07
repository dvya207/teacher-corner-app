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

  /* ----------------------------------------------------------------------
     WHAT THE UNIT ACTUALLY IS — a denormalised copy.

     A DEPARTURE FROM PRODUCTION, and the only one in this interface.
     Production stores the id and the locking fields and nothing else, so
     reading a classroom document tells you a class is allotted
     'pb76Suhm2xIp3HZIY67g' and not one word about what that is. Every reader
     then has to join against the learningUnits collection to render a row.

     Stored on instruction, and the same trade the fields above this make for
     programmes: `programmeName` and `programmeCode` are already denormalised
     onto the classroom for exactly this reason. The cost is identical too —
     renaming a unit in the catalogue does not retitle it on classrooms already
     carrying it — and it is mitigated the same way: these are RE-DERIVED on
     every write of the entry, so any edit refreshes them.

     SAFE FOR PRODUCTION EITHER WAY. Firestore stores unknown keys without
     complaint and production's own forms read `workflowIds` by name
     (`wf?.workflowId`, `wf.learningUnitId`), so extra fields are ignored rather
     than rejected.

     OPTIONAL, unlike everything above, because that is the honest type for them:
     a document written by production carries none of these, and a required field
     that reads back `undefined` is the exact trap normaliseInstitution exists to
     prevent. Written as '' by this app when the unit cannot be found, never
     omitted.
     ---------------------------------------------------------------------- */

  /** 'AE05' — the short code shown in bold in every picker. */
  learningUnitCode?: string;
  /** The display name where set, else the plain name. What a card renders. */
  learningUnitName?: string;
  /** 'TACtivity', 'MuT'. Production's Configuration vocabulary. */
  learningUnitType?: string;
  /** 'V10'. One document per version, so this identifies which. */
  learningUnitVersion?: string;
  /** 'EN', 'TA'. One language per document, so this says which one is allotted. */
  learningUnitIsoCode?: string;
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
 * `programmeImagePath` is stored but was never populated here,
 * because the Learning Units and Assignments collections and Firebase Storage
 * are not wired into this app yet. They are written as empty rather than omitted
 * so a programme created here is the same SHAPE as one created by production —
 * which means the wizard steps that fill them can be added later without a
 * migration, and a production row round-trips through this app losing nothing.
 */
/**
 * One assignment allotted to a programme.
 *
 * TWO FIELDS, EXACTLY, across all 20 non-empty entries in production: the id, and
 * a due date. The id is duplicated inside the entry as well as being the map key,
 * which is redundant and is production's shape — a reader that has the entry
 * alone still knows which assignment it is.
 *
 * `assignmentDueDate` comes from a prompt: production opens a "Set a due date for
 * this Assignment" dialog when an assignment is dropped into the selected column.
 * Every stored entry has one.
 */
export interface ProgrammeAssignment {
  assignmentId: string;
  assignmentDueDate: Timestamp | null;
}

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

  /** Learning units attached to this programme, IN ORDER — see below. */
  learningUnitsIds: string[];

  /**
   * The assignments allotted to this programme, KEYED BY DOC ID.
   *
   * A MAP, NOT AN ARRAY, read off production's own collection rather than
   * assumed: 2715 of its 14240 programmes carry `assignmentIds` as a map, every
   * entry shaped `{ assignmentId, assignmentDueDate }`, and the key always equals
   * the `assignmentId` inside it.
   *
   * `assignmentsIds` — with the extra 's' — IS NOT THIS FIELD. It appears on
   * exactly ONE document in the whole collection, `--schema--`, as an array of two
   * strings. Another schema-document artefact, like `questionsSchema` on a quiz:
   * the official-looking source and the wrong one to follow.
   *
   * ORDER DOES NOT MATTER, unlike `learningUnitsIds` above, and that follows from
   * the shape rather than from taste: a map has no order to preserve. It is why
   * the picker for these exposes no reordering where the unit picker must.
   *
   * OPTIONAL because most programmes lack the key entirely.
   */
  assignmentIds?: Record<string, ProgrammeAssignment>;
  /**
   * PRODUCTION'S, and derived rather than collected.
   *
   * `activeStatus` duplicates what `programmeStatus` already says, and
   * production's own screens filter on the boolean — so a document written
   * without it reads as inactive there. ProgrammeService keeps the two in step
   * on both create and update; nothing asks a form for it.
   */
  activeStatus: boolean;

  /**
   * Which surface wrote the document, and whether it was a developer's machine.
   *
   * Production stores both. `createdSource` names the flow — its own says
   * 'one-click-institution-classroom-programme-creation' — and this app writes a
   * value naming ITS wizard rather than borrowing that one, because a row
   * claiming production's flow would be misattributed forever.
   */
  createdSource: string;
  isLocalHost: boolean;

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
  | 'docId'
  | 'programmeId'
  | 'programmeCode'
  | 'ownerId'
  | 'createdAt'
  | 'updatedAt'
  // DERIVED OR STAMPED BY THE SERVICE, never collected. activeStatus follows
  // programmeStatus, and the other two describe where the write came from — a
  // form-supplied value for any of the three could only be wrong.
  | 'activeStatus'
  | 'createdSource'
  | 'isLocalHost'
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
 * them: `learningUnitsIds`.
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
   * Type of unit — 'TACtivity', 'MuT', 'Toys and Tales'. Production's `Configuration`
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

  /**
   * The five descriptions the editor's Descriptions tab carries.
   *
   * `shortDescription` and `longDescription` are the unit's own copy;
   * `alternate*` are production's second pair, used where a different audience
   * needs different wording for the same unit. All four are production's field
   * names verbatim.
   *
   * `tinyDescription` is the exception: the editor shows it, production's
   * documents do not carry it yet, and this is the name it is being written
   * under. A document saved before today reads it back as '' like the rest.
   */
  shortDescription: string;
  longDescription: string;
  alternateShortDescription: string;
  alternateLongDescription: string;
  tinyDescription: string;

  /**
   * The headline image's stored path, and the thumbnail generated from it.
   *
   * PATHS, not URLs. Production stores
   * `learningUnits/{docId}/learningUnitImage.jpg` — a location inside the
   * Storage bucket, which a download URL is then minted from. Storing the URL
   * instead would bake in a token that can be revoked.
   *
   * The preview is written by production's own resize step, not by this app; it
   * is carried here so an edit cannot drop it.
   */
  learningUnitImage: string;
  learningUnitPreviewImage: string;

  /**
   * Production's `resources` map, of which this app currently names two keys.
   *
   * The real map is far wider — guidePath, materialPath, observationPath, the
   * maturity ids, the video URLs — and its full shape is decided by
   * learning-unit-resource-schema.ts rather than by this interface. Only the two
   * the Images tab edits are typed; the index signature carries the rest through
   * an edit untouched instead of dropping the keys this app does not know.
   */
  resources: LearningUnitResources;
  /**
   * ONE field, 0 to 5. Production also carries a typo'd `difficultiesLevel`
   * beside it; this app writes only this one, so there is a single place a
   * difficulty can be read from and no pair that can silently disagree.
   *
   * A STRING, not a number. Production types it `number | string` and stores
   * both, so one type here removes a branch at every comparison — the same
   * choice Classroom.grade makes.
   */
  difficultyLevel: string;

  /**
   * The three timings, in minutes, exactly as production names them.
   *
   * `learnTime` is the stored name and "Learning Time" is the label the editor
   * shows — the mismatch is production's and is kept, because renaming the field
   * would orphan the value in every document already written.
   *
   * Numbers rather than strings, like totalTime: the list right-aligns and sums
   * them. Production's own documents carry all three as int64 and default them to
   * 0 rather than leaving them absent.
   */
  exploreTime: number;
  learnTime: number;
  /** Total minutes. A number, because the list right-aligns and sums it. */
  totalTime: number;

  /* ----------------------------------------------------------------------
     THE REST OF PRODUCTION'S DOCUMENT
     ----------------------------------------------------------------------
     Read off LearningUnits/0MvRXYORh342Es0Gkd42 in thinktac-india-production —
     sixty top-level fields, of which the ones above are the twenty-odd this app
     shows. These are the remainder.

     They are here so an edit CARRIES them rather than editing around them, and
     so a unit this app creates is the same shape as one production created. No
     screen edits them yet; several never will, because they are written by
     pipelines rather than by people.
     ---------------------------------------------------------------------- */

  /** The other two timings. Production writes all five, defaulting to 0. */
  makingTime: number;
  observationTime: number;

  /** A STRING in production, not a timestamp, and usually ''. */
  firstLiveDate: string;

  /** What this unit was stamped from. A constant in production's own data. */
  masterDocId: string;

  /** True once a resource document exists for the unit. Written by the pipeline. */
  containsResources: boolean;

  domain: string;
  numberOfTemplates: string;
  samples: string;
  tools: string;
  topicCodes: string;
  totalViews: number;
  userFeedback: string;
  versionNotes: string;

  /**
   * The three people on a unit, each with a name and a split phone number.
   * `tacOwnerName` is above, with the fields the Trash table reads.
   */
  tacOwnerCountryCode: string;
  tacOwnerPhoneNumber: string;
  tacArchitectName: string;
  tacArchitectCountryCode: string;
  tacArchitectPhoneNumber: string;
  tacMentorName: string;
  tacMentorCountryCode: string;
  tacMentorPhoneNumber: string;

  /**
   * The five learning-unit relationships and the tag list, all arrays of ids.
   * Empty on every unit sampled; carried so an edit cannot drop a populated one.
   */
  associatedLearningUnits: string[];
  prerequisiteLearningUnits: string[];
  replacementLearningUnits: string[];
  similarLearningUnits: string[];
  tags: string[];
  /**
   * Extra material hung off a unit by hand — a PDF, a YouTube link, a deck.
   *
   * Typed now that the editor has a tab for them. Production stores an array of
   * objects here; every unit sampled has it empty, so these field names come
   * from its own Additional Resources form rather than from stored data.
   */
  additionalResources: LearningUnitAdditionalResource[];

  /**
   * What a unit has been attached to, written by whatever does the attaching.
   *
   * Absent from some production documents and present on others, which is why
   * they were missed on the first pass: the unit read to build this interface
   * did not carry them. Read defensively for the same reason.
   */
  linkedClassroomIds: string[];
  linkedProgrammeIds: string[];
  linkedWorkflowIds: string[];

  /** OURS. Ownership for a top-level collection's rules. */
  ownerId: string;

  /**
   * ONE creation stamp, not two.
   *
   * Production carries `creationDate` beside this and holds the same value in
   * both. Only this one is kept: it is what list() sorts on and what the trash
   * round trip preserves, and a pair that can drift is worth less than either
   * half. Institutions and classrooms keep their own `creationDate` — that is
   * their services' field, and untouched by this.
   */
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** What the Add Learning Unit form collects. */
export type LearningUnitDraft = Omit<
  LearningUnit,
  'docId' | 'learningUnitId' | 'ownerId' | 'createdAt' | 'updatedAt'
>;

/**
 * The `resources` map on a learning unit.
 *
 * Two named keys and an open tail. A learning unit's resource slots are decided
 * by its type and maturity — see learning-unit-resource-schema.ts — so
 * enumerating them here would be a second, weaker copy of that table which
 * would fall behind it. The index signature is `unknown` rather than `string`
 * because the schema's leaves are of two shapes: a plain path, or an object
 * carrying a per-grade path.
 */
export interface LearningUnitResources {
  /**
   * The maturity ladder: the id of the resource document at each rung.
   *
   * OPTIONAL, because a unit carries ONLY the rungs it has reached. Across 1200
   * production units: a Silver unit has `silver` alone, a Gold one has `silver`
   * and `gold`, and a Platinum one adds `platinum`. Writing all four would
   * claim rungs the unit has not got to.
   */
  silver?: string;
  gold?: string;
  platinum?: string;
  diamond?: string;

  guidePath: string;
  materialPath: string;
  observationPath: string;
  templatePath: string;
  topicGuidePath: string;
  varGuidePath: string;

  otherImagePath: string;
  qrCodeImagePath: string;

  videoUrl: string;
  topicVideoUrl: string;
  varVideoUrl: string;

  [key: string]: unknown;
}

/**
 * The eleven keys EVERY unit carries, whatever its maturity.
 *
 * The ladder keys are not here: they depend on how far the unit has got, and
 * `ladderKeysFor` adds the right ones at creation.
 */
export function emptyLearningUnitResources(): LearningUnitResources {
  return {
    guidePath: '',
    materialPath: '',
    observationPath: '',
    templatePath: '',
    topicGuidePath: '',
    varGuidePath: '',
    otherImagePath: '',
    qrCodeImagePath: '',
    videoUrl: '',
    topicVideoUrl: '',
    varVideoUrl: ''
  };
}

/**
 * The ladder keys a unit at this maturity carries, all empty.
 *
 * Cumulative and lowercase — the map keys them 'gold' where the unit's own
 * Maturity field says 'Gold'. An unrecognised maturity yields none rather than
 * guessing, which is what production's own handful of odd units look like.
 */
export function ladderKeysFor(maturity: string): Record<string, string> {
  const rungs = ['Silver', 'Gold', 'Platinum', 'Diamond'];
  const reached = rungs.indexOf(
    String(maturity ?? '').trim().toLowerCase().replace(/^./, c => c.toUpperCase())
  );

  if (reached < 0) {
    return {};
  }

  return Object.fromEntries(rungs.slice(0, reached + 1).map(rung => [rung.toLowerCase(), '']));
}

/**
 * One entry in a unit's `additionalResources`, in production's own field names.
 *
 * Read off 538 real entries across 1834 production units, which is why these
 * names look the way they do:
 *
 *   `shortdescription`  ALL LOWERCASE. Not shortDescription, which is what the
 *                       rest of this model uses. Reproduced, not corrected.
 *   `type`              Only ever 'UPLOAD' or 'VIDEO'. It says how the resource
 *                       ARRIVES, not what it is.
 *   `fileExtension`     What it actually is: 'pptx' (320), 'video' (144),
 *                       'ppt' (65), 'pdf' (8).
 *   `publish`           A BOOLEAN on 537 of the 538. One document has the string
 *                       'false'; that one is the outlier and this app writes the
 *                       boolean.
 */
export interface LearningUnitAdditionalResource {
  title: string;
  shortdescription: string;
  /** How it arrives. '' until a file type is chosen. */
  type: 'UPLOAD' | 'VIDEO' | '';
  /** 'pdf', 'ppt', 'pptx' or 'video'. */
  fileExtension: string;
  /** A Storage path for an upload, or the link itself for a video. */
  resourcePath: string;
  publish: boolean;
}

/**
 * One board's files for one grade-dependent slot of one learning unit.
 *
 * Read off BoardGradeResources/07CnoSDs8tUFw1ZSy8Pp in
 * thinktac-india-production. The grades live INSIDE it, keyed `grade_03`, so a
 * file covering grades 3 to 5 is three keys on one document rather than three
 * documents.
 */
export interface BoardGradeResource {
  docId: string;
  learningUnitDocId: string;
  learningUnitId: string;
  /** 'Gold' — capitalised, as the unit spells it. */
  maturity: string;
  /** The unit's type, spaces and all. */
  type: string;
  /** '3S', 'tacDev', 'graphics'. */
  category: string;
  /** The slot key within that category, e.g. 'tttPpts'. */
  subCategory: string;
  /** 'CBSE', 'ICSE', 'IGCSE' … one document per board. */
  board: string;
  /** Keyed `grade_01` … `grade_10`, each holding a Storage path. */
  resources: Record<string, string>;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

/**
 * ONE RUNG OF ONE LEARNING UNIT'S RESOURCES.
 *
 * Read off LearningUnitResources/0QzDnKKFYPGkqpg6EWH4 in
 * thinktac-india-production. A unit at Gold has two of these — Silver and Gold —
 * because the maturity ladder is cumulative.
 *
 * EIGHT FIELDS, which is what production writes today. Sampling sixty of its
 * documents, `id` and `archives` appear ONLY on those created between 2024-12
 * and 2025-03; the other thirty-five, including every one from 2026, carry
 * neither. Both are therefore optional here: read when present, never written.
 */
export interface LearningUnitResource {
  docId: string;
  /** LEGACY. Held the same value as docId on documents from that window. */
  id?: string;

  /** The owning unit's DOCUMENT id — the half of its identity that cannot change. */
  learningUnitDocId: string;
  /** The owning unit's readable id, e.g. 'TA-BP11-EN-V18'. Denormalised. */
  learningUnitId: string;

  /** Capitalised on this document — 'Gold' — where the schema keys it 'gold'. */
  maturity: string;
  /** The unit's type, spaces and all: 'TACtivity', 'Toys and Tales'. */
  type: string;

  /**
   * LEGACY, like `id`. Slots that had been superseded, as dotted paths into
   * `resources` — 'graphics.tacGuideOnline'. Read where a document has it;
   * nothing this app writes creates one.
   */
  archives?: string[];

  resources: LearningUnitResourceCategories;

  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

/**
 * The five categories, each a bag of slots.
 *
 * NOT narrowed to the five names, and not to a fixed slot list: which
 * categories a document has depends on its type AND its maturity — TACtivity's
 * platinum has no socialMedia, its diamond no 3S — and the slot list comes from
 * LEARNING_UNIT_RESOURCE_SCHEMA, which is generated from a Google Sheet. Typing
 * it here would be a second, weaker copy of that table.
 */
export type LearningUnitResourceCategories = Record<
  string,
  Record<string, LearningUnitResourceSlot>
>;

/**
 * A slot: either one path, or a bag of per-grade and per-board paths.
 *
 * The object form is what production's sheet marks isGradeDependent. It always
 * carries `universalGradeBoardResourcePath` as the fallback, and may also carry
 * a board id — 'CBSE', 'ICSE' — pointing at a board-specific document.
 */
export type LearningUnitResourceSlot =
  | string
  | { universalGradeBoardResourcePath?: string; [board: string]: string | undefined };

/** A learning unit sitting in learningUnits/trash/DeletedLearningUnits. */
export interface TrashedLearningUnit extends LearningUnit {
  trashAt: Timestamp;
}

/**
 * A resource document sitting in
 * learningUnitResources/trash/DeletedLearningUnitResources.
 *
 * `trashAt` alone, like the other four trashes — every field that says WHICH
 * unit this belonged to is already on the resource document itself, so there is
 * nothing extra to record to put it back.
 */
export interface TrashedLearningUnitResource extends LearningUnitResource {
  trashAt: Timestamp;
}

export interface PickableUnit {
  /** Firestore document id, and what is stored in the programme's id array. */
  docId: string;
  /** Short code shown in bold: 'PT12', 'NF05'. */
  code: string;
  name: string;

  /**
   * ONE ROW PER DOCUMENT, and one language on it.
   *
   * This carried `languages: string[]` and toPickableUnits collapsed a code's
   * language variants into a single row, on a misreading of production's panel:
   * its row meta is "TA · EN · vV22", which is typeCode · isoCode · version —
   * TACtivity, English, v22 — not Tamil AND English.
   *
   * Production's picker maps its LIVE documents straight to rows, so a unit that
   * exists in two languages is two rows there, and its language filter is a
   * strict `isoCode === selected`. Collapsing them here also hid the choice that
   * matters most: `learningUnitsIds` stores ONE docId, so it decides which
   * language variant the programme references — and the collapsed row picked
   * that silently.
   */
  typeCode: string;
  isoCode: string;
  /** Version label, shown verbatim after a 'v': 'V22' renders as 'vV22'. */
  version: string;
  /** For the newest-first order production's panel uses. */
  createdAt: Timestamp | null;
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
 * in the production app: an ARRAY on the classroom entry, carrying the
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

/**
 * One institution on the dashboard, with the classes the signed-in person
 * actually teaches there.
 *
 * BUILT FROM THE TEACHER'S OWN DOCUMENTS, not from a join. Every field a card
 * needs — the institution's name, each class's name, grade, section and type —
 * is already denormalised onto TeacherClassroom, so the whole section is one
 * query against `teachers` rather than a read of classrooms and institutions on
 * top of it. That is also why a class shows here with the name it had when the
 * teacher was attached to it: the copy on the teacher document is the copy being
 * read. See appendClassrooms for the write that keeps it current.
 *
 * ONE PERSON CAN HOLD SEVERAL TEACHER DOCUMENTS — one per class, which is what
 * assigning a registered teacher to another class creates — so `classrooms` here
 * is the UNION across all of them, deduplicated by classroomId.
 */
export interface AllottedInstitution {
  institutionId: string;
  institutionName: string;
  classrooms: TeacherClassroom[];
}

/** Everything the dashboard renders for the signed-in person. */
export interface TeacherAllotment {
  institutions: AllottedInstitution[];
  /** Across every institution, so the tile does not have to sum the cards. */
  classroomCount: number;
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

/* ==========================================================================
   Assignments — quizzes, uploads and forms

   Field names are ThinkTac production's verbatim, read from its own
   all-assignments-table and the basic-info step of each create dialog, so a row
   written here is a document its Assignments page can list and edit.
   ========================================================================== */

/**
 * The three kinds this app builds.
 *
 * THREE, NOT SIX, on instruction. Production also offers TEXTBLOCK, CASE_STUDY
 * and MULTI_CATEGORY; those are deliberately not implemented here, and the union
 * is what keeps them out — a stored 'CASE_STUDY' cannot be assigned to this type,
 * so nothing can half-support one by accident.
 *
 * UPPERCASE, and stored uppercase, because that is what production's table
 * compares against (`(a?.type || '').toString().toUpperCase()`) and what its type
 * badge switches on.
 */
export type AssignmentType = 'QUIZ' | 'UPLOAD' | 'FORM';

/**
 * The three types, with what the UI needs to render each.
 *
 * ONE LIST, read by the Create menu, the stat cards and the filter pills, so a
 * fourth type could never appear in one of the three and be missing from the
 * others.
 */
export const ASSIGNMENT_TYPES: readonly {
  type: AssignmentType;
  /** Menu label, production's wording: 'Quiz Type'. */
  menuLabel: string;
  /** Filter-pill label. */
  label: string;
  /** Stat-card label, plural. */
  plural: string;
  icon: string;
}[] = Object.freeze([
  { type: 'QUIZ', menuLabel: 'Quiz Type', label: 'Quiz', plural: 'Quizzes', icon: 'clipboard' },
  { type: 'UPLOAD', menuLabel: 'Upload Type', label: 'Upload', plural: 'Uploads', icon: 'upload-circle' },
  { type: 'FORM', menuLabel: 'Form Type', label: 'Form', plural: 'Forms', icon: 'list' }
]);

/* --------------------------------------------------------------------------
   Shared pieces of the type-specific payloads.

   All of it read from thinktac-india-production's own Assignments collection —
   the Assignments/--schema-- document plus one real row of each type, because
   the schema document and the live data disagree in two places and the live data
   wins:

     - --schema-- calls the quiz's question array `questionsSchema`; every real
       quiz stores `questionsData`.
     - A FORM stores `questions`, not `questionsData`. The two types genuinely use
       different key names for the same idea, and matching each is what keeps a
       document written here readable by production.

   The other trap is case: a QUIZ question's `questionType` is UPPERCASE ('MCQ',
   'TEXT'), a FORM question's is lowercase ('text'). Also production's own, also
   not tidied.
   -------------------------------------------------------------------------- */

/**
 * One choice on an MCQ, or one blank's option.
 *
 * FOUR FIELDS, NOT TWO. The Assignments/--schema-- document shows only `name` and
 * `isCorrect`; every real option in production carries `optionType` and
 * `imagePath` as well, because an option can be a picture instead of a sentence.
 * Read from the live data, which is the authority where the two disagree.
 */
export interface AssignmentOption {
  /** The label, when this is a text option. */
  name: string;
  isCorrect: boolean;
  /** 'TEXT' | 'IMAGE'. Uppercase, as stored. */
  optionType: string;
  /** Storage path, used when optionType is IMAGE. '' otherwise, never absent. */
  imagePath: string;
}

/**
 * One lettered sub-part of a question — the 'a, b, c…' the editor's
 * "Enable Sub-questions" toggle reveals.
 *
 * Read from production: two questions in the whole collection use it, and this is
 * the shape they carry. `label` is the letter, and `options` is the same option
 * shape as the parent question's.
 */
export interface QuizSubPart {
  label: string;
  subPartTitle: string;
  marks: number;
  oneCorrectOption: boolean;
  options: AssignmentOption[];
}


/**
 * One quiz question.
 *
 * FIVE TYPES, and the fields that apply depend on which:
 *
 *   MCQ                 options, oneCorrectOption
 *   TEXT                answer, maxCharLength
 *   DESCRIPTIVE         answer, maxCharLength — same fields as TEXT, longer
 *                       maxCharLength in practice (2000 against 400)
 *   FILL_IN_THE_BLANKS  blanks, keyed 'optionsBlank1', 'optionsBlank2', …
 *   RICH_BLANKS         blanks, keyed by the label in the HTML ('blank a')
 *
 * Counted in production: MCQ 156, FILL_IN_THE_BLANKS 9, TEXT 4, RICH_BLANKS 3,
 * DESCRIPTIVE 2. The schema document lists only the first four; DESCRIPTIVE is in
 * the editor's menu and in the data.
 *
 * Optional rather than a union, and this is the one place that choice is right:
 * production stores these in ONE array whose entries have different shapes, and a
 * discriminated union would make reading an existing quiz a cast at every step.
 * The editors that write them narrow on `questionType`.
 */
export interface QuizQuestion {
  questionTitle: string;
  /** 'MCQ' | 'TEXT' | 'FILL_IN_THE_BLANKS' | 'RICH_BLANKS'. Uppercase. */
  questionType: string;
  marks: number;
  /** 'FA' — formative assessment. Production's only observed value. */
  pedagogyType: string;

  durationInHours: number;
  durationInMinutes: number;
  durationInSeconds: number;

  hasSubParts?: boolean;
  subParts?: QuizSubPart[];

  /** MCQ only. */
  options?: AssignmentOption[];
  oneCorrectOption?: boolean;

  /** TEXT only. */
  answer?: string;
  maxCharLength?: number;

  /** Both blank types. Keys are the blank labels, and they differ per type. */
  blanks?: Record<string, AssignmentOption[]>;
}

/**
 * The case-study style preamble a quiz can carry.
 *
 * `description` is HTML from a rich-text editor. `images` is misnamed in
 * production — it holds PDFs too, as the `type` field on each entry shows — and
 * the name is kept because renaming it would break the join.
 */
export interface AssignmentBackgroundInfo {
  title: string;
  description: string;
  images: {
    storagePath: string;
    filename: string;
    order: number;
    /**
     * 'pdf' | 'image' — LOWERCASE, and worth pinning because it is the only
     * lowercase type code in the assignments model. An upload slot's
     * `uploadFileType` is 'IMAGE' and a quiz question's `questionType` is 'MCQ'.
     */
    type: string;
  }[];
}

/**
 * One file slot on an upload assignment.
 *
 * `maxFileSize` is in megabytes and stored as a NUMBER, while `maxNoOfUploads`
 * beside it is a STRING ('1'). Both are production's, and both are typed as
 * found rather than normalised, so a round trip does not rewrite the document.
 */
export interface UploadSlot {
  title: string;
  /** HTML from a rich-text editor. */
  instructions: string;
  /**
   * `number | string` because the editor STARTS EMPTY.
   *
   * Production's field opens blank rather than on a default, and its cap depends
   * on the chosen type — 200mb for a video, 20 for an image, 40 otherwise. The
   * empty string is what an untouched field holds; the wizard requires a number
   * before it will move on, and writes a number.
   */
  maxFileSize: number | string;
  /**
   * `number | string` because the collection holds BOTH.
   *
   * Production's newest upload documents store a number and an older one stores
   * '1'. Typed as the number the dialog writes only, reading one of the older
   * rows would hand the editor a string where it expected a number and the field
   * would arrive blank. The wizard always writes a number.
   */
  maxNoOfUploads: number | string;
  /** 'IMAGE' — production's uppercase form. */
  uploadFileType: string;
  submissionId: number;
  resourcePath: string;
  durationInHours: number;
  durationInMinutes: number;
  durationInSeconds: number;

  /**
   * Earlier slots that must be completed before this one opens.
   *
   * ZERO-BASED INDICES, which is what production's select binds — its options are
   * labelled `i + 1` but valued `i`. Only offered on the second slot onward,
   * because the first has nothing to depend on.
   *
   * OPTIONAL because most stored slots have no such field at all; the collection
   * holds it as both an array and, on one older row, an empty string.
   */
  dependentOnStepNumbers?: number[] | string;
}

/**
 * One field on a form assignment.
 *
 * `questionType` is LOWERCASE here ('text'), unlike a quiz question's. The three
 * dropDown fields are all present and all empty on a text field — production
 * writes the whole shape regardless of type, which is also why they are required
 * rather than optional.
 */
export interface FormQuestion {
  questionType: string;
  questionNumber: number;
  question: string;
  prompt: string;
  isSubquestion: boolean;
  /**
   * The choices, for a type that lists its own.
   *
   * EITHER SHAPE, AND BOTH ARE REAL. The collection already held a string and an
   * array for this field before this app existed, which is why the form wizard
   * has always had to coerce it on read.
   *
   * WHICH SHAPE IS WRITTEN NOW DEPENDS ON THE TYPE. `dropDown` keeps the comma
   * separated string production writes. `checkBoxGroup` writes an ARRAY, because
   * its options are authored one per row and an author typing "Ran out of time,
   * mostly" into a row means one option, not two. A joined string cannot express
   * that and would split it silently.
   */
  dropDownOptions: string | string[];
  dropDownOptionsDynamic: string;
  dropDownOptionsDependent: string;
  fieldIcon: string;
}

/**
 * What EVERY assignment carries, whatever its type.
 *
 * Read from production, with two exceptions marked below. The list page reads
 * only these, which is why it can take the union without narrowing.
 */
export interface AssignmentBase {
  docId: string;

  /** The TITLE column. Production's field name, not `title`. */
  displayName: string;

  type: AssignmentType;

  /**
   * 'LIVE' or 'DEVELOPMENT' — production's own statusList on the quiz step.
   *
   * A BARE STRING, deliberately, like `programmeStatus`. Production's table reads
   * it defensively ('active' and 'live' both count as live, 'closed' and
   * 'archived' as closed, anything else as draft), which means documents out
   * there carry values beyond the two the form offers. A union here would reject
   * a real row on read.
   */
  status: string;

  /**
   * Who created it, as a NAME rather than a uid.
   *
   * Production fills this from the signed-in user and then DISABLES the field, so
   * it is a snapshot of a display name and not a reference — renaming yourself
   * does not retitle assignments you already made.
   */
  creator: string;

  /**
   * The credited author, which is NOT the creator: whoever wrote the activity,
   * where `creator` is whoever typed it in. A separate required field in every
   * one of production's basic-info steps.
   */
  author: string;

  updatedAt: Timestamp | null;

  // --- Ours, not production's -------------------------------------------

  /**
   * OURS. A top-level collection's rule has no uid in the path to compare
   * against, so ownership lives in this field. Production scopes access
   * differently and its documents have no equivalent.
   */
  ownerId: string;

  /**
   * OURS. Production records only `updatedAt`, so the age of a row is
   * unknowable there once it has been edited once. Harmless to production, which
   * ignores keys it does not read.
   */
  createdAt: Timestamp | null;
}

/**
 * A quiz.
 *
 * `totalDurationInMinutes` and `…Seconds` are STRINGS while `…Hours` is a
 * NUMBER, in the same production document. Not a mistake in the reading — the
 * form writes whatever its inputs hold — and typed as found, because coercing
 * them would rewrite every document this app touches.
 */
export interface QuizAssignment extends AssignmentBase {
  type: 'QUIZ';

  /** 'login' — how a student is identified before answering. */
  authenticationType: string;
  allowExitAndReEntry: boolean;
  displayCorrectAnswers: boolean;
  numberOfAllowedSubmissions: number;

  totalDurationInHours: number;
  totalDurationInMinutes: number | string;
  totalDurationInSeconds: number | string;

  backgroundInfo: AssignmentBackgroundInfo;

  /** NOT `questions`, and not `questionsSchema` — see the note above. */
  questionsData: QuizQuestion[];
}

/** An upload. `assignments` is the array of file slots. */
export interface UploadAssignment extends AssignmentBase {
  type: 'UPLOAD';

  numberOfAllowedSubmissions: number;
  /** A free-text duration production carries beside the three below. */
  duration: string;
  totalDurationInHours: number;
  totalDurationInMinutes: number | string;
  totalDurationInSeconds: number | string;

  assignments: UploadSlot[];
}

/** A form. `questions`, NOT `questionsData` — see the note above. */
export interface FormAssignment extends AssignmentBase {
  type: 'FORM';

  instructions: string;
  questions: FormQuestion[];
}

/**
 * Any assignment.
 *
 * A DISCRIMINATED UNION on `type`, so an editor that narrows to a quiz gets
 * `questionsData` and cannot reach `questions` by mistake — the two names being
 * different is exactly the sort of thing a shared optional-fields interface would
 * let a caller get wrong silently.
 */
export type Assignment = QuizAssignment | UploadAssignment | FormAssignment;

/**
 * What the create form emits, for any type.
 *
 * The four fields the service supplies are excluded from each member SEPARATELY
 * rather than from the union. `Omit<Assignment, …>` over a union collapses it into
 * one object type carrying every payload field as optional — which is precisely
 * the shape this model exists to avoid, and it would let a caller hand a quiz's
 * `questionsData` to a form without a complaint.
 */
export type AssignmentDraft =
  | Omit<QuizAssignment, 'docId' | 'ownerId' | 'createdAt' | 'updatedAt'>
  | Omit<UploadAssignment, 'docId' | 'ownerId' | 'createdAt' | 'updatedAt'>
  | Omit<FormAssignment, 'docId' | 'ownerId' | 'createdAt' | 'updatedAt'>;

/** An assignment sitting in Assignments/--trash--/DeletedAssignments. */
export type TrashedAssignment = Assignment & { trashAt: Timestamp };

/**
 * A brand-new payload of each type, with production's own defaults.
 *
 * WHY THESE LIVE HERE and not in the form. The create form collects the four
 * common fields; everything else is a default that has to be RIGHT, because it is
 * written to a document production will later read. The values are production's:
 * `authenticationType: 'login'` and `numberOfAllowedSubmissions: 1` are what its
 * real quizzes carry, and the upload's instructions and title are the literal
 * strings its own create-upload step prefills.
 *
 * The arrays start EMPTY. A quiz with no questions and an upload with no slots
 * are both valid, listable documents — production's own dialog writes them at the
 * end of step one — and the editors fill them in.
 */
/**
 * The five question types the quiz editor offers, in its own menu order.
 *
 * ONE LIST, read by the "Add New Question" menu and by the editor that switches
 * on the choice, so a type cannot be offered and then not handled.
 */
export const QUIZ_QUESTION_TYPES: readonly {
  type: string;
  /** Menu label, production's wording — including its shouted DESCRIPTIVE. */
  label: string;
  /**
   * Menu icon. Production gives MCQ its own mark and the other four a pencil,
   * which is a real distinction rather than decoration: MCQ is the only one whose
   * answer is CHOSEN from a list; the rest are written.
   */
  icon: string;
}[] = Object.freeze([
  { type: 'MCQ', label: 'MCQ', icon: 'list' },
  { type: 'FILL_IN_THE_BLANKS', label: 'Fill In The Blanks', icon: 'edit' },
  { type: 'TEXT', label: 'Text', icon: 'edit' },
  { type: 'RICH_BLANKS', label: 'Rich Blanks', icon: 'edit' },
  { type: 'DESCRIPTIVE', label: 'DESCRIPTIVE', icon: 'edit' }
]);

/** Pedagogy types the question form offers. 'FA' is production's only stored value. */
export const PEDAGOGY_TYPES = ['FA', 'SA'] as const;

/** Authentication types the quiz's step 1 offers, from its own Select menu. */
export const QUIZ_AUTH_TYPES = ['login', 'anonymous'] as const;

/** A blank option, with production's defaults for the two fields it adds. */
export function emptyOption(isCorrect = false): AssignmentOption {
  return { name: '', isCorrect, optionType: 'TEXT', imagePath: '' };
}

/**
 * A new question of the given type, with only the fields that type uses.
 *
 * NOT every field on every question. Production writes `options` on an MCQ and
 * `answer` on a TEXT, and does not write the other's — so a question carrying
 * both would be a shape its own editor never produces.
 *
 * `maxCharLength` is 400 for TEXT and 2000 for DESCRIPTIVE, which is what the two
 * carry in the live data and the only substantive difference between them.
 */
export function emptyQuizQuestion(questionType: string): QuizQuestion {
  const base: QuizQuestion = {
    questionTitle: '',
    questionType,
    marks: 1,
    pedagogyType: 'FA',
    durationInHours: 0,
    durationInMinutes: 0,
    durationInSeconds: 0,
    hasSubParts: false,
    subParts: []
  };

  switch (questionType) {
    case 'MCQ':
      // Three options is what production's own editor opens with.
      return { ...base, oneCorrectOption: true, options: [emptyOption(), emptyOption(), emptyOption()] };
    case 'TEXT':
      return { ...base, answer: '', maxCharLength: 400 };
    case 'DESCRIPTIVE':
      return { ...base, answer: '', maxCharLength: 2000 };
    default:
      // Both blank types. The keys are added as blanks are defined.
      return { ...base, blanks: {} };
  }
}

export function emptyQuizPayload(): Omit<
  QuizAssignment,
  keyof AssignmentBase | 'type'
> {
  return {
    authenticationType: 'login',
    allowExitAndReEntry: false,
    displayCorrectAnswers: false,
    numberOfAllowedSubmissions: 1,
    totalDurationInHours: 0,
    totalDurationInMinutes: 0,
    totalDurationInSeconds: 0,
    backgroundInfo: { title: '', description: '', images: [] },
    questionsData: []
  };
}

/**
 * One upload slot, opening exactly as production's dialog opens.
 *
 * THREE FIELDS START EMPTY OR ZERO rather than on a guess, which was checked
 * against its own template:
 *
 *   uploadFileType  UNSELECTED, showing 'Select Upload File Type'. It used to
 *                   default to IMAGE here, which is worse than it sounds: the
 *                   type caps the file size and decides what a student can even
 *                   attach, so defaulting it makes a real choice silently.
 *   maxFileSize     EMPTY. Its ceiling depends on the type, so there is no
 *                   sensible number to offer before one is chosen.
 *   duration        0/0/0, on instruction. Production prefills 23/59/59, which is
 *                   a value nobody picked attached to work that may have no time
 *                   limit at all.
 *
 * One allowed upload IS production's own opening value, and it stays.
 *
 * `submissionId` IS THE SLOT'S 1-BASED POSITION — production's documents number
 * their slots 1, 2, 3 in array order. It is passed in rather than derived here so
 * the caller renumbering after a removal has one place to do it.
 */
export function emptyUploadSlot(submissionId: number): UploadSlot {
  return {
    title: '',
    instructions: '',
    maxFileSize: '',
    maxNoOfUploads: 1,
    uploadFileType: '',
    submissionId,
    resourcePath: '',
    durationInHours: 0,
    durationInMinutes: 0,
    durationInSeconds: 0
  };
}

/**
 * The megabyte ceiling for a chosen upload type.
 *
 * PRODUCTION'S OWN NUMBERS, off the max binding on its Max Size field: a video
 * may be 200mb, an image 20, and anything else 40. Worth having as data rather
 * than three ternaries in a template — which is how production expresses it.
 */
export const UPLOAD_SIZE_CAPS: Record<string, number> = {
  VIDEO: 200,
  IMAGE: 20
};

/** 40mb for every type production does not cap specially. */
export const UPLOAD_SIZE_CAP_DEFAULT = 40;

/** The cap for a type, or the default when the type is unknown or unchosen. */
export function uploadSizeCap(uploadFileType: string): number {
  return UPLOAD_SIZE_CAPS[(uploadFileType ?? '').toUpperCase()] ?? UPLOAD_SIZE_CAP_DEFAULT;
}

/**
 * WHICH FILE EXTENSIONS EACH UPLOAD TYPE ACCEPTS.
 *
 * PRODUCTION'S OWN MAP, copied from `Configuration/acceptedUploadFormats.formats`
 * verbatim, keys included — LOWERCASE keys, because that is how production looks
 * them up: `acceptedFormats[assignmentData.uploadFileType.toLowerCase()]`, against
 * a slot that stores 'IMAGE'. Two cases for one vocabulary is not a tidy design,
 * and it is the one in the data.
 *
 * WHY IT IS SEEDED HERE AT ALL. This app's own Configuration document has
 * `formatNames` and `sizeCaps` but NO `formats` — checked, not assumed — so
 * reading the document alone would leave the whitelist empty and every upload
 * refused as an invalid type. The reader still prefers the document when it grows
 * the key.
 *
 * `imageVideoPdf` IS PRODUCTION'S COMBINED SET, for a slot that accepts any of the
 * three. It is a key in its map rather than a computed union, so it is kept as a
 * key rather than derived — production's own list omits `.jpeg` from `image`,
 * which a derived union would have no way to reproduce.
 */
export const UPLOAD_ACCEPTED_EXTENSIONS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    video: [
      '.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.3gp', '.ogg'
    ],
    /* JPG AND PNG ONLY, AND NO '.jpeg' — production's own list. A photo saved as
       .jpeg is refused there, so it is refused here; adding it would make this app
       accept a file production's player would then reject. */
    image: ['.jpg', '.png'],
    pdf: ['.pdf'],
    word: ['.doc', '.docx'],
    excel: ['.xls', '.xlsx'],
    ppt: ['.ppt', '.pptx'],
    imageVideoPdf: [
      '.jpg', '.png', '.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm',
      '.m4v', '.3gp', '.ogg', '.pdf'
    ]
  });

export function emptyUploadPayload(): Omit<
  UploadAssignment,
  keyof AssignmentBase | 'type'
> {
  return {
    numberOfAllowedSubmissions: 1,
    duration: '',
    totalDurationInHours: 0,
    totalDurationInMinutes: 0,
    totalDurationInSeconds: 0,
    assignments: []
  };
}

/**
 * One form question, with ALL NINE KEYS production writes.
 *
 * NINE KEYS ON EVERY QUESTION REGARDLESS OF TYPE, which was read off the live
 * collection rather than assumed: a `text` question still carries
 * `dropDownOptions`, `dropDownOptionsDynamic` and `dropDownOptionsDependent` as
 * empty strings. Writing only the keys a type uses would produce documents
 * narrower than any production has, and Firestore rejects the alternative of
 * leaving them undefined anyway.
 *
 * `prompt` IS ALWAYS THE EMPTY STRING. Every one of the 209 questions in the
 * collection has it empty, so the current dialog does not collect it. It is
 * written rather than dropped because the field exists on every stored question.
 *
 * `questionNumber` IS 1-BASED AND POSITIONAL. Some older documents store it as a
 * string; this always writes a number, and the wizard re-derives it from the
 * position so reordering cannot leave two questions claiming the same number.
 */
export function emptyFormQuestion(questionNumber: number): FormQuestion {
  return {
    questionType: '',
    questionNumber,
    question: '',
    prompt: '',
    isSubquestion: false,
    dropDownOptions: '',
    dropDownOptionsDynamic: '',
    dropDownOptionsDependent: '',
    fieldIcon: ''
  };
}

export function emptyFormPayload(): Omit<
  FormAssignment,
  keyof AssignmentBase | 'type'
> {
  return {
    // Production's create-form step prefills exactly this sentence.
    instructions: 'Please answer all the questions in the fields provided below',
    questions: []
  };
}

/* ==========================================================================
   Workflow templates — reusable blueprints for a learning unit's steps.

   THE SHAPE IS PRODUCTION'S, read off its own WorkflowTemplates collection: 46
   documents, 238 steps and 384 contents. Three things it settles that a screenshot
   could not:

     - `learningUnitType` stores the CODE, not the name. 'TA', 'MI', 'TT' — the
       same two-letter codes LEARNING_UNIT_TYPES carries, so the dropdown shows
       'TACtivity' and the document says 'TA'.
     - `maturity` is CAPITALISED here — 'Gold', not the 'gold' that
       Configuration/learningUnitMaturity keys its ladder by.
     - `templateType` is 'custom' or 'default'. Only 4 of the 46 are custom.
   ========================================================================== */

/** What a step's content block points at. */
export interface WorkflowContent {
  contentName: string;
  /** 'video' | 'tacDev' | '3S' | 'graphics' | 'custom resource' | 'assignment' | 'tnt'. */
  contentCategory: string;
  contentSubCategory: string;
  contentType: string;
  resourcePath: string;
  isDownloadable: boolean;
  isDueDate: boolean;
  /**
   * `boolean | string | number` because the collection holds all three.
   *
   * Production has written it as true, as 'true' and as 1. The editor writes a
   * boolean; the union is what lets an older document be read without coercing a
   * value nobody asked it to change.
   */
  contentIsLocked: boolean | string | number;
  gameName: string;

  /**
   * The resource-kind select, and THERE ARE TWO OF THEM for one list of options.
   *
   * `additionalResourceType` is what DEFAULT mode writes under its 'additional
   * resources' category; `customResourceType` is what CUSTOM mode writes under
   * 'custom resource'. Both offer the same three — PDF, LINK, PPT — and
   * production keeps them as separate fields on the same form group rather than
   * one field read two ways. Kept separate here for the same reason: a document
   * written by either app has to be readable by the other.
   */
  additionalResourceType: string;
  customResourceType: string;

  /* THE ASSIGNMENT CATEGORY'S OWN FOUR. Empty on every other category. */

  /** 'QUIZ' | 'UPLOAD' | 'FORM' — the type, not the display name. */
  assignmentType: string;
  /** The assignment's NAME, which is what production's select stores. */
  assignmentName: string;
  /** And its document id, stored alongside, because the name is not unique. */
  assignmentId: string;
  /** Only meaningful when `isDueDate` is true. */
  assignmentDueDate: Timestamp | null;
}

/** One step of a workflow template. */
export interface WorkflowStep {
  workflowStepName: string;
  /** 1-based and POSITIONAL — production orders the steps by it. */
  sequenceNumber: number;
  workflowStepDescription: string;
  /** `number | string` in the collection; the editor writes a number. */
  workflowStepDuration: number | string;
  /** The "Show in UnLab?" toggle. */
  viewUnlab: boolean;
  workflowLocation: string;
  /** The "Access Level" field. Production has written it as all four types. */
  allowAccess: boolean | string | number | null;
  /** The "Can Skip Step" select. `null` for the unanswered state. */
  canSkipWorkflowStep: boolean | string | null;
  allowArtefactUpload: boolean;

  /**
   * STUDENT PROGRESSION, and only a WORKFLOW carries it — never a template.
   *
   * Production writes it as the student advances: 301 of 2593 steps have it, and a
   * typical run reads `[null, false, false, …]` — the first step null rather than
   * true, which is its "not yet started" rather than "locked".
   *
   * OPTIONAL AND CARRIED THROUGH, never originated here. This app has no student
   * submissions and no progression to compute, so writing a value would be
   * inventing state; preserving one keeps a workflow this app edits readable by
   * production's player, which does depend on it.
   */
  isStepUnlocked?: boolean | null;

  contents: WorkflowContent[];
  /** Written empty; production's own player fills it. */
  scannedArtefacts: unknown[];
}

export interface WorkflowTemplate {
  docId: string;
  templateId: string;
  templateName: string;

  /** 'custom' or 'default'. This app creates only custom — see the form. */
  templateType: string;

  /** The two-letter LEARNING_UNIT_TYPES code, not the name. */
  learningUnitType: string;
  /** Capitalised: 'Silver' | 'Gold' | 'Platinum' | 'Diamond'. */
  maturity: string;
  subject: string;
  /** 'CLASSROOM' | 'STEM-CLUB'. */
  type: string;

  status: string;

  workflowSteps: WorkflowStep[];

  ownerId: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

/** A workflow template in the trash. */
export interface TrashedWorkflowTemplate extends WorkflowTemplate {
  trashAt: Timestamp;
}

/** What the form emits, minus what the service supplies. */
export type WorkflowTemplateDraft = Omit<
  WorkflowTemplate,
  'docId' | 'templateId' | 'ownerId' | 'createdAt' | 'updatedAt'
>;

/**
 * A class's own short label: '3 B'.
 *
 * GRADE AND SECTION, as the sidebar tree shows it — a classroom name like
 * 'ThinkTac STEM Forge' is too long for a breadcrumb, and the grade is what
 * distinguishes one class from the next. Falls back to the name where a class has
 * neither, which is what a STEM club looks like.
 *
 * IN THE MODEL because two pages need the same label: the classroom's unit list
 * and the workflow stepper both name the class in their breadcrumb, and the crumbs
 * have to agree. It was private to the unit list until the second caller appeared.
 */
export function classLabel(classroom: Classroom): string {
  const parts = [classroom.grade, classroom.section].filter(
    part => String(part ?? '').trim() !== ''
  );

  return parts.length > 0 ? parts.join(' ') : classroom.classroomName || 'Classroom';
}

/**
 * A WORKFLOW — a template INSTANTIATED for one learning unit in one classroom.
 *
 * THE DISTINCTION IS THE WHOLE POINT and it is easy to lose: a
 * WorkflowTemplate is the reusable blueprint an admin builds; a Workflow is the
 * COPY a teacher gets when they open a learning unit, which they may then edit
 * without touching the blueprint. The two carry the same `workflowSteps` shape,
 * which is what makes a template applicable to a workflow at all.
 *
 * `templateId` AND `templateName` RECORD WHERE THE COPY CAME FROM. They are not a
 * live reference — editing the template later does not change a workflow already
 * made from it, which is why the steps are copied rather than pointed at.
 *
 * HOW IT IS FOUND: not by querying this collection. The classroom holds
 * `programmes[programmeId].workflowIds[]`, one entry per learning unit, and the
 * entry's `workflowId` is this document's id. So the lookup goes classroom →
 * entry → workflow, and a unit with an entry whose `workflowId` is '' has no
 * workflow yet.
 */
export interface Workflow {
  docId: string;
  /** The same id again, as production stores it. */
  workflowId: string;

  /** Which template this was copied from, at the time it was copied. */
  templateId: string;
  templateName: string;

  workflowSteps: WorkflowStep[];

  /*
   * PRODUCTION'S OWN THREE, measured across 398 of its real workflow documents
   * rather than taken from its `--schema--` sentinel — which lists
   * `workflowStepId` and `linkageWorkFlowId`, neither of which appears in a single
   * real document. The same trap the Assignments sentinel set.
   */

  /**
   * WHICH FLOW CREATED THIS, as a label. 366 of 398 carry one, and every value is
   * a provenance string: 'set-up-wizard', 'unlab-contest-registration',
   * 'one-click-institution-classroom-programme-creation'. Not an enum — the list
   * grows whenever a new flow starts making workflows.
   */
  createdSource: string;

  /** Production records whether the writer was running on localhost. 397 of 398. */
  isLocalHost: boolean;

  /**
   * AN EMPTY MAP IN ALL 324 DOCUMENTS THAT HAVE IT, which is worth stating plainly
   * because the name promises otherwise: nothing populates it, in production or
   * here. The authoritative link from a classroom to its workflows is the
   * classroom's own `programmes[id].workflowIds[]`, and this field is vestigial.
   * Written as `{}` so a document from this app matches production's shape.
   */
  linkedClassrooms: Record<string, unknown>;

  /* ========================================================================
   * WHERE THIS WORKFLOW BELONGS — this app's own fields.
   *
   * PRODUCTION'S WORKFLOW DOCUMENT NAMES NOTHING. Not the classroom, not the
   * programme, not the learning unit: `linkedClassrooms` is an empty map in all
   * 324 documents that carry it, and the only route to a workflow is the
   * classroom's own `programmes[id].workflowIds[]`. Open one in the console and
   * there is no way to tell what it is for.
   *
   * SO THEY ARE WRITTEN HERE, on instruction, and they pay for themselves three
   * times over: the console becomes readable, a trashed workflow can be put back
   * (see WorkflowTrashOrigin, which existed only because of this gap), and the
   * classroom-units card can total a unit's step durations without walking the
   * classroom first.
   *
   * DENORMALISED, WHICH MEANS IT CAN GO STALE. A classroom renamed after this was
   * written still reads by its old name here. That is the trade every
   * denormalised copy makes, and production makes it constantly — its own
   * `workflowIds` entries carry `learningUnitCode` and `learningUnitName` for
   * exactly this reason. The IDS are the authority; the names are a convenience
   * for whoever is reading the document.
   * ======================================================================== */

  classroomId: string;
  /** 'Grade 8 D', from classLabel. Denormalised — see above. */
  classroomName: string;

  programmeId: string;
  programmeName: string;

  learningUnitId: string;
  learningUnitCode: string;
  learningUnitName: string;

  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

/**
 * Where a trashed workflow was attached, so it can go back.
 *
 * NOT A PRODUCTION FIELD. A workflow document names no classroom, programme or
 * unit — the classroom's `programmes[id].workflowIds[]` is the only link, and
 * trashing clears it — so production's 3912 trashed workflows cannot be put back
 * where they came from. Recorded here for exactly that.
 */
export interface WorkflowTrashOrigin {
  classroomId: string;
  programmeId: string;
  learningUnitId: string;
}

/**
 * Whether a content block holds nothing a teacher meant to keep.
 *
 * THE NARROW DEFINITION, AND IT HAD TO BE NARROWED. ADD NEW CONTENT adds a blank
 * block, and one left untouched should not be written — that much was right. But
 * the test was `contentName` ALONE, so a block with an UPLOAD assignment chosen
 * and the name field left blank counted as empty and was silently discarded on
 * save. The step's name persisted, so the page came back showing a step with no
 * content and the save looked broken. It was a real report.
 *
 * NOW IT IS EMPTY ONLY IF EVERY FIELD A READER COULD HAVE FILLED IS BLANK. A
 * chosen category, sub-category or assignment all count as intent, and a block
 * carrying any of them is kept — see `nameForContent` for what it is called when
 * the name is the only thing missing.
 */
export function isEmptyContent(content: WorkflowContent): boolean {
  return (
    (content.contentName ?? '').trim() === '' &&
    (content.contentCategory ?? '').trim() === '' &&
    (content.contentSubCategory ?? '').trim() === '' &&
    (content.assignmentId ?? '').trim() === '' &&
    (content.assignmentType ?? '').trim() === ''
  );
}

/**
 * What to call a content block whose name was left blank.
 *
 * THE ASSIGNMENT'S OWN NAME FIRST, because that is what a reader would have typed
 * and it is already on the block: a block pointing at "UPLOAD ME" is called
 * "UPLOAD ME". Then the sub-category, then the category, then a last-resort
 * label — every one of them more useful than dropping the block, which is what
 * this replaced.
 *
 * PRODUCTION'S BLOCKS ALL CARRY A NAME, so this never has to invent one for a
 * document that came from there; it exists for a block built here and left
 * half-filled.
 */
export function nameForContent(content: WorkflowContent): string {
  const typed = (content.contentName ?? '').trim();

  if (typed !== '') {
    return typed;
  }

  return (
    (content.assignmentName ?? '').trim() ||
    (content.contentSubCategory ?? '').trim() ||
    (content.contentCategory ?? '').trim() ||
    'Untitled content'
  );
}

/** A workflow in the trash. */
export interface TrashedWorkflow extends Workflow {
  trashAt: Timestamp;

  /** `null` for one trashed without a link — every production one. */
  trashedFrom: WorkflowTrashOrigin | null;
}

/**
 * What the stepper saves: the steps and the template they came from.
 *
 * The ids and timestamps are the service's to supply, exactly as
 * WorkflowTemplateDraft leaves them out for the same reason.
 */
export type WorkflowDraft = Pick<
  Workflow,
  | 'templateId'
  | 'templateName'
  | 'workflowSteps'
  | 'classroomId'
  | 'classroomName'
  | 'programmeId'
  | 'programmeName'
  | 'learningUnitId'
  | 'learningUnitCode'
  | 'learningUnitName'
>;

/**
 * One empty content block.
 *
 * EVERY KEY PRESENT, none undefined: Firestore rejects undefined anywhere in a
 * value tree and a content block sits three levels down, so one absent field
 * would fail the whole template's write.
 */
export function emptyWorkflowContent(): WorkflowContent {
  return {
    contentName: '',
    contentCategory: '',
    contentSubCategory: '',
    contentType: '',
    resourcePath: '',
    isDownloadable: true,
    isDueDate: false,
    contentIsLocked: true,
    gameName: '',
    additionalResourceType: '',
    customResourceType: '',
    assignmentType: '',
    assignmentName: '',
    assignmentId: '',
    assignmentDueDate: null
  };
}

/**
 * One empty step.
 *
 * `viewUnlab: true` because production's toggle opens on, and
 * `canSkipWorkflowStep: null` because its select opens unanswered — the two
 * defaults a screenshot shows and the data confirms.
 */
export function emptyWorkflowStep(sequenceNumber: number): WorkflowStep {
  return {
    workflowStepName: '',
    sequenceNumber,
    workflowStepDescription: '',
    workflowStepDuration: '',
    viewUnlab: true,
    workflowLocation: '',
    allowAccess: '',
    canSkipWorkflowStep: null,
    allowArtefactUpload: false,
    contents: [],
    scannedArtefacts: []
  };
}

/**
 * The template's own name, derived rather than typed.
 *
 * PRODUCTION'S OWN FORMAT, from its documents: 'Default (TA) (Science) (Silver)'.
 * Its create form has no name field — the four choices ARE the name — so building
 * it here keeps the one place that knows the format. 'Custom' replaces 'Default'
 * for a custom template, which is what this app creates.
 */
export function workflowTemplateName(
  templateType: string,
  learningUnitType: string,
  subject: string,
  maturity: string
): string {
  const lead = templateType === 'custom' ? 'Custom' : 'Default';

  return `${lead} (${learningUnitType}) (${subject}) (${maturity})`;
}

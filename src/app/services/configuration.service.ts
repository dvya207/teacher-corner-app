import { InjectionToken, Injectable, computed, inject, signal } from '@angular/core';
import { getDocs } from 'firebase/firestore';

import {
  CONFIGURATION_DOCS,
  CodedOption,
  ConfiguredAssignmentDefaults,
  ConfiguredCountry,
  ConfiguredAssignmentType,
  ConfiguredDomainRow,
  ConfiguredMaturity,
  ConfiguredFormQuestionType,
  ConfiguredResourceSchema,
  ConfiguredSchoolType,
  ConfiguredSubjectType,
  ConfiguredWorkflowType,
  PincodeRule,
  ValuedOption
} from '../core/configuration';
import { configurationCollection } from '../core/firestore-paths';
import {
  ASSIGNMENT_DEFAULTS,
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_TYPE_OPTIONS,
  CLOSED_STATUS_VALUES,
  FORM_QUESTION_TYPES,
  LIVE_STATUS_VALUES,
  UPLOAD_FILE_TYPES
} from '../data/assignment-options';
import {
  ASSIGNMENT_TYPES,
  AssignmentType,
  PEDAGOGY_TYPES,
  QUIZ_AUTH_TYPES,
  QUIZ_QUESTION_TYPES,
  UPLOAD_ACCEPTED_EXTENSIONS,
  UPLOAD_SIZE_CAPS,
  UPLOAD_SIZE_CAP_DEFAULT
} from '../models/teaching.model';
import { CLASSROOM_TYPES, GRADES, SECTIONS } from '../data/classroom-options';
import { COUNTRIES, DEFAULT_COUNTRY } from '../data/countries';
import { BOARDS, GENDER_TYPES, MEDIUMS, SCHOOL_TYPES } from '../data/institution-options';
import {
  PROGRAMME_AGES,
  PROGRAMME_GRADES,
  PROGRAMME_STATUSES,
  PROGRAMME_TYPES
} from '../data/programme-options';
import { TEACHER_ROLES } from '../data/teacher-options';
import {
  DIFFICULTY_LEVELS,
  LEARNING_UNIT_LANGUAGES
} from '../data/learning-unit-options';
import {
  LEARNING_UNIT_MATURITY_LADDER,
  LEARNING_UNIT_SUBJECT_DOMAIN_CODES,
  LEARNING_UNIT_SUBJECT_NAMES,
  LEARNING_UNIT_SUBJECT_TYPES,
  LEARNING_UNIT_TAXONOMY,
  LEARNING_UNIT_TYPES,
  LEGACY_MATURITY_NAMES,
  MaturityLevel,
  TaxonomyRow,
  orderedMaturities
} from '../data/learning-unit-taxonomy';
import { LEARNING_UNIT_RESOURCE_SCHEMA } from '../data/learning-unit-resource-schema';
import { WORKFLOW_TYPES } from '../data/workflow-template-options';
import {
  TACS_SEARCH_CONFIGURATION,
  TacsSearchSubject
} from '../data/tacs-search-configuration';

/**
 * Every option list the app used to hardcode, read from the Configuration collection.
 *
 * SIGNALS SEEDED WITH THE HARDCODED VALUES, and this is the whole safety story. Each
 * one starts holding exactly what the app rendered before this service existed, so:
 *
 *   - a dropdown is never briefly empty while the read is in flight;
 *   - a refused read, a missing document or a network drop leaves the app working on
 *     the values it always used, rather than degrading to blank selects;
 *   - the migration cannot regress behaviour, because the fallback IS the previous
 *     behaviour. What Firestore adds is the ability to change a list without a deploy.
 *
 * Consumers read the signals, so a value arriving after first paint updates the view
 * on its own. They must NOT destructure them into plain fields at construction, which
 * would capture the fallback and never see the load.
 *
 * ONE READ FOR EVERYTHING. load() fetches the whole collection in a single query
 * rather than a get() per document: seventeen sequential reads on entering the app is
 * both slower and seventeen chances to half-fail.
 */
/** What one Configuration document looks like once Firestore has decoded it. */
export type ConfigurationDocuments = Map<string, Record<string, unknown>>;

/**
 * How the service reads the collection.
 *
 * AN INJECTION TOKEN, so a test can supply documents without reaching for a module
 * mock. Angular's vitest setup refuses vi.mock on relative imports, and mocking
 * 'firebase/firestore' globally breaks every other spec that touches Firestore — so the
 * seam belongs in the design rather than in the test harness.
 *
 * The default is the real read: one query for the whole collection.
 */
export const CONFIGURATION_READER = new InjectionToken<() => Promise<ConfigurationDocuments>>(
  'CONFIGURATION_READER',
  {
    factory: () => async () => {
      const snapshot = await getDocs(configurationCollection());
      return new Map(snapshot.docs.map(document => [document.id, document.data()]));
    }
  }
);

@Injectable({ providedIn: 'root' })
export class ConfigurationService {

  private readDocuments = inject(CONFIGURATION_READER);

  // ---- Institutions -------------------------------------------------------
  readonly countries = signal<readonly ConfiguredCountry[]>(COUNTRIES);
  /**
   * Country NAMES, which is what every country select renders.
   *
   * A computed off `countries` rather than a second signal, so the two cannot fall out
   * of step when the Configuration document lands.
   */
  readonly countryNamesSignal = computed<readonly string[]>(() =>
    this.countries().map(country => country.name)
  );

  readonly boards = signal<readonly CodedOption[]>(BOARDS);
  readonly languages = signal<readonly CodedOption[]>(MEDIUMS);
  readonly schoolTypes = signal<readonly ConfiguredSchoolType[]>(SCHOOL_TYPES);
  readonly genderTypes = signal<readonly string[]>(GENDER_TYPES);

  /** Yes/No for customerSchool, which was two literals in a template. */
  readonly customerSchool = signal<readonly string[]>(['Yes', 'No']);

  /**
   * Pincode rules per country.
   *
   * The default carries India's six digits and nothing else, which is what
   * isCompletePincode() hardcoded. A second country is now a Firestore edit.
   */
  readonly pincodeRules = signal<readonly PincodeRule[]>([
    { country: DEFAULT_COUNTRY, pattern: '^[1-9][0-9]{5}$', digits: 6 }
  ]);

  // ---- Classrooms ---------------------------------------------------------
  readonly classroomTypes = signal<readonly ValuedOption[]>(CLASSROOM_TYPES);
  readonly grades = signal<readonly string[]>(GRADES);
  readonly sections = signal<readonly string[]>(SECTIONS);

  // ---- Programmes ---------------------------------------------------------
  readonly programmeStatuses = signal<readonly ValuedOption[]>(PROGRAMME_STATUSES);
  readonly programmeTypes = signal<readonly ValuedOption[]>(PROGRAMME_TYPES);
  readonly programmeAges = signal<readonly string[]>(PROGRAMME_AGES);

  /** Kept apart from `grades` for the reason programme-options.ts gives. */
  readonly programmeGrades = signal<readonly string[]>(PROGRAMME_GRADES);

  // ---- Teachers -----------------------------------------------------------
  readonly teacherRoles = signal<readonly string[]>(TEACHER_ROLES);

  // ---- Assignments --------------------------------------------------------

  /**
   * The five kinds production offers, from Configuration/AssignmentTypes.
   *
   * READ IN FULL, and filtered where it is used rather than here. The document
   * has GAME and TEXTBLOCK; this app creates neither, and the restriction lives
   * in ASSIGNMENT_TYPES in the model. Holding the whole list means a row already
   * stored as GAME can be LABELLED 'Game' instead of rendered as a raw
   * SCREAMING_SNAKE string, without that type becoming creatable.
   */
  readonly assignmentTypes =
    signal<readonly ConfiguredAssignmentType[]>(ASSIGNMENT_TYPE_OPTIONS);

  /**
   * Field types for a FORM assignment's questions.
   *
   * Same document as the list above — production keeps both in
   * Configuration/AssignmentTypes — which is why the two entries in
   * CONFIGURATION_DOCS share an id and differ only in the key.
   */
  readonly formQuestionTypes =
    signal<readonly ConfiguredFormQuestionType[]>(FORM_QUESTION_TYPES);

  /**
   * The upload types a file slot can ask for.
   *
   * Stored as a MAP in Firestore and read into a list here — see
   * applyUploadFormats for why that needs its own reader.
   */
  readonly uploadFileTypes = signal<readonly CodedOption[]>(UPLOAD_FILE_TYPES);

  /** The five quiz question types, label from the document and icon from code. */
  readonly quizQuestionTypes =
    signal<readonly { type: string; label: string; icon: string }[]>(QUIZ_QUESTION_TYPES);

  /**
   * WHICH kinds the Create menu offers.
   *
   * Defaults to the three the app implements. See applyCreatableTypes for why the
   * configured value is filtered rather than trusted.
   */
  readonly creatableAssignmentTypes =
    signal<readonly AssignmentType[]>(ASSIGNMENT_TYPES.map(entry => entry.type));

  readonly quizPedagogyTypes = signal<readonly string[]>(PEDAGOGY_TYPES);
  readonly quizAuthTypes = signal<readonly string[]>(QUIZ_AUTH_TYPES);

  /** What the Status select offers. */
  readonly assignmentStatuses = signal<readonly string[]>(ASSIGNMENT_STATUSES);

  /** Which stored values the badge paints as live, and as closed. */
  readonly liveStatusValues = signal<readonly string[]>(LIVE_STATUS_VALUES);
  readonly closedStatusValues = signal<readonly string[]>(CLOSED_STATUS_VALUES);

  /** The megabyte ceiling per upload type, and the fallback for the rest. */
  readonly uploadSizeCaps = signal<Readonly<Record<string, number>>>(UPLOAD_SIZE_CAPS);

  /**
   * Which extensions each upload type accepts, keyed lowercase.
   *
   * SEEDED, because this app's own document has `formatNames` and `sizeCaps` but
   * not `formats`. An empty whitelist refuses every file, so the fallback is what
   * makes an upload work today; the reader below prefers the document the moment
   * it carries the key.
   */
  readonly uploadExtensions =
    signal<Readonly<Record<string, readonly string[]>>>(UPLOAD_ACCEPTED_EXTENSIONS);

  /**
   * Every Configuration document as read, for the one lookup that is data-driven.
   *
   * EMPTY UNTIL `load()` RUNS, which `dynamicOptions` reports as "no options"
   * rather than as an error — the same honest answer as a document that exists and
   * names nothing.
   */
  private readonly documents = signal<ConfigurationDocuments>(new Map());

  /**
   * The options a `dropDownDynamic` form question offers.
   *
   * TWO SEGMENTS FROM THE QUESTION'S OWN VALUE: the Configuration document, then
   * the field inside it. 'RYSI_Categories,subjects' means document
   * `RYSI_Categories`, field `subjects`.
   *
   * `display` IS THE LABEL, which is production's own mapping —
   * `Object.values(docRef.get(field)).map(o => o.display)`. So the field holds a
   * MAP of objects, not a list of strings, and reading it as a list would render
   * '[object Object]' in every option.
   *
   * A PLAIN LIST OF STRINGS IS ALSO ACCEPTED, because this app's own Configuration
   * documents hold several of those and refusing them would make a working
   * document look empty. Anything with neither a `display` nor a usable string is
   * dropped rather than coerced.
   */
  dynamicOptions(documentId: string, field: string): string[] {
    const value = this.documents().get(documentId)?.[field];

    if (!value || typeof value !== 'object') {
      return [];
    }

    return Object.values(value as Record<string, unknown>)
      .map(entry => {
        if (typeof entry === 'string') {
          return entry;
        }

        const display = (entry as { display?: unknown })?.display;

        return typeof display === 'string' ? display : '';
      })
      .filter(entry => entry.trim() !== '');
  }
  readonly uploadSizeCapDefault = signal<number>(UPLOAD_SIZE_CAP_DEFAULT);

  /** The scalars a new assignment opens with. */
  readonly assignmentDefaults =
    signal<Readonly<ConfiguredAssignmentDefaults>>(ASSIGNMENT_DEFAULTS);

  // ---- Learning units -----------------------------------------------------
  /**
   * The 44-row taxonomy, seeded with the identical 44 rows held in source.
   *
   * SEEDED WITH THE SAME DATA THAT WAS WRITTEN TO FIRESTORE, which makes this the
   * strongest case of the pattern the rest of this class follows: the fallback is not
   * merely "the previous behaviour", it is byte-for-byte what the document holds,
   * because scripts/seed-configuration.mjs wrote the document FROM this constant. A
   * refused read therefore costs nothing at all until somebody edits the document.
   *
   * Read this rather than importing LEARNING_UNIT_TAXONOMY directly wherever a
   * console edit should take effect without a deploy — which is the whole learning
   * unit form. The constant is still the right import for anything that must resolve
   * synchronously at module load, such as BULK_SUBJECTS.
   */
  readonly learningUnitDomains = signal<readonly TaxonomyRow[]>(LEARNING_UNIT_TAXONOMY);

  /**
   * The maturity ladder, seeded with the same four levels held in source.
   *
   * ALWAYS IN RANK ORDER, whatever order the document's map happens to iterate in —
   * applyMaturities sorts on the way in, so no consumer has to remember to. The
   * Maturity dropdown reads `.level` off these; anything creating resource
   * documents reads `.cumulativeMaturity`.
   */
  readonly learningUnitMaturities = signal<readonly MaturityLevel[]>(
    LEARNING_UNIT_MATURITY_LADDER
  );

  /**
   * The empty resource skeleton, seeded with the same snapshot held in source.
   *
   * NOTHING READS THIS YET. It is wired now because it is the input to creating
   * LearningUnitResources documents, which is the next piece of the flow — and
   * because the document had to be seeded anyway, so leaving the app unable to see
   * it would mean coming back to this file.
   *
   * Cast on the way out of the constant: the source is `as const`, so its type is a
   * deeply-readonly literal naming all 388 slots, which is useless to a consumer
   * indexing it by a runtime string.
   */
  /**
   * The thirteen learning unit types, { name, code }.
   *
   * ALPHABETICAL BY CODE, which is the order the stored map yields and the order the
   * fallback declares — so the dropdown does not reshuffle when the read lands.
   */
  readonly learningUnitTypes = signal<readonly { name: string; code: string }[]>(
    LEARNING_UNIT_TYPES
  );

  /**
   * The SIX learning unit languages. Not the seven school mediums in `languages`.
   *
   * See CONFIGURATION_DOCS.learningUnitLanguages for why these are two documents and
   * not one: OT 'Other' is a valid medium and an invalid isoCode.
   */
  readonly learningUnitLanguages = signal<readonly CodedOption[]>(LEARNING_UNIT_LANGUAGES);

  /** Difficulty levels, as strings. */
  readonly learningUnitDifficulty = signal<readonly string[]>(DIFFICULTY_LEVELS);

  /**
   * The two workflow types a template can be, { code, label }.
   *
   * Seeded from WORKFLOW_TYPES, which was read off production's own
   * Configuration/WorkflowTypes — so the app renders the same two whether the
   * document is present, absent or refused.
   */
  readonly workflowTypes = signal<readonly CodedOption[]>(WORKFLOW_TYPES);

  /** The five subjects, { code, name }. Includes Health, which has no domain rows. */
  readonly subjectTypes = signal<readonly ConfiguredSubjectType[]>(LEARNING_UNIT_SUBJECT_TYPES);

  /**
   * `subjects.subjectsNames` — a curated filter list, NOT the subject vocabulary.
   *
   * Kept apart from `subjectTypes` on purpose: it spells Mathematics as 'Maths',
   * includes FLN which is a learning unit type rather than a subject, and omits Earth
   * Sciences and Health. See LEARNING_UNIT_SUBJECT_NAMES.
   */
  readonly subjectNames = signal<readonly string[]>(LEARNING_UNIT_SUBJECT_NAMES);

  /** `subjects.domainCodesToInclude` — includes H (no rows), excludes Z (has rows). */
  readonly subjectDomainCodes = signal<readonly string[]>(LEARNING_UNIT_SUBJECT_DOMAIN_CODES);

  /**
   * `Configuration/Maturity.maturity` — the older flat list.
   *
   * EXPOSED FOR COMPLETENESS AND NOT FOR ORDERING. Its order is wrong (Diamond before
   * Platinum). Anything that needs maturities in rank order reads
   * `learningUnitMaturities` above, which is sorted on the ladder.
   */
  readonly legacyMaturityNames = signal<readonly string[]>(LEGACY_MATURITY_NAMES);

  /**
   * The search facets. THREE SIGNALS, one document.
   *
   * `tacsSearchSubjects` carries DOMAINS, not subjects — the document's naming is
   * inverted from the rest of the collection. See tacs-search-configuration.ts before
   * wiring any of these to a picker.
   *
   * The seeded fallback is known to be missing one SubjectDomain entry, which was not
   * captured from production. Documented in the data file.
   */
  readonly tacsSearchSubjects = signal<readonly TacsSearchSubject[]>(
    TACS_SEARCH_CONFIGURATION.SubjectDomain
  );

  readonly tacsSearchBoards = signal<readonly { BoardCode: string; BoardName: string }[]>(
    TACS_SEARCH_CONFIGURATION.BoardDomain
  );

  readonly tacsSearchGrades = signal<readonly { GradeCode: string; GradeName: string }[]>(
    TACS_SEARCH_CONFIGURATION.GradeDomain
  );

  readonly learningUnitResourceSchema = signal<ConfiguredResourceSchema>(
    LEARNING_UNIT_RESOURCE_SCHEMA as unknown as ConfiguredResourceSchema
  );

  /** True once a load has completed, successfully or not. Stops repeat fetches. */
  private loaded = false;

  /**
   * Reads the Configuration collection and replaces any list it supplies.
   *
   * SAFE TO CALL MORE THAN ONCE; only the first does work. Called from the shell, so
   * it runs once per session after sign-in — the collection requires an authenticated
   * reader, and the signed-out pages use none of it.
   *
   * A DOCUMENT THAT IS ABSENT OR EMPTY IS SKIPPED, not applied. An empty array in
   * Firestore would otherwise blank a dropdown, and "someone deleted the values" is
   * far more likely than "this list is genuinely empty".
   */
  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    this.loaded = true;

    try {
      const byId = await this.readDocuments();

      /*
       * THE RAW DOCUMENTS ARE KEPT, and this is the one reader that needs them.
       *
       * Everything else on this service maps a known document and key onto a typed
       * signal, which is the right shape when the key is known at build time. A
       * form question's `dropDownDynamic` names its document and field IN ITS OWN
       * STORED VALUE — 'RYSI_Categories,subjects' — so which document to read is
       * data, not code, and no typed signal can stand in for it.
       */
      this.documents.set(byId);

      this.applyList(byId, 'countryCodes', this.countries);
      this.applyList(byId, 'boards', this.boards);
      this.applyList(byId, 'languages', this.languages);
      this.applyList(byId, 'schoolTypes', this.schoolTypes);
      this.applyList(byId, 'genderTypes', this.genderTypes);
      this.applyList(byId, 'customerSchool', this.customerSchool);
      this.applyList(byId, 'pincodeRules', this.pincodeRules);
      this.applyList(byId, 'classroomTypes', this.classroomTypes);
      this.applyList(byId, 'grades', this.grades);
      this.applyList(byId, 'sections', this.sections);
      this.applyList(byId, 'programmeStatuses', this.programmeStatuses);
      this.applyList(byId, 'programmeTypes', this.programmeTypes);
      this.applyList(byId, 'programmeAges', this.programmeAges);
      this.applyList(byId, 'programmeGrades', this.programmeGrades);
      this.applyList(byId, 'teacherRoles', this.teacherRoles);
      this.applyList(byId, 'assignmentTypes', this.assignmentTypes);
      this.applyList(byId, 'formQuestionTypes', this.formQuestionTypes);
      this.applyList(byId, 'quizPedagogyTypes', this.quizPedagogyTypes);
      this.applyList(byId, 'quizAuthTypes', this.quizAuthTypes);
      this.applyList(byId, 'assignmentStatuses', this.assignmentStatuses);
      this.applyList(byId, 'assignmentLiveStatuses', this.liveStatusValues);
      this.applyList(byId, 'assignmentClosedStatuses', this.closedStatusValues);
      this.applyUploadFormats(byId);
      this.applyUploadSizeCaps(byId);
      this.applyUploadExtensions(byId);
      this.applyQuizQuestionTypes(byId);
      this.applyCreatableTypes(byId);
      this.applyAssignmentDefaults(byId);
      this.applyWorkflowTypes(byId);

      // NEITHER of these is applyList: one row spells a field differently, and the
      // other is a map rather than an array. See each reader.
      this.applyDomains(byId);
      this.applyMaturities(byId);
      this.applyResourceSchema(byId);
      this.applyTypes(byId);

      // These four ARE plain arrays, so the generic loader handles them.
      this.applyList(byId, 'subjectTypes', this.subjectTypes);
      this.applyList(byId, 'subjectNames', this.subjectNames);
      this.applyList(byId, 'subjectDomainCodes', this.subjectDomainCodes);
      this.applyList(byId, 'legacyMaturity', this.legacyMaturityNames);
      this.applyList(byId, 'tacsSearchSubjects', this.tacsSearchSubjects);
      this.applyList(byId, 'tacsSearchBoards', this.tacsSearchBoards);
      this.applyList(byId, 'tacsSearchGrades', this.tacsSearchGrades);
      this.applyList(byId, 'learningUnitLanguages', this.learningUnitLanguages);
      this.applyList(byId, 'learningUnitDifficulty', this.learningUnitDifficulty);
    } catch (error) {
      // Deliberately swallowed. Every signal still holds the value the app shipped
      // with, so the only consequence is that a Firestore edit has not taken effect.
      console.error(
        'Could not read the Configuration collection. Falling back to the built-in ' +
          'option lists, so every dropdown still works.',
        error
      );
    }
  }

  /**
   * Reads acceptedUploadFormats.formatNames, which is a MAP.
   *
   * A SEPARATE READER RATHER THAN applyList, for the same reason applyMaturities
   * is one: applyList requires an array and this document stores an object keyed
   * by code. Its blind cast would hand every consumer an object where a list was
   * expected, and the Upload File Type select would render nothing at all — the
   * kind of empty dropdown that gets blamed on the data.
   *
   * The document's own iteration order is kept rather than sorted. It is the order
   * whoever edits the document chose, and re-sorting alphabetically would put
   * 'Excel' above 'Image' for no reason anyone asked for.
   */
  /**
   * Reads acceptedUploadFormats.sizeCaps, a MAP of code to megabytes.
   *
   * `DEFAULT` IS PULLED OUT rather than left in the map. It is not an upload type,
   * so leaving it there would make `uploadSizeCap('DEFAULT')` answer 40 for a type
   * that does not exist, and a future dropdown built from these keys would offer
   * 'DEFAULT' as something to upload.
   *
   * Non-numeric and non-positive values are dropped rather than coerced: a cap of
   * 0 would refuse every file, and NaN compares false against everything, so both
   * silently break the field they govern.
   */
  private applyUploadSizeCaps(documents: ConfigurationDocuments): void {
    const { id, key } = CONFIGURATION_DOCS.uploadSizeCaps;
    const value = documents.get(id)?.[key];

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return;
    }

    const caps: Record<string, number> = {};

    for (const [code, raw] of Object.entries(value as Record<string, unknown>)) {
      const size = Number(raw);

      if (!Number.isFinite(size) || size <= 0) {
        continue;
      }

      if (code.toUpperCase() === 'DEFAULT') {
        this.uploadSizeCapDefault.set(size);
        continue;
      }

      caps[code.toUpperCase()] = size;
    }

    if (Object.keys(caps).length > 0) {
      this.uploadSizeCaps.set(caps);
    }
  }

  /**
   * Reads acceptedUploadFormats.formats — extension lists, keyed lowercase.
   *
   * KEPT LOWERCASE, not folded to match `sizeCaps` above. Production writes this
   * map with lowercase keys and looks it up with
   * `uploadFileType.toLowerCase()`, and its own `formats` document is the one this
   * app will eventually read; normalising to uppercase here would mean the
   * document and the fallback disagreed about their own key case.
   *
   * A DOT IS ADDED WHERE THE DOCUMENT OMITS ONE, so 'pdf' and '.pdf' both work.
   * Production's list is dotted throughout, but a document edited by hand is the
   * likeliest place for that to slip, and an extension without its dot silently
   * matches nothing.
   *
   * AN EMPTY LIST IS DROPPED rather than stored. A type mapped to no extensions
   * refuses every file for that type, which reads as "uploads are broken" rather
   * than as a configuration mistake.
   */
  private applyUploadExtensions(documents: ConfigurationDocuments): void {
    const { id, key } = CONFIGURATION_DOCS.uploadExtensions;
    const value = documents.get(id)?.[key];

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return;
    }

    const formats: Record<string, readonly string[]> = {};

    for (const [type, raw] of Object.entries(value as Record<string, unknown>)) {
      if (!Array.isArray(raw)) {
        continue;
      }

      const extensions = raw
        .filter((entry): entry is string => typeof entry === 'string')
        .map(entry => entry.trim().toLowerCase())
        .filter(entry => entry !== '')
        .map(entry => (entry.startsWith('.') ? entry : `.${entry}`));

      if (extensions.length > 0) {
        formats[type.toLowerCase()] = Object.freeze(extensions);
      }
    }

    if (Object.keys(formats).length > 0) {
      this.uploadExtensions.set(Object.freeze(formats));
    }
  }

  /**
   * Reads AssignmentTypes.questionTypesQuiz and PUTS THE ICON BACK.
   *
   * The document carries `{ type, label }`; the icon names an SVG the icon
   * component knows and belongs in code. Each configured row is matched to the
   * built-in row for its type to recover the icon, and a type the code has never
   * seen gets a generic one rather than an empty space.
   */
  private applyQuizQuestionTypes(documents: ConfigurationDocuments): void {
    const { id, key } = CONFIGURATION_DOCS.quizQuestionTypes;
    const value = documents.get(id)?.[key];

    if (!Array.isArray(value) || value.length === 0) {
      return;
    }

    const icons = new Map(QUIZ_QUESTION_TYPES.map(entry => [entry.type, entry.icon]));

    const merged = value
      .map(entry => (entry ?? {}) as Record<string, unknown>)
      .filter(entry => typeof entry['type'] === 'string' && entry['type'] !== '')
      .map(entry => {
        const type = String(entry['type']);

        return {
          type,
          label: String(entry['label'] ?? type),
          icon: icons.get(type) ?? 'list'
        };
      });

    if (merged.length > 0) {
      this.quizQuestionTypes.set(merged);
    }
  }

  /**
   * Reads AssignmentTypes.creatableTypes, AND FILTERS IT AGAINST WHAT EXISTS.
   *
   * THE ONE CONFIGURED VALUE THAT IS NOT TAKEN AT ITS WORD, because this key is a
   * policy rather than a vocabulary: it says which kinds the Create menu offers,
   * and an editor adding 'TEXTBLOCK' does not bring a text-block editor into
   * being. Trusting it would put an entry in the menu that opens nothing.
   *
   * So the document may NARROW the three the app implements and cannot widen
   * them. Turning a type off is a real thing to want; turning one on is a release.
   */
  private applyCreatableTypes(documents: ConfigurationDocuments): void {
    const { id, key } = CONFIGURATION_DOCS.creatableAssignmentTypes;
    const value = documents.get(id)?.[key];

    if (!Array.isArray(value) || value.length === 0) {
      return;
    }

    const implemented = new Set<string>(ASSIGNMENT_TYPES.map(entry => entry.type));
    const wanted = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map(entry => entry.toUpperCase())
      .filter(entry => implemented.has(entry)) as AssignmentType[];

    if (wanted.length > 0) {
      this.creatableAssignmentTypes.set(wanted);
    }
  }

  /**
   * Reads AssignmentDefaults.defaults, FIELD BY FIELD.
   *
   * Not `set(value)`: a document setting only `formInstructions` would otherwise
   * blank the other two, and a partial document is the normal way somebody edits
   * one. Each field is taken only when it is present and of the right type.
   */
  private applyAssignmentDefaults(documents: ConfigurationDocuments): void {
    const { id, key } = CONFIGURATION_DOCS.assignmentDefaults;
    const value = documents.get(id)?.[key];

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return;
    }

    const source = value as Record<string, unknown>;
    const next: ConfiguredAssignmentDefaults = { ...this.assignmentDefaults() };

    if (typeof source['formInstructions'] === 'string') {
      next.formInstructions = source['formInstructions'];
    }

    const uploads = Number(source['slotMaxUploads']);

    if (Number.isFinite(uploads) && uploads >= 1) {
      next.slotMaxUploads = Math.floor(uploads);
    }

    if (typeof source['quizMediaFolder'] === 'string' && source['quizMediaFolder'] !== '') {
      next.quizMediaFolder = source['quizMediaFolder'];
    }

    this.assignmentDefaults.set(next);
  }

  private applyUploadFormats(documents: ConfigurationDocuments): void {
    const { id, key } = CONFIGURATION_DOCS.uploadFormats;
    const value = documents.get(id)?.[key];

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return;
    }

    const options = Object.entries(value as Record<string, unknown>)
      .filter(([code, label]) => code !== '' && typeof label === 'string' && label !== '')
      .map(([code, label]) => ({ code, label: String(label) }));

    if (options.length > 0) {
      this.uploadFileTypes.set(options);
    }
  }

  /**
   * Copies one document's list onto its signal, if there is one worth copying.
   *
   * Typed loosely on purpose: this is the boundary where untyped Firestore data
   * arrives, and pretending otherwise would put the cast somewhere less obvious.
   */
  private applyList<T>(
    documents: ConfigurationDocuments,
    name: keyof typeof CONFIGURATION_DOCS,
    target: { set(value: readonly T[]): void }
  ): void {
    const { id, key } = CONFIGURATION_DOCS[name];
    const value = documents.get(id)?.[key];

    if (Array.isArray(value) && value.length > 0) {
      target.set(value as readonly T[]);
    }
  }

  /**
   * Copies the taxonomy rows across, TRANSLATING the sub-domain name.
   *
   * A SEPARATE READER RATHER THAN applyList, for one reason: `subdomainName`. Firestore
   * stores the lowercase-d spelling and this app uses `subDomainName` everywhere, so
   * applyList's blind cast would hand every consumer a row whose `subDomainName` is
   * undefined. That does not fail — it renders an empty Sub-Domain Name field and an
   * empty entry in the sub-domain dropdown, which is the kind of bug that gets blamed
   * on the data.
   *
   * EITHER SPELLING IS ACCEPTED, lowercase first because that is what production and
   * the seed both write. A row hand-typed in the console with the camelCase spelling
   * still works.
   *
   * ROWS WITHOUT A LETTER PAIR ARE DROPPED. domainCode and subDomainCode are what the
   * whole lookup keys on, so a row missing either can never match a code and would
   * only pad the dropdowns with blanks.
   *
   * compositeCode IS RECOMPUTED, never read. The stored value agrees with the two
   * letters in all 44 production rows, but it is derived data sitting in a document a
   * person can edit, and compositeCodeFor() is the one definition of it.
   */
  private applyDomains(documents: ConfigurationDocuments): void {
    const { id, key } = CONFIGURATION_DOCS.learningUnitDomains;
    const value = documents.get(id)?.[key];

    if (!Array.isArray(value) || value.length === 0) {
      return;
    }

    const rows = (value as ConfiguredDomainRow[])
      .filter(row => row?.domainCode && row?.subDomainCode)
      .map<TaxonomyRow>(row => ({
        subjectCode: row.subjectCode ?? '',
        subjectName: row.subjectName ?? '',
        domainCode: row.domainCode,
        domainName: row.domainName ?? '',
        subDomainCode: row.subDomainCode,
        subDomainName: row.subdomainName ?? row.subDomainName ?? ''
      }));

    if (rows.length > 0) {
      this.learningUnitDomains.set(rows);
    }
  }

  /**
   * Copies the maturity ladder across, FROM A MAP rather than an array.
   *
   * applyList cannot read this document at all: `maturity` is an object keyed by
   * level name, so `Array.isArray` is false and the list would be skipped in
   * silence — the failure mode being a dropdown that quietly never reflects the
   * document, which looks exactly like the document not having been edited.
   *
   * THE KEY IS THE FALLBACK for `level`. Production stores both — key 'gold' and
   * field level 'Gold' — and they agree in all four entries, but the field is the
   * display form so it wins; the key, capitalised, stands in if the field is
   * missing from a hand-typed entry.
   *
   * AN ENTRY WITH NO LADDER IS DROPPED. cumulativeMaturity is the only thing this
   * document is really for — it is what decides how many resource documents a
   * maturity creates — and an entry without one would sort as rank 0 and expand to
   * nothing, which is worse than not offering the level.
   *
   * SORTED ON THE WAY IN, so every reader gets rank order for free.
   */
  /**
   * Copies the workflow types across, TRANSLATING `displayName` to `label`.
   *
   * A SEPARATE READER RATHER THAN applyList, for the same reason applyDomains is
   * one: the document's rows are `{ code, displayName }` and this app's CodedOption
   * is `{ code, label }`. applyList's blind cast would set the signal to rows whose
   * `label` is undefined, and the Workflow Type select would render two blank
   * options — a bug that looks like bad data rather than a bad read.
   *
   * A ROW WITHOUT A CODE IS DROPPED. The code is what gets stored on the template
   * and what its list page labels by, so a row missing it can only add a blank
   * option that writes an empty `type`.
   *
   * A ROW WITHOUT A displayName KEEPS ITS CODE as the label. 'STEM-CLUB' in the
   * dropdown is ugly; a blank option is worse, and the code is at least true.
   *
   * NOTHING IS APPLIED IF EVERY ROW IS DROPPED, so a malformed document leaves the
   * seeded two in place rather than emptying the select.
   */
  private applyWorkflowTypes(documents: ConfigurationDocuments): void {
    const { id, key } = CONFIGURATION_DOCS.workflowTypes;
    const value = documents.get(id)?.[key];

    if (!Array.isArray(value)) {
      return;
    }

    const types = (value as ConfiguredWorkflowType[])
      .filter(entry => typeof entry?.code === 'string' && entry.code !== '')
      .map<CodedOption>(entry => ({
        code: entry.code as string,
        label: entry.displayName || (entry.code as string)
      }));

    if (types.length > 0) {
      this.workflowTypes.set(types);
    }
  }

  private applyMaturities(documents: ConfigurationDocuments): void {
    const { id, key } = CONFIGURATION_DOCS.learningUnitMaturity;
    const value = documents.get(id)?.[key];

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return;
    }

    const levels = Object.entries(value as Record<string, ConfiguredMaturity>)
      .filter(([, entry]) => Array.isArray(entry?.cumulativeMaturity) &&
                             entry.cumulativeMaturity.length > 0)
      .map<MaturityLevel>(([mapKey, entry]) => ({
        level: entry.level || mapKey.charAt(0).toUpperCase() + mapKey.slice(1),
        upgradeable: entry.upgradeable === true,
        availableUpgrades: entry.availableUpgrades ?? [],
        cumulativeMaturity: entry.cumulativeMaturity as string[]
      }));

    if (levels.length > 0) {
      this.learningUnitMaturities.set(orderedMaturities(levels));
    }
  }

  /**
   * Copies the resource skeleton across WHOLE, with no per-field translation.
   *
   * DELIBERATELY THE SHALLOWEST READER OF THE THREE. applyDomains renames a field and
   * applyMaturities reshapes a map, because the app has its own types for those. This
   * one does not: the schema's value is its exact structure, four levels of keys that
   * mirror what production's Google Sheet emitted, and any normalisation here would
   * be inventing a shape nothing has asked for. It is validated as "a non-empty
   * object" and stored as-is.
   *
   * A TYPE WITH NO MATURITIES IS KEPT, not filtered. 'GroupActivity' and 'Keep@Home'
   * are declared empty in production, and that is meaningful — a known type with no
   * upload slots, as against a type nobody has configured. Dropping them would erase
   * the distinction.
   */
  private applyResourceSchema(documents: ConfigurationDocuments): void {
    const { id, key } = CONFIGURATION_DOCS.learningUnitResourceSchema;
    const value = documents.get(id)?.[key];

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return;
    }

    if (Object.keys(value).length > 0) {
      this.learningUnitResourceSchema.set(value as ConfiguredResourceSchema);
    }
  }

  /**
   * Copies the thirteen types across, FROM A MAP keyed by code.
   *
   * The third reader that cannot use applyList, and for the same reason as
   * applyMaturities: `Types` is an object, so Array.isArray is false and the list would
   * be skipped in silence.
   *
   * THE KEY IS THE FALLBACK FOR `code`, and both are present in all thirteen production
   * entries. A NAME IS REQUIRED, though — an entry without one would render as a blank
   * option that still mints a typeCode when chosen, which is worse than being absent.
   *
   * SORTED BY CODE so the dropdown order is stable no matter how the map iterates.
   */
  private applyTypes(documents: ConfigurationDocuments): void {
    const { id, key } = CONFIGURATION_DOCS.learningUnitTypes;
    const value = documents.get(id)?.[key];

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return;
    }

    const types = Object.entries(value as Record<string, { code?: string; name?: string }>)
      .filter(([, entry]) => typeof entry?.name === 'string' && entry.name.trim() !== '')
      .map(([mapKey, entry]) => ({ name: entry.name as string, code: entry.code || mapKey }))
      .sort((a, b) => a.code.localeCompare(b.code));

    if (types.length > 0) {
      this.learningUnitTypes.set(types);
    }
  }

  // ---- Derived helpers, replacing the module-level functions --------------

  /** The dial code for a country name, or the default's. */
  dialFor(name: string): string {
    return (
      this.countries().find(country => country.name === name)?.dial ??
      this.countries().find(country => country.name === DEFAULT_COUNTRY)?.dial ??
      ''
    );
  }

  /** Country names, alphabetical, for the selects. */
  countryNames(): readonly string[] {
    return this.countries().map(country => country.name);
  }

  /**
   * Whether a pincode is complete for its country.
   *
   * Replaces the `if (country === 'India')` branch. A country with no rule is
   * accepted on any non-empty value, which is what the old else-branch did.
   */
  isCompletePincode(raw: string, country: string): boolean {
    const value = (raw ?? '').trim();
    const rule = this.pincodeRules().find(entry => entry.country === country);

    if (!rule) {
      return value.length > 0;
    }

    try {
      return new RegExp(rule.pattern).test(value);
    } catch {
      // A malformed pattern in Firestore must not make every pincode invalid.
      console.error(`Configuration: PincodeRules has an invalid pattern for ${country}.`);
      return value.length > 0;
    }
  }

  /** Digits a pincode input is truncated to. 12 for a country with no rule. */
  pincodeDigits(raw: string, country: string): string {
    const rule = this.pincodeRules().find(entry => entry.country === country);
    const value = raw ?? '';

    return rule ? value.replace(/\D/g, '').slice(0, rule.digits) : value.slice(0, 12);
  }
}

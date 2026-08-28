import { InjectionToken, Injectable, computed, inject, signal } from '@angular/core';
import { getDocs } from 'firebase/firestore';

import {
  CONFIGURATION_DOCS,
  CodedOption,
  ConfiguredCountry,
  ConfiguredDomainRow,
  ConfiguredMaturity,
  ConfiguredResourceSchema,
  ConfiguredSchoolType,
  ConfiguredSubjectType,
  PincodeRule,
  ValuedOption
} from '../core/configuration';
import { configurationCollection } from '../core/firestore-paths';
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

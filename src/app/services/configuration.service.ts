import { InjectionToken, Injectable, computed, inject, signal } from '@angular/core';
import { collection, getDocs } from 'firebase/firestore';

import {
  CONFIGURATION_COLLECTION,
  CONFIGURATION_DOCS,
  CodedOption,
  ConfiguredCountry,
  ConfiguredSchoolType,
  PincodeRule,
  ValuedOption
} from '../core/configuration';
import { db } from '../core/firebase';
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
      const snapshot = await getDocs(collection(db, CONFIGURATION_COLLECTION));
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

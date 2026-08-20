import { LearningUnit, LearningUnitDraft, LearningUnitStatus } from '../models/teaching.model';
import { PROGRAMME_STATUSES } from './programme-options';

/**
 * Controlled vocabularies for the learning-unit forms.
 *
 * Static for the same reason the other three option files are: these change with
 * a release, not with user data.
 */

/**
 * Re-exported rather than redeclared.
 *
 * A learning unit's status vocabulary IS a programme's — same two values, same
 * preserved misspelling, same "anything not live is a draft" reading. Declaring
 * a second identical list would be two things to keep in step for no gain, and
 * the LearningUnitStatus alias already says they are the same type.
 */
export const LEARNING_UNIT_STATUSES = PROGRAMME_STATUSES;

/**
 * The ISO codes production's learning units carry.
 *
 * Two-letter codes, uppercase, as production stores them — the programme
 * picker's language filter renders these verbatim ("TA · EN · vV22").
 */
export const LEARNING_UNIT_LANGUAGES: readonly { code: string; label: string }[] = [
  { code: 'EN', label: 'English' },
  { code: 'HI', label: 'Hindi' },
  { code: 'KN', label: 'Kannada' },
  { code: 'MR', label: 'Marathi' },
  { code: 'TA', label: 'Tamil' },
  { code: 'TE', label: 'Telugu' }
] as const;

/**
 * Difficulty, as strings.
 *
 * Production types `difficultyLevel` as `number | string` and stores both, so one
 * type here removes a branch at every comparison — the same choice
 * Classroom.grade makes.
 */
export const DIFFICULTY_LEVELS: readonly string[] = ['1', '2', '3', '4', '5'] as const;

/**
 * Domains, matching the categorisation production's units carry.
 *
 * A fixed list rather than free text so the list page's filter has a closed set
 * to work with. Production's own domain list lives in a Configuration document;
 * reading it would mean another collection and another rule block for a
 * vocabulary that changes with a release.
 */
export const LEARNING_UNIT_DOMAINS: readonly string[] = [
  'Physics', 'Chemistry', 'Biology', 'Mathematics', 'Technology', 'Environment'
] as const;

export function languageLabel(code: string): string {
  return LEARNING_UNIT_LANGUAGES.find(language => language.code === code)?.label ?? code;
}

/**
 * What the list and pickers show as the unit's title.
 *
 * Prefers the display name, as every other entity in this app does, and falls
 * back rather than rendering a blank cell.
 */
export function learningUnitTitle(
  unit: Pick<LearningUnit, 'learningUnitDisplayName' | 'learningUnitName'>
): string {
  return unit.learningUnitDisplayName?.trim() || unit.learningUnitName?.trim() || '';
}

/**
 * "TA · EN · vV22" — the sub-line the programme picker renders.
 *
 * Takes the language codes as a list because the picker collapses several
 * documents sharing a code into one row; a single unit passes its one isoCode.
 */
export function unitMetaLabel(languages: string[], version: string): string {
  return [...languages, version].filter(Boolean).join(' · ');
}

/**
 * Minutes as "1h 25m", or "45m".
 *
 * The list shows totalTime and a bare minute count past sixty reads badly —
 * "150" is not obviously two and a half hours.
 */
export function totalTimeLabel(minutes: number): string {
  if (!minutes || minutes <= 0) {
    return '—';
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (hours === 0) {
    return `${remainder}m`;
  }

  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

/* ==========================================================================
   Versions
   ==========================================================================
   Production's version has TWO forms and they are easy to confuse:

     'EN-V10'   the form field — language, a hyphen, then the version
     'V10'      what is STORED on the document, i.e. the part after the hyphen

   The form field carries the language because a unit's versions are numbered
   PER LANGUAGE: the Tamil and English copies of PT12 both start at V10 and
   climb independently. The stored field drops it because the document already
   has `isoCode`. */

/** The numeric part of a stored version: 'V22' → 22. NaN-safe, returns 0. */
export function versionNumberOf(version: string): number {
  const digits = String(version ?? '').split('V')[1];
  const parsed = Number.parseInt(digits, 10);

  return Number.isFinite(parsed) ? parsed : 0;
}

/** 'EN-V11' → 'V11'. What `version` stores. */
export function storedVersionOf(versionLabel: string): string {
  const parts = String(versionLabel ?? '').split('-');

  return (parts.length > 1 ? parts[1] : parts[0]).trim();
}

/**
 * The next version label for a code in a language.
 *
 * V10 IS THE FIRST, not V1 — production seeds a brand new unit at V10 and
 * increments the whole number from there, so the second version is V11. (The
 * export sheet divides it by ten to show "1.0", which is where the 10 comes
 * from.) An empty family therefore starts at V10 rather than V1.
 *
 * Scoped by code AND language AND type code, exactly as production scopes it: a
 * Tamil V12 must not push the English family to V13.
 */
export function nextVersionLabel(
  units: readonly Pick<LearningUnit, 'learningUnitCode' | 'isoCode' | 'typeCode' | 'version'>[],
  code: string,
  isoCode: string,
  typeCode: string
): string {
  const family = units.filter(
    unit =>
      unit.learningUnitCode === code &&
      unit.isoCode === isoCode &&
      unit.typeCode === typeCode
  );

  if (family.length === 0) {
    return `${isoCode}-V10`;
  }

  const highest = family.reduce(
    (max, unit) => Math.max(max, versionNumberOf(unit.version)),
    0
  );

  return `${isoCode}-V${highest + 1}`;
}

/**
 * `learningUnitId` — 'TA-AE04-EN-V10'.
 *
 * Type code, code, then the FULL version label including the language. Not the
 * document id: production mints a separate Firestore id and stores this
 * alongside it, so two documents can never collide on the id while still
 * carrying the same human-readable identity.
 */
export function learningUnitIdOf(
  typeCode: string,
  code: string,
  versionLabel: string
): string {
  return [typeCode, code, versionLabel].map(part => String(part ?? '').trim()).join('-');
}

/**
 * A blank draft.
 *
 * Status defaults to DEVELOPEMENT, not LIVE. Production creates every learning
 * unit as a draft and promotes it once its resources exist — a newly added unit
 * has no guide, no video and no template, so publishing it straight into every
 * programme picker would offer teachers an empty activity. (The misspelling is
 * production's stored value, preserved deliberately; see LearningUnitStatus.)
 */
export function emptyLearningUnitDraft(): LearningUnitDraft {
  return {
    learningUnitCode: '',
    learningUnitName: '',
    learningUnitDisplayName: '',
    isoCode: '',
    version: '',
    status: 'DEVELOPEMENT' as LearningUnitStatus,
    type: '',
    typeCode: '',
    Maturity: '',
    subjectCode: '',
    subjectName: '',
    domainCode: '',
    domainName: '',
    subDomainCode: '',
    subDomainName: '',
    compositeCode: '',
    tacOwnerName: '',
    // The three the Add form does not ask for, at production's create-time
    // defaults. Production's dialog collects the identity and the categorisation
    // only; description, difficulty and timings are filled in afterwards on the
    // unit's own editor, and it writes 0 / 45 / '' in the meantime rather than
    // leaving them absent — an absent field cannot be read back and rewritten.
    shortDescription: '',
    difficultyLevel: '0',
    totalTime: 45
  };
}

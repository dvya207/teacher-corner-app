/**
 * The learning-unit taxonomy: subject → domain → sub-domain, plus types and
 * maturities.
 *
 * WHAT THIS IS FOR. Production's Add-a-Learning-Unit form does not ask for the
 * categorisation — it DERIVES it from the four-character code. `AE04` means
 * domain `A`, sub-domain `E`, and the row matching that pair supplies the
 * subject code, subject name, domain name and sub-domain name; the composite
 * code is the two letters concatenated. So the taxonomy is not decoration, it is
 * the lookup table that makes a code valid or invalid.
 *
 * WHERE PRODUCTION KEEPS IT. Three documents in the `Configuration` collection:
 *
 *   Configuration/learningUnitDomains  → `domains`      (the rows below)
 *   Configuration/subjectTypes         → `subjectTypes` ({ code, name })
 *   Configuration/LearningUnitTypes    → `Types`        ({ code, name })
 *
 * WHY IT IS STATIC HERE. The same reason LEARNING_UNIT_DOMAINS was static
 * before it: reading a Configuration collection would mean another collection,
 * another rule block and another deploy for a vocabulary that changes with a
 * release rather than with user data. The row SHAPE is production's exactly, so
 * moving to Firestore later replaces this file's constants and nothing else.
 *
 * ------------------------------------------------------------------------
 * PROVISIONAL DATA — READ THIS BEFORE TRUSTING THE NAMES
 * ------------------------------------------------------------------------
 * The CODES below are real: every letter pair is taken from a learning unit
 * that exists in production. The NAMES attached to them are inferred from the
 * units carrying each pair (PS07 "Harmonica Model" → P/S is Physics/Sound) and
 * have NOT been read back from `Configuration/learningUnitDomains`, because
 * this machine has no credentials for the production Firebase project.
 *
 * Replace the three constants with the real documents when credentials exist:
 *
 *   ./scripts/import-lu-taxonomy.sh
 *
 * Until then the lookup mechanism is correct and the vocabulary is a best
 * reading. `taxonomyFromUnits` below also folds in whatever the loaded
 * documents actually carry, so real data overrides these rows in the pickers as
 * soon as the collection has any.
 */

import { LearningUnit } from '../models/teaching.model';

/** One row of `Configuration/learningUnitDomains.domains`, field for field. */
export interface TaxonomyRow {
  subjectCode: string;
  subjectName: string;
  /** ONE character — the first character of the learning unit code. */
  domainCode: string;
  domainName: string;
  /** ONE character — the second character of the learning unit code. */
  subDomainCode: string;
  subDomainName: string;
}

/**
 * `[A-Z]{2}[0-9]{2}` — two letters then two digits, as production's input
 * enforces with `pattern` and `maxlength="4"`.
 *
 * Anchored at both ends. Production's pattern is `[A-Z]{2}[0-9]{2}$`, which is
 * unanchored at the start and would accept a longer string were the maxlength
 * attribute ever removed; anchoring here means the check does not depend on a
 * second attribute agreeing with it.
 */
export const LEARNING_UNIT_CODE_PATTERN = /^[A-Z]{2}[0-9]{2}$/;

/** PROVISIONAL — see the file header. Codes real, names inferred. */
export const LEARNING_UNIT_TAXONOMY: readonly TaxonomyRow[] = [
  // Physics
  { subjectCode: 'SC', subjectName: 'Science', domainCode: 'P', domainName: 'Physics', subDomainCode: 'S', subDomainName: 'Sound' },
  { subjectCode: 'SC', subjectName: 'Science', domainCode: 'P', domainName: 'Physics', subDomainCode: 'L', subDomainName: 'Light' },
  { subjectCode: 'SC', subjectName: 'Science', domainCode: 'P', domainName: 'Physics', subDomainCode: 'M', subDomainName: 'Electricity and Magnetism' },

  // Chemistry
  { subjectCode: 'SC', subjectName: 'Science', domainCode: 'C', domainName: 'Chemistry', subDomainCode: 'C', subDomainName: 'Chemical Change' },
  { subjectCode: 'SC', subjectName: 'Science', domainCode: 'C', domainName: 'Chemistry', subDomainCode: 'M', subDomainName: 'Mixtures and Solutions' },

  // Biology
  { subjectCode: 'SC', subjectName: 'Science', domainCode: 'B', domainName: 'Biology', subDomainCode: 'A', subDomainName: 'Anatomy and Physiology' },
  { subjectCode: 'SC', subjectName: 'Science', domainCode: 'B', domainName: 'Biology', subDomainCode: 'M', subDomainName: 'Environment and Soil' },

  // Earth and space
  { subjectCode: 'SC', subjectName: 'Science', domainCode: 'E', domainName: 'Earth and Space', subDomainCode: 'S', subDomainName: 'Space' },

  // Mathematics
  { subjectCode: 'MA', subjectName: 'Mathematics', domainCode: 'A', domainName: 'Algebra', subDomainCode: 'E', subDomainName: 'Expressions and Identities' },
  { subjectCode: 'MA', subjectName: 'Mathematics', domainCode: 'N', domainName: 'Numeracy', subDomainCode: 'N', subDomainName: 'Mensuration' },
  { subjectCode: 'MA', subjectName: 'Mathematics', domainCode: 'N', domainName: 'Numeracy', subDomainCode: 'O', subDomainName: 'Operations' },
  { subjectCode: 'MA', subjectName: 'Mathematics', domainCode: 'N', domainName: 'Numeracy', subDomainCode: 'P', subDomainName: 'Patterns' },

  // Sandbox — the pair production's own debug units carry (SF99).
  { subjectCode: 'SB', subjectName: 'Sandbox', domainCode: 'S', domainName: 'Sandbox', subDomainCode: 'F', subDomainName: 'Fixtures' }
] as const;

/**
 * Learning unit types — `Configuration/LearningUnitTypes.Types`.
 *
 * PROVISIONAL, as above. The `code` matters beyond display: it is the first
 * segment of `learningUnitId` ('TA-AE04-EN-V10') and is stored separately as
 * `typeCode`, so changing one of these renames every id minted afterwards.
 */
export const LEARNING_UNIT_TYPES: readonly { name: string; code: string }[] = [
  { name: 'TACtivity', code: 'TA' },
  { name: 'Tool TAC', code: 'TT' },
  { name: 'MUT', code: 'MU' },
  { name: 'Topic', code: 'TP' }
] as const;

/**
 * Maturities, in production's order.
 *
 * This one is NOT provisional — it is hardcoded in production's component as
 * `defaultMaturities`, not read from Configuration, and these are the four.
 */
export const LEARNING_UNIT_MATURITIES: readonly string[] = [
  'Gold', 'Silver', 'Diamond', 'Platinum'
] as const;

/** The type row for a type name, for `typeCode` and the id prefix. */
export function learningUnitType(name: string): { name: string; code: string } | null {
  return LEARNING_UNIT_TYPES.find(type => type.name === name) ?? null;
}

export function learningUnitTypeCode(name: string): string {
  return learningUnitType(name)?.code ?? '';
}

/**
 * The taxonomy row a four-character code resolves to, or null.
 *
 * Production reads the FIRST character as the domain code and the SECOND as the
 * sub-domain code, and looks for a row matching both. A code whose pair has no
 * row is what turns `codeValid` false and blocks Save — the pair is the whole
 * validity check, the digits are just a serial number.
 */
export function taxonomyForCode(
  code: string,
  rows: readonly TaxonomyRow[] = LEARNING_UNIT_TAXONOMY
): TaxonomyRow | null {
  const trimmed = String(code ?? '').trim().toUpperCase();

  if (!LEARNING_UNIT_CODE_PATTERN.test(trimmed)) {
    return null;
  }

  const domainCode = trimmed[0];
  const subDomainCode = trimmed[1];

  return rows.find(
    row => row.domainCode === domainCode && row.subDomainCode === subDomainCode
  ) ?? null;
}

/**
 * The composite code: domain code then sub-domain code, concatenated.
 *
 * Production writes `String(domainCode) + String(subDomainCode)` — so for AE04
 * the composite code is 'AE', not the full code and not a longer join. Kept as
 * its own function because the form shows it in a field of its own and a reader
 * would otherwise assume it were something richer.
 */
export function compositeCodeFor(row: Pick<TaxonomyRow, 'domainCode' | 'subDomainCode'>): string {
  return `${row.domainCode}${row.subDomainCode}`;
}

/**
 * Distinct taxonomy rows carried by the learning units themselves.
 *
 * WHY. Every production learning unit stores its own subjectCode, subjectName,
 * domainCode, domainName, subDomainCode and subDomainName. That makes the
 * loaded collection a second, authoritative source for the vocabulary — and one
 * that cannot drift from the data, because it IS the data. Folding it over the
 * static rows means a real database corrects this file's inferred names without
 * anyone editing this file.
 *
 * Keyed on the letter pair, which is what the lookup uses. Rows from the units
 * WIN over the static seed for a pair they both define.
 */
export function taxonomyFromUnits(units: readonly LearningUnit[]): TaxonomyRow[] {
  const byPair = new Map<string, TaxonomyRow>();

  for (const row of LEARNING_UNIT_TAXONOMY) {
    byPair.set(`${row.domainCode}${row.subDomainCode}`, row);
  }

  for (const unit of units) {
    const domainCode = String(unit.domainCode ?? '').trim().toUpperCase();
    const subDomainCode = String(unit.subDomainCode ?? '').trim().toUpperCase();

    // A unit predating these fields carries neither, and a half-filled pair
    // cannot be looked up — both are skipped rather than stored partially.
    if (!domainCode || !subDomainCode) {
      continue;
    }

    byPair.set(`${domainCode}${subDomainCode}`, {
      subjectCode: unit.subjectCode || '',
      subjectName: unit.subjectName || '',
      domainCode,
      domainName: unit.domainName || '',
      subDomainCode,
      subDomainName: unit.subDomainName || ''
    });
  }

  return [...byPair.values()];
}

/* ==========================================================================
   Picker vocabularies
   ==========================================================================
   Each returns the DISTINCT values of one column, because the six selects in
   the form are six flat lists — production builds these with the same reduce.
   Sorted, so the option order does not depend on row order in the table. */

function distinct(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function subjectCodesOf(rows: readonly TaxonomyRow[]): string[] {
  return distinct(rows.map(row => row.subjectCode));
}

export function subjectNamesOf(rows: readonly TaxonomyRow[]): string[] {
  return distinct(rows.map(row => row.subjectName));
}

export function domainCodesOf(rows: readonly TaxonomyRow[]): string[] {
  return distinct(rows.map(row => row.domainCode));
}

export function domainNamesOf(rows: readonly TaxonomyRow[]): string[] {
  return distinct(rows.map(row => row.domainName));
}

export function subDomainCodesOf(rows: readonly TaxonomyRow[]): string[] {
  return distinct(rows.map(row => row.subDomainCode));
}

/**
 * Sub-domain names for a sub-domain code.
 *
 * Filtered rather than flat, because production filters: selecting a
 * sub-domain code narrows the name list to the names that code is used with.
 * With no code chosen the list is every name, so the field is never empty.
 */
export function subDomainNamesOf(
  rows: readonly TaxonomyRow[],
  subDomainCode: string
): string[] {
  const code = String(subDomainCode ?? '').trim().toUpperCase();
  const scoped = code ? rows.filter(row => row.subDomainCode === code) : rows;

  return distinct(scoped.map(row => row.subDomainName));
}

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
 * release rather than with user data.
 *
 * ------------------------------------------------------------------------
 * NO LONGER PROVISIONAL, AND NOW SEEDED RATHER THAN ONLY STATIC
 * ------------------------------------------------------------------------
 * These rows WERE a best reading — real letter pairs with names inferred from the
 * units carrying them, because this machine had no credentials for the production
 * project. They are not any more. All 44 rows were read out of production's own
 * `Configuration/learningUnitDomains` and pasted in verbatim, quirks included.
 *
 * The constants here now serve THREE purposes at once, which is why they stay in
 * source rather than moving wholesale into Firestore:
 *
 *   1. the app's FALLBACK, per the pattern configuration.service.ts uses
 *      everywhere — every dropdown works with the collection unreachable;
 *   2. the SEED for this app's own database, via scripts/seed-configuration.mjs,
 *      which writes them to Configuration/learningUnitDomains in
 *      teacher-corner-dev;
 *   3. the lookup any part of the learning-unit feature can import directly,
 *      without waiting on a read.
 *
 * So the same 44 rows are hardcoded here AND fetchable from Firestore, and the two
 * cannot disagree at the moment of seeding because one is written from the other.
 * A later console edit to the document wins at runtime; that is the point.
 *
 * `scripts/import-lu-taxonomy.sh` is now redundant for `domains` — it was written to
 * do this job from production credentials, which never arrived. It is left in place
 * for `subjectTypes` and `LearningUnitTypes`, which are still unread.
 *
 * `taxonomyFromUnits` below still folds in whatever the loaded units carry, so a
 * pair present in the data but missing from these rows is still offered.
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

/**
 * `Configuration/learningUnitDomains.domains` — ALL 44 ROWS, VERBATIM.
 *
 * NO LONGER PROVISIONAL. These were read out of the production document itself
 * (thinktac-india-production / Configuration / learningUnitDomains), replacing the
 * thirteen rows whose letter pairs were real but whose names were inferred from the
 * units carrying them. Every name here is the stored one.
 *
 * PRODUCTION'S QUIRKS ARE PRESERVED, not corrected, because this table is seeded
 * INTO Firestore and read back out of it — a "fix" here would silently disagree with
 * every other app reading the same document:
 *
 *   SM    domainName is the EMPTY STRING. Its siblings SC/SG/SP all say 'Statistics'
 *         and it plainly should too, but it does not, so neither does this.
 *   GB    'Comparision of Shapes' — misspelled at source.
 *   SC    'Central Tendancy' — misspelled at source.
 *   PM    'Electricity & Magnetism' with an ampersand, where the old inferred row
 *         spelled it 'Electricity and Magnetism'.
 *   ZP    domain 'Partners', sub-domain 'Physics'. Not a subject at all — it is the
 *         bucket partner-contributed units land in, and it is a real pair, so a ZP
 *         code has to validate.
 *
 * SUBJECT CODES ARE ONE LETTER — M, S, E, T. The rows this replaced used two ('MA',
 * 'SC', 'SB'), which was the inference being wrong rather than a different
 * convention. Note that 'SC' as a SUBJECT code is gone while 'SC' as a COMPOSITE
 * code (Statistics / Central Tendancy) is one of the 44, so the two are easy to
 * confuse when grepping.
 *
 * FOUR SUBJECTS APPEAR HERE, not the five the taxonomy defines: Health (H) has no
 * row, so no code beginning with its domain letter validates today.
 *
 * ORDER IS COMPOSITE-CODE ORDER, grouped by domain. Production's `domains` array is
 * in neither — it is roughly insertion order — and nothing reads the array
 * positionally, so a legible order is worth more here than a faithful one. The
 * `domainMap` field of the same document is keyed by composite code and IS
 * effectively this order.
 *
 * The Firestore field is spelled `subdomainName`, lowercase d, where this interface
 * says `subDomainName`. See TaxonomyRow and the reader in configuration.service.ts:
 * the app keeps its own spelling and the boundary translates.
 */
export const LEARNING_UNIT_TAXONOMY: readonly TaxonomyRow[] = [
  { subjectCode: 'M', subjectName: 'Mathematics', domainCode: 'A', domainName: 'Algebra', subDomainCode: 'E', subDomainName: 'Equations' },
  { subjectCode: 'M', subjectName: 'Mathematics', domainCode: 'A', domainName: 'Algebra', subDomainCode: 'V', subDomainName: 'Variables and Expressions' },

  { subjectCode: 'S', subjectName: 'Science', domainCode: 'B', domainName: 'Biology', subDomainCode: 'A', subDomainName: 'Animal' },
  { subjectCode: 'S', subjectName: 'Science', domainCode: 'B', domainName: 'Biology', subDomainCode: 'E', subDomainName: 'Ecosystem' },
  { subjectCode: 'S', subjectName: 'Science', domainCode: 'B', domainName: 'Biology', subDomainCode: 'M', subDomainName: 'Microbes' },
  { subjectCode: 'S', subjectName: 'Science', domainCode: 'B', domainName: 'Biology', subDomainCode: 'O', subDomainName: 'Other' },
  { subjectCode: 'S', subjectName: 'Science', domainCode: 'B', domainName: 'Biology', subDomainCode: 'P', subDomainName: 'Plant' },

  { subjectCode: 'S', subjectName: 'Science', domainCode: 'C', domainName: 'Chemistry', subDomainCode: 'C', subDomainName: 'Chemical Reactions' },
  { subjectCode: 'S', subjectName: 'Science', domainCode: 'C', domainName: 'Chemistry', subDomainCode: 'H', subDomainName: 'Heat' },
  { subjectCode: 'S', subjectName: 'Science', domainCode: 'C', domainName: 'Chemistry', subDomainCode: 'M', subDomainName: 'Mixtures' },
  { subjectCode: 'S', subjectName: 'Science', domainCode: 'C', domainName: 'Chemistry', subDomainCode: 'O', subDomainName: 'Others' },
  { subjectCode: 'S', subjectName: 'Science', domainCode: 'C', domainName: 'Chemistry', subDomainCode: 'P', subDomainName: 'Properties of Matter' },
  { subjectCode: 'S', subjectName: 'Science', domainCode: 'C', domainName: 'Chemistry', subDomainCode: 'Q', subDomainName: 'Measurements' },

  { subjectCode: 'E', subjectName: 'Earth Sciences', domainCode: 'E', domainName: 'Earth Sciences', subDomainCode: 'E', subDomainName: 'Earth' },
  { subjectCode: 'E', subjectName: 'Earth Sciences', domainCode: 'E', domainName: 'Earth Sciences', subDomainCode: 'R', subDomainName: 'Recycling' },
  { subjectCode: 'E', subjectName: 'Earth Sciences', domainCode: 'E', domainName: 'Earth Sciences', subDomainCode: 'S', subDomainName: 'Space' },

  { subjectCode: 'M', subjectName: 'Mathematics', domainCode: 'G', domainName: 'Geometry', subDomainCode: 'B', subDomainName: 'Comparision of Shapes' },
  { subjectCode: 'M', subjectName: 'Mathematics', domainCode: 'G', domainName: 'Geometry', subDomainCode: 'C', subDomainName: 'Coordinate Geometry' },
  { subjectCode: 'M', subjectName: 'Mathematics', domainCode: 'G', domainName: 'Geometry', subDomainCode: 'D', subDomainName: 'Dimensions' },
  { subjectCode: 'M', subjectName: 'Mathematics', domainCode: 'G', domainName: 'Geometry', subDomainCode: 'M', subDomainName: 'Mensuration' },
  { subjectCode: 'M', subjectName: 'Mathematics', domainCode: 'G', domainName: 'Geometry', subDomainCode: 'S', subDomainName: 'Shapes' },
  { subjectCode: 'M', subjectName: 'Mathematics', domainCode: 'G', domainName: 'Geometry', subDomainCode: 'T', subDomainName: 'Trigonometry' },

  { subjectCode: 'M', subjectName: 'Mathematics', domainCode: 'N', domainName: 'Numbers', subDomainCode: 'B', subDomainName: 'Financial Maths' },
  { subjectCode: 'M', subjectName: 'Mathematics', domainCode: 'N', domainName: 'Numbers', subDomainCode: 'F', subDomainName: 'Fractions' },
  { subjectCode: 'M', subjectName: 'Mathematics', domainCode: 'N', domainName: 'Numbers', subDomainCode: 'L', subDomainName: 'Log and Exponents' },
  { subjectCode: 'M', subjectName: 'Mathematics', domainCode: 'N', domainName: 'Numbers', subDomainCode: 'M', subDomainName: 'Measurements' },
  { subjectCode: 'M', subjectName: 'Mathematics', domainCode: 'N', domainName: 'Numbers', subDomainCode: 'N', subDomainName: 'Numbers' },
  { subjectCode: 'M', subjectName: 'Mathematics', domainCode: 'N', domainName: 'Numbers', subDomainCode: 'O', subDomainName: 'Operators' },
  { subjectCode: 'M', subjectName: 'Mathematics', domainCode: 'N', domainName: 'Numbers', subDomainCode: 'P', subDomainName: 'Progressions' },
  { subjectCode: 'M', subjectName: 'Mathematics', domainCode: 'N', domainName: 'Numbers', subDomainCode: 'S', subDomainName: 'Sets' },

  { subjectCode: 'S', subjectName: 'Science', domainCode: 'P', domainName: 'Physics', subDomainCode: 'E', subDomainName: 'Energy' },
  { subjectCode: 'S', subjectName: 'Science', domainCode: 'P', domainName: 'Physics', subDomainCode: 'F', subDomainName: 'Force' },
  { subjectCode: 'S', subjectName: 'Science', domainCode: 'P', domainName: 'Physics', subDomainCode: 'L', subDomainName: 'Light' },
  { subjectCode: 'S', subjectName: 'Science', domainCode: 'P', domainName: 'Physics', subDomainCode: 'M', subDomainName: 'Electricity & Magnetism' },
  { subjectCode: 'S', subjectName: 'Science', domainCode: 'P', domainName: 'Physics', subDomainCode: 'S', subDomainName: 'Sound' },
  { subjectCode: 'S', subjectName: 'Science', domainCode: 'P', domainName: 'Physics', subDomainCode: 'T', subDomainName: 'Motion' },

  { subjectCode: 'M', subjectName: 'Mathematics', domainCode: 'S', domainName: 'Statistics', subDomainCode: 'C', subDomainName: 'Central Tendancy' },
  { subjectCode: 'M', subjectName: 'Mathematics', domainCode: 'S', domainName: 'Statistics', subDomainCode: 'G', subDomainName: 'Graphs' },
  { subjectCode: 'M', subjectName: 'Mathematics', domainCode: 'S', domainName: '', subDomainCode: 'M', subDomainName: 'Motors' },
  { subjectCode: 'M', subjectName: 'Mathematics', domainCode: 'S', domainName: 'Statistics', subDomainCode: 'P', subDomainName: 'Probability' },

  { subjectCode: 'T', subjectName: 'Toys and Tales', domainCode: 'T', domainName: 'Toys and Tales', subDomainCode: 'F', subDomainName: 'Food' },
  { subjectCode: 'T', subjectName: 'Toys and Tales', domainCode: 'T', domainName: 'Toys and Tales', subDomainCode: 'H', subDomainName: 'Health' },
  { subjectCode: 'T', subjectName: 'Toys and Tales', domainCode: 'T', domainName: 'Toys and Tales', subDomainCode: 'R', subDomainName: 'Transport' },

  { subjectCode: 'S', subjectName: 'Science', domainCode: 'Z', domainName: 'Partners', subDomainCode: 'P', subDomainName: 'Physics' }
] as const;

/**
 * Learning unit types — `Configuration/LearningUnitTypes.Types`, ALL THIRTEEN.
 *
 * READ OUT OF PRODUCTION, replacing four provisional entries of which three were
 * wrong. What was here before, and why each was a real bug rather than a rename:
 *
 *   'Tool TAC'  code TT   TT IS 'Toys and Tales'. This was the worst of the three:
 *                         the code was right for a different type, so a unit created
 *                         as a Tool TAC minted a perfectly valid-looking
 *                         'TT-…' id that production reads as Toys and Tales.
 *   'Topic'     code TP   NO SUCH TYPE. TP is not among the thirteen, so any id
 *                         minted from it is unresolvable anywhere else.
 *   'MUT'                 Spelled 'MuT' in production. A display-only difference,
 *                         but the type NAME is what the resource schema is keyed on
 *                         once spaces are stripped, so the casing matters there.
 *   'TACtivity' code TA   The one that was correct.
 *
 * THE CODE IS NOT COSMETIC. It is the first segment of `learningUnitId`
 * ('TA-AE04-EN-V10') and is stored separately as `typeCode`, so a wrong code mints
 * wrong ids for every unit created under it, and those ids are what an export is read
 * by. Nothing in this repo had created a Tool TAC or Topic unit — the learning-unit
 * seed only ever plants TACtivity — so nothing needs migrating.
 *
 * STORED AS A MAP KEYED BY CODE, not an array: `Types.TA = { code, name }`. Held as an
 * array here because that is what a dropdown iterates; configuration.service.ts
 * translates. Order is the map's key order, which is alphabetical by code.
 *
 * FOUR OF THE THIRTEEN HAVE NO RESOURCE SCHEMA — Field Visits, Online Games, Museum
 * Exhibit and TACQuotient are absent from learningUnitResourceSchema, so a unit of
 * those types gets no upload slots at all. That is why the schema has nine type keys
 * and this list has thirteen.
 */
export const LEARNING_UNIT_TYPES: readonly { name: string; code: string }[] = [
  { name: 'CBE Theme', code: 'CB' },
  { name: 'FLN', code: 'FL' },
  { name: 'Field Visits', code: 'FV' },
  { name: 'Online Games', code: 'GA' },
  { name: 'Group Activity', code: 'GR' },
  { name: 'Keep @ Home', code: 'KH' },
  { name: 'Museum Exhibit', code: 'ME' },
  { name: 'Micro Improvement Programme', code: 'MI' },
  { name: 'MuT', code: 'MU' },
  { name: 'ReadyTAC', code: 'RT' },
  { name: 'TACtivity', code: 'TA' },
  { name: 'TACQuotient', code: 'TQ' },
  { name: 'Toys and Tales', code: 'TT' }
] as const;

/**
 * A type name as the resource schema keys it: spaces removed.
 *
 * 'Keep @ Home' -> 'Keep@Home', 'Toys and Tales' -> 'ToysandTales'. The learning unit
 * stores `type` with its spaces; learningUnitResourceSchema is keyed without them, and
 * this is the one place that conversion lives.
 */
export function resourceSchemaKeyOf(typeName: string): string {
  return String(typeName ?? '').replace(/\s+/g, '');
}

/**
 * One entry of `Configuration/learningUnitMaturity.maturity`, field for field.
 *
 * `cumulativeMaturity` IS THE INTERESTING FIELD and the reason this document has
 * to be read rather than assumed. Choosing a maturity does not describe one level,
 * it names a LADDER: gold means gold AND silver. Production expands the chosen
 * level through this array and creates one LearningUnitResources document per
 * entry, so silver creates one document and diamond creates four.
 *
 * The array is stored HIGHEST FIRST — diamond reads
 * ['Diamond', 'Platinum', 'Gold', 'Silver'] — so its LENGTH is the level's rank,
 * which is what orderedMaturities() below sorts on.
 */
export interface MaturityLevel {
  /** Display form, capitalised: 'Silver'. The map key is the lowercase form. */
  level: string;
  /** Only silver is true in production. Everything else is terminal. */
  upgradeable: boolean;
  /** Where this level may be upgraded to, itself included. */
  availableUpgrades: readonly string[];
  /** This level and every level beneath it, HIGHEST FIRST. */
  cumulativeMaturity: readonly string[];
}

/**
 * The four maturities — READ OUT OF PRODUCTION, and the comment that used to sit
 * here was wrong on both counts.
 *
 * It claimed these were 'hardcoded in production's component as defaultMaturities,
 * not read from Configuration'. They are read from Configuration: the document is
 * `Configuration/learningUnitMaturity`, its payload sits under a `maturity` map
 * keyed by the lowercase level name, and it carries the cumulative ladder that the
 * old bare string list could not express at all.
 *
 * IT ALSO HAD THE ORDER WRONG. It listed Gold, Silver, Diamond, Platinum — which is
 * neither the stored key order (alphabetical: diamond, gold, platinum, silver) nor
 * the ladder. The real ordering is by rank, and rank is legible in the data as the
 * length of cumulativeMaturity: silver 1, gold 2, platinum 3, diamond 4. Presenting
 * Gold above Silver in a dropdown implied gold was the lesser of the two.
 *
 * ASCENDING, therefore, so the dropdown reads bottom-of-ladder first.
 */
export const LEARNING_UNIT_MATURITY_LADDER: readonly MaturityLevel[] = [
  {
    level: 'Silver',
    upgradeable: true,
    availableUpgrades: ['Silver', 'Gold'],
    cumulativeMaturity: ['Silver']
  },
  {
    level: 'Gold',
    upgradeable: false,
    availableUpgrades: ['Gold'],
    cumulativeMaturity: ['Gold', 'Silver']
  },
  {
    level: 'Platinum',
    upgradeable: false,
    availableUpgrades: ['Platinum'],
    cumulativeMaturity: ['Platinum', 'Gold', 'Silver']
  },
  {
    level: 'Diamond',
    upgradeable: false,
    availableUpgrades: ['Diamond'],
    cumulativeMaturity: ['Diamond', 'Platinum', 'Gold', 'Silver']
  }
] as const;

/**
 * Just the names, in ladder order. What the Maturity dropdown renders.
 *
 * DERIVED rather than declared, so the list and the ladder cannot fall out of step
 * — which is exactly how the previous hand-written order came to disagree with the
 * data. Every existing consumer of this constant is unchanged apart from the order.
 */
export const LEARNING_UNIT_MATURITIES: readonly string[] =
  LEARNING_UNIT_MATURITY_LADDER.map(entry => entry.level);

/**
 * Sorts maturity entries by rank, lowest first.
 *
 * Rank is the length of cumulativeMaturity, not a stored number — production has no
 * rank field, and the ladder length is the only ordering the data actually carries.
 * A tie keeps the incoming order, which for a Firestore map means alphabetical.
 */
export function orderedMaturities(
  levels: readonly MaturityLevel[]
): MaturityLevel[] {
  return [...levels].sort(
    (a, b) => a.cumulativeMaturity.length - b.cumulativeMaturity.length
  );
}

/**
 * The ladder a chosen maturity expands to, highest first. Empty if unknown.
 *
 * Matched case-insensitively on the level name, because the stored map is keyed in
 * lowercase while a learning unit's own `Maturity` field carries the capitalised
 * form — so 'Gold' from a document has to find the 'gold' entry.
 */
export function cumulativeMaturityFor(
  level: string,
  levels: readonly MaturityLevel[] = LEARNING_UNIT_MATURITY_LADDER
): readonly string[] {
  const wanted = String(level ?? '').trim().toLowerCase();

  return levels.find(entry => entry.level.toLowerCase() === wanted)?.cumulativeMaturity ?? [];
}

/**
 * `Configuration/subjectTypes.subjectTypes` — production's five, verbatim.
 *
 * THE SUBJECT VOCABULARY, and the one place the fifth subject appears. The 44
 * taxonomy rows only ever use four subject codes — M, S, E, T — because Health has
 * no domain/sub-domain pair yet. It is declared here regardless, so a row added for
 * it later has a subject to name.
 *
 * ONE LETTER PER CODE, matching the `subjectCode` the taxonomy rows carry.
 */
export const LEARNING_UNIT_SUBJECT_TYPES: readonly { code: string; name: string }[] = [
  { code: 'M', name: 'Mathematics' },
  { code: 'S', name: 'Science' },
  { code: 'E', name: 'Earth Sciences' },
  { code: 'H', name: 'Health' },
  { code: 'T', name: 'Toys and Tales' }
] as const;

/**
 * `Configuration/subjects.subjectsNames` — a FILTER LIST, not the subject vocabulary.
 *
 * FOUR NAMES, and they do NOT line up with LEARNING_UNIT_SUBJECT_TYPES above:
 *
 *   'Maths'                                not 'Mathematics' — the same subject spelled
 *                                          two ways across two documents
 *   'Foundational Literacy and Numeracy'   has no entry in subjectTypes at all, and no
 *                                          subject code anywhere. It is FLN, which
 *                                          exists as a learning unit TYPE (code FL),
 *                                          not as a subject
 *   'Earth Sciences' and 'Health'          present in subjectTypes, absent here
 *
 * So this is a curated list for a picker somewhere, not a vocabulary to resolve codes
 * against. Kept verbatim and kept SEPARATE for that reason — reconciling the two would
 * be inventing a decision production has not made.
 */
export const LEARNING_UNIT_SUBJECT_NAMES: readonly string[] = [
  'Science',
  'Maths',
  'Foundational Literacy and Numeracy',
  'Toys and Tales'
] as const;

/**
 * `Configuration/subjects.domainCodesToInclude` — which domains a subject view shows.
 *
 * TEN LETTERS, and the interesting part is how they differ from the domain codes the
 * 44 taxonomy rows actually use (A B C E G N P S T Z):
 *
 *   H is INCLUDED but has no rows      — Health, reserved the same way its subject is
 *   Z has rows but is EXCLUDED         — 'Partners', the bucket partner-contributed
 *                                        units land in. A ZP code validates and a ZP
 *                                        unit can exist; it is deliberately kept out
 *                                        of the subject-facing lists
 *
 * ORDER IS PRODUCTION'S, which is alphabetical except that H is appended last rather
 * than sorted into place — so it reads as a later addition. Preserved.
 */
export const LEARNING_UNIT_SUBJECT_DOMAIN_CODES: readonly string[] = [
  'A', 'B', 'C', 'E', 'G', 'N', 'P', 'S', 'T', 'H'
] as const;

/**
 * `Configuration/Maturity.maturity` — the OLDER, flatter maturity document.
 *
 * FOUR NAMES AND NOTHING ELSE. Production carries two maturity documents:
 *
 *   Configuration/Maturity              this — a bare array of names
 *   Configuration/learningUnitMaturity  the ladder, with cumulativeMaturity per level
 *
 * ITS ORDER IS WRONG, and this is very likely where this app's original mistake came
 * from. It reads Silver, Gold, DIAMOND, PLATINUM — Diamond before Platinum — while the
 * ladder in learningUnitMaturity puts Platinum third and Diamond fourth, which is what
 * cumulativeMaturity actually says (Platinum expands to 3 levels, Diamond to 4). The
 * constant this file used to carry had the same inversion.
 *
 * SEEDED FOR FIDELITY, NOT USED FOR ORDERING. LEARNING_UNIT_MATURITY_LADDER remains
 * the only thing the app orders maturities by. Nothing should read this constant except
 * the seed — it exists so the document can be written, and so the discrepancy is
 * recorded somewhere rather than rediscovered.
 */
export const LEGACY_MATURITY_NAMES: readonly string[] = [
  'Silver', 'Gold', 'Diamond', 'Platinum'
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
export function taxonomyFromUnits(
  units: readonly LearningUnit[],
  base: readonly TaxonomyRow[] = LEARNING_UNIT_TAXONOMY
): TaxonomyRow[] {
  const byPair = new Map<string, TaxonomyRow>();

  // `base` DEFAULTS TO THE CONSTANT so every existing caller and test is unchanged,
  // but the learning-unit form passes ConfigurationService.learningUnitDomains()
  // instead — which is the same 44 rows until somebody edits the Firestore document,
  // and that edit is the whole reason the parameter exists. The units still win over
  // whichever base is supplied; see the loop below.
  for (const row of base) {
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

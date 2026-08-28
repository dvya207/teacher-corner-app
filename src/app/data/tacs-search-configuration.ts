/**
 * `Configuration/TACsSearchConfiguration` — the learning-unit search facets.
 *
 * WHAT IT IS. The board / grade / subject / topic dropdowns a search UI offers. It is
 * NOT a second copy of the taxonomy: it is a CURATED subset, and the places it differs
 * from `learningUnitDomains` are choices rather than drift.
 *
 * ------------------------------------------------------------------------
 * THE TERMINOLOGY IS INVERTED FROM EVERY OTHER DOCUMENT. READ THIS FIRST.
 * ------------------------------------------------------------------------
 *   this document        learningUnitDomains        example
 *   SubjectCode          domainCode                 'B'
 *   SubjectName          domainName                 'Biology'
 *   TopicCode            compositeCode              'BA'
 *   TopicName            subdomainName              'Animal'
 *
 * So a "Subject" here is a DOMAIN, and a "Topic" here is a full two-letter composite
 * code. The word "subject" in this file never means what `subjectCode` means anywhere
 * else — `subjectTypes` has five subjects (M, S, E, H, T) and this document's
 * SubjectCodes are domain letters (A, B, C, E, G, N, P).
 *
 * FIELD NAMES ARE PascalCase, alone in this collection. Everything else is camelCase.
 * Preserved, because this seeds a document other readers expect.
 *
 * ------------------------------------------------------------------------
 * KNOWN INCOMPLETE — SubjectDomain INDEX 6 IS MISSING
 * ------------------------------------------------------------------------
 * The source this was transcribed from listed SubjectDomain indices 0,1,2,3,4,5 and 7,
 * with no 6. Firestore arrays are contiguous, so index 6 exists in production and was
 * simply not captured. Cross-referencing the 44 taxonomy rows, the domain codes with
 * rows but no entry here are S (Statistics), T (Toys and Tales) and Z (Partners) — so
 * index 6 is one of those.
 *
 * CONSEQUENCE: the seven entries below are written contiguously, so 'N' / Maths sits at
 * index 6 rather than production's 7. Nothing reads this document yet and the seed is
 * idempotent, so supplying the missing entry and re-running fixes it in one command.
 *
 * Index 5 (G / Geometry) is also uncertain: its TopicDomain was captured as an array
 * with what may have been one empty entry. It is written as an empty array, matching
 * A and N.
 *
 * ------------------------------------------------------------------------
 * DELIBERATE DIVERGENCES FROM learningUnitDomains, verified row by row
 * ------------------------------------------------------------------------
 *   SM under PHYSICS.   'SM' / Motors is listed as a Physics topic, though its
 *                       domainCode is S. This is the same anomaly as SM's EMPTY
 *                       domainName in learningUnitDomains — the pair are one orphan
 *                       recorded two ways, not two separate mistakes.
 *   E is 'Earth'        learningUnitDomains calls it 'Earth Sciences'.
 *   N is 'Maths'        learningUnitDomains calls the N domain 'Numbers'. And
 *                       `subjects.subjectsNames` also says 'Maths' where
 *                       `subjectTypes` says 'Mathematics' — three spellings, three
 *                       documents.
 *   A, G, N EMPTY       All three have taxonomy rows (2, 6 and 8 of them) but no
 *                       topics offered here. Mathematics is searchable by subject and
 *                       not by topic.
 *   ONE BOARD, TWO      BoardDomain holds CBSE alone; GradeDomain holds 5 and 6. The
 *   GRADES              search is scoped far more narrowly than the catalogue.
 *
 * NO IMPORTS IN THIS FILE, deliberately. scripts/seed-configuration.mjs imports it
 * directly rather than parsing it, which Node can only do for a module whose own
 * imports resolve — learning-unit-taxonomy.ts fails that test because it imports
 * ../models/teaching.model without a file extension. Keep this file dependency-free.
 */

export interface TacsSearchTopic {
  TopicCode: string;
  TopicName: string;
}

export interface TacsSearchSubject {
  /** A Storage path, or '' where none is set. Mathematics domains have none. */
  DefaultHeadlineImg: string;
  /** A DOMAIN code, despite the name. One letter. */
  SubjectCode: string;
  SubjectName: string;
  TopicDomain: TacsSearchTopic[];
}

export interface TacsSearchConfiguration {
  BoardDomain: { BoardCode: string; BoardName: string }[];
  GradeDomain: { GradeCode: string; GradeName: string }[];
  SubjectDomain: TacsSearchSubject[];
}

/** The default headline images live under one Storage prefix. */
const IMG = 'learningUnits/default-headline-images/';

export const TACS_SEARCH_CONFIGURATION: TacsSearchConfiguration = {
  BoardDomain: [
    { BoardCode: 'CBSE', BoardName: 'CBSE' }
  ],

  GradeDomain: [
    { GradeCode: '5', GradeName: 'Grade: 5' },
    { GradeCode: '6', GradeName: 'Grade: 6' }
  ],

  SubjectDomain: [
    {
      DefaultHeadlineImg: `${IMG}Biology-01.jpeg`,
      SubjectCode: 'B',
      SubjectName: 'Biology',
      TopicDomain: [
        { TopicCode: 'BA', TopicName: 'Animal' },
        { TopicCode: 'BE', TopicName: 'Ecosystem' },
        { TopicCode: 'BM', TopicName: 'Microbes' },
        { TopicCode: 'BP', TopicName: 'Plant' },
        { TopicCode: 'BO', TopicName: 'Other' }
      ]
    },
    {
      DefaultHeadlineImg: `${IMG}Chemistry-01.jpeg`,
      SubjectCode: 'C',
      SubjectName: 'Chemistry',
      TopicDomain: [
        { TopicCode: 'CC', TopicName: 'Chemical Reactions' },
        { TopicCode: 'CH', TopicName: 'Heat' },
        { TopicCode: 'CM', TopicName: 'Mixtures' },
        { TopicCode: 'CP', TopicName: 'Properties of Matter' },
        { TopicCode: 'CQ', TopicName: 'Measurements' },
        { TopicCode: 'CO', TopicName: 'Others' }
      ]
    },
    {
      DefaultHeadlineImg: `${IMG}Physics-01.jpeg`,
      SubjectCode: 'P',
      SubjectName: 'Physics',
      TopicDomain: [
        { TopicCode: 'PE', TopicName: 'Energy' },
        { TopicCode: 'PF', TopicName: 'Force' },
        { TopicCode: 'PL', TopicName: 'Light' },
        { TopicCode: 'PM', TopicName: 'Electricity & Magnetism' },
        { TopicCode: 'PS', TopicName: 'Sound' },
        { TopicCode: 'PT', TopicName: 'Motion' },
        // Domain code S, not P. See the SM note in this file's header.
        { TopicCode: 'SM', TopicName: 'Motors' }
      ]
    },
    {
      // The filename carries a SPACE and the singular 'Science'. Verbatim.
      DefaultHeadlineImg: `${IMG}Earth Science-01.jpeg`,
      SubjectCode: 'E',
      SubjectName: 'Earth',
      TopicDomain: [
        { TopicCode: 'EE', TopicName: 'Earth' },
        { TopicCode: 'ER', TopicName: 'Recycling' },
        { TopicCode: 'ES', TopicName: 'Space' }
      ]
    },
    {
      DefaultHeadlineImg: '',
      SubjectCode: 'A',
      SubjectName: 'Algebra',
      TopicDomain: []
    },
    {
      DefaultHeadlineImg: '',
      SubjectCode: 'G',
      SubjectName: 'Geometry',
      TopicDomain: []
    },
    // PRODUCTION'S INDEX 7. Index 6 was not captured — see the header. This entry
    // therefore lands at index 6 until the missing one is supplied.
    {
      DefaultHeadlineImg: '',
      SubjectCode: 'N',
      SubjectName: 'Maths',
      TopicDomain: []
    }
  ]
};

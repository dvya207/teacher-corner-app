import { CodedOption } from '../core/configuration';

/**
 * Option vocabularies for workflow templates, seeded with what production's own
 * WorkflowTemplates collection holds.
 *
 * READ OFF 46 DOCUMENTS, 238 STEPS AND 384 CONTENTS rather than guessed, which is
 * what makes these worth pinning: three of the four differ from the nearest thing
 * this app already had.
 */

/**
 * The four maturities, CAPITALISED, in the order production's FORM offers them.
 *
 * NOT the same strings as Configuration/learningUnitMaturity, which keys its
 * ladder by 'silver' / 'gold' / 'platinum' / 'diamond'. A workflow template stores
 * the capitalised form, so reusing the ladder's keys would write documents
 * production's own filters miss.
 *
 * THE ORDER IS NEITHER ALPHABETICAL NOR THE LADDER, and that is production's, not
 * a mistake here: its Maturity select reads Silver, Gold, Diamond, Platinum. Its
 * LIST orders them differently again — see WORKFLOW_MATURITY_COLUMNS — so the two
 * are separate constants rather than one sorted list. Following each surface's own
 * order is what "make the UI as it is" asks for; unifying them would be tidier and
 * would match neither.
 */
export const WORKFLOW_MATURITIES: readonly string[] = Object.freeze([
  'Silver',
  'Gold',
  'Diamond',
  'Platinum'
]);

/**
 * The same four in the order production's LIST shows them, across both the stat
 * cards and the filter pills: Gold, Silver, Platinum, Diamond.
 *
 * A SECOND CONSTANT because production's two surfaces disagree — see above. The
 * cards drop Diamond; the pills do not, which is why the page derives the card set
 * from this rather than the reverse.
 */
export const WORKFLOW_MATURITY_COLUMNS: readonly string[] = Object.freeze([
  'Gold',
  'Silver',
  'Platinum',
  'Diamond'
]);

/**
 * CLASSROOM and STEM-CLUB, exactly as stored.
 *
 * SCREAMING-KEBAB, with the hyphen. The label drops it because 'Stem Club' is
 * what production's dropdown shows, but the stored value keeps it.
 */
export const WORKFLOW_TYPES: readonly CodedOption[] = Object.freeze([
  { code: 'CLASSROOM', label: 'Classroom' },
  { code: 'STEM-CLUB', label: 'Stem Club' }
]);

/**
 * Custom and default, BOTH CREATABLE, and the order is the form's.
 *
 * CUSTOM FIRST, which is not production's order: it is the mode with fewer
 * required fields, so it is the cheaper default for a rail that swaps its fields
 * on this select. Only 4 of production's 46 templates are custom.
 *
 * The two modes are not cosmetic. DEFAULT collects Learning Unit Type, Maturity
 * and Subject and derives the template's name from the three; CUSTOM types a name
 * and stores those three as the empty string, which is what production's own
 * custom documents carry.
 */
export const WORKFLOW_TEMPLATE_MODES: readonly CodedOption[] = Object.freeze([
  { code: 'custom', label: 'Custom' },
  { code: 'default', label: 'Default' }
]);

/**
 * What a content block can point at.
 *
 * THE CODES ARE PRODUCTION'S, AND THEY ARE NOT CONSISTENT: '3S' is upper, 'tacDev'
 * is camel, 'custom resource' has a space. Copied verbatim rather than tidied,
 * because the stored string is what its player matches on.
 *
 * 'custom resource' IS the "Additional Resources" the dropdown offers — the label
 * and the code disagree, which is exactly the sort of thing worth writing down.
 */
export const WORKFLOW_CONTENT_CATEGORIES: readonly CodedOption[] = Object.freeze([
  { code: 'video', label: 'Video' },
  { code: 'tacDev', label: 'Tacdev' },
  { code: '3S', label: '3s' },
  { code: 'graphics', label: 'Graphics' },
  { code: 'tnt', label: 'Toys and Tales' },
  { code: 'additional resources', label: 'Additional Resources' },
  { code: 'assignment', label: 'Assignment' }
]);

/**
 * What CUSTOM mode offers instead: TWO CATEGORIES, and that is the whole list.
 *
 * PRODUCTION'S OWN BEHAVIOUR, and the mechanism is worth recording because it
 * looks accidental and is not. Its `getCategories(type, maturity)` builds the
 * category list by looking up `Configuration/resourceNames` at
 * `resources[<learningUnitType>][<maturity>]` and taking that object's KEYS — the
 * list above is what those keys are. A CUSTOM template stores `learningUnitType`
 * and `maturity` as the EMPTY STRING, so the lookup cannot run, and every one of
 * its early-return branches sets the same two-item fallback:
 *
 *     this.contentCategory = ['custom resource', 'assignment'];
 *
 * So the two-item list is not a special case bolted on for custom mode — it is
 * what the data-driven list degrades to when there is no type or maturity to
 * drive it. Either way it is what a custom template's dropdown shows.
 *
 * 'custom resource' AND 'additional resources' ARE THE SAME IDEA under two names
 * and two fields: default mode writes the second, custom mode the first, and both
 * offer RESOURCE_TYPES. Production's own commented-out lines show it renaming one
 * to the other, which is where the pair came from.
 */
export const CUSTOM_MODE_CONTENT_CATEGORIES: readonly CodedOption[] = Object.freeze([
  { code: 'custom resource', label: 'Custom Resource' },
  { code: 'assignment', label: 'Assignment' }
]);

/**
 * The three kinds of resource a content block can be, for either category.
 *
 * PRODUCTION'S `additionalResType` VERBATIM, codes and names. The codes are what
 * the document stores and they are terse ('LINK'); the names are full sentences
 * because they describe an ACTION the author is about to take, not a file format —
 * 'Paste YouTube Link' rather than 'Link'.
 */
export const RESOURCE_TYPES: readonly CodedOption[] = Object.freeze([
  { code: 'PDF', label: 'Upload a PDF File' },
  { code: 'LINK', label: 'Paste YouTube Link' },
  { code: 'PPT', label: 'Upload PowerPoint Presentation' }
]);

/**
 * The Can Skip Step select: unanswered, then the two answers.
 *
 * YES AND NO, NOT TRUE AND FALSE — THE LABELS ONLY.
 *
 * The CODES are still 'true' and 'false' and the field is still stored as a
 * boolean, which is what production writes and what its player reads. Changing
 * those would write a document neither app understands; changing the labels costs
 * nothing and reads as a question with an answer rather than a value with a type.
 * "Can Skip Step: True" is a developer's phrasing, and this control is a question.
 */
export const SKIP_STEP_OPTIONS: readonly CodedOption[] = Object.freeze([
  { code: 'true', label: 'Yes' },
  { code: 'false', label: 'No' }
]);

/**
 * The sub-category a content block can carry, PER CATEGORY.
 *
 * READ OFF PRODUCTION'S OWN 384 CONTENT BLOCKS rather than invented, which is the
 * only way this list could have been right: the values are internal resource-slot
 * names ('tacQuickVideoUrl', 'conceptPreTestQuizPdf') that no amount of guessing
 * would produce.
 *
 * TWO CATEGORIES HAVE NONE — 'custom resource' and 'assignment' apart from the
 * single value 'assignment' — so the select is hidden for them rather than shown
 * empty. `contentSubCategory` is still written, as the empty string.
 *
 * The labels are the codes. They are jargon, but they are the jargon whoever
 * builds a template already knows, and inventing prose names for them would make
 * the field harder to match against a resource slot rather than easier.
 */
export const CONTENT_SUB_CATEGORIES: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    video: ['tacQuickVideoUrl', 'tacVideoUrl', 'tttVideosUrl'],
    tacDev: [
      'devGuidePdf',
      'guidePdf',
      'inference',
      'interpretationAndEvaluation',
      'materialList',
      'materialListPdf',
      'observationSheetPdf',
      'observationWorksheetPdf',
      'prediction',
      'predictionAndHypothesis',
      'teacherReadinessMcqQuizPdf',
      'toyguideDev',
      'videoUrl'
    ],
    '3S': [
      'conceptPostTestQuizPdf',
      'conceptPreTestQuizPdf',
      'postTestQuestionnaire',
      'preTestQuestionnaire',
      'scamper',
      'tttPpts'
    ],
    graphics: ['materialList', 'tacGuideDiksha', 'tacGuideOnline', 'toyGuideOnline'],

    /*
     * 'assignment' IS DELIBERATELY ABSENT, and it was here before.
     *
     * The value 'assignment' does appear as a stored contentSubCategory on real
     * assignment blocks — which is where it came from — but production never asks
     * for it: its Content Sub Category field is hidden for the assignment
     * category, and its own `checkContentCategory` sets the sub-category from the
     * assignment types it loads rather than from a select. Offering it here put a
     * one-option dropdown under Assignment Type reading 'assignment', which is a
     * question with one answer that production does not ask.
     */

    tnt: [
      'aeroWorksheet',
      'boatWorksheet',
      'instructionsStep1',
      'instructionsStep2',
      'instructionsStep3',
      'instructionsStep4',
      'instructionsStep5',
      'instructionsStep6',
      'literacyWorksheet',
      'loList',
      'numaracyWorksheet',
      'ppWorksheetDev',
      'selWorksheet',
      'storyBoard',
      'talePdf'
    ]
  });

/**
 * The sub-categories for a category, or none.
 *
 * NONE IS A REAL ANSWER, not a gap in the data: the two resource categories and
 * the assignment category all have no sub-category select in production, and the
 * form hides the field on an empty list rather than showing an empty dropdown.
 */
export function contentSubCategoriesFor(category: string): readonly string[] {
  return CONTENT_SUB_CATEGORIES[category] ?? [];
}

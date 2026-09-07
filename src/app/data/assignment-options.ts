import {
  CodedOption,
  ConfiguredAssignmentDefaults,
  ConfiguredAssignmentType,
  ConfiguredFormQuestionType
} from '../core/configuration';

/**
 * Option vocabularies for assignments, seeded with what
 * Configuration/AssignmentTypes actually holds in production.
 *
 * SEEDED WITH THE REAL DOCUMENT, not with a guess, which is what makes the
 * fallback worth having: a refused or missing read costs nothing until somebody
 * edits the document, and the app renders the same options either way. The same
 * pattern every other list in ConfigurationService follows.
 */

/**
 * The five kinds production offers.
 *
 * ALL FIVE ARE HERE, including GAME and TEXTBLOCK, even though this app
 * implements three. That is deliberate: this constant mirrors the document, and
 * the document has five. The RESTRICTION lives in ASSIGNMENT_TYPES in the model,
 * which is what the Create menu, the stat cards and the filter pills read.
 *
 * Keeping the full list here has a use: a row already in the collection with
 * `type: 'GAME'` can be labelled 'Game' in the table rather than shown as a raw
 * SCREAMING_SNAKE string, without that type becoming creatable.
 */
export const ASSIGNMENT_TYPE_OPTIONS: readonly ConfiguredAssignmentType[] = Object.freeze([
  { type: 'QUIZ', displayName: 'Quiz' },
  { type: 'UPLOAD', displayName: 'Upload' },
  { type: 'GAME', displayName: 'Game' },
  { type: 'FORM', displayName: 'Form' },
  { type: 'TEXTBLOCK', displayName: 'Text Block' }
]);

/**
 * The field types a FORM assignment's questions can be.
 *
 * Production's order and spellings verbatim. Two are worth noticing:
 *
 *   'none'  is "Display Only" — a block of text with no input at all, which is
 *           how a form carries instructions between its questions.
 *   'text'  and 'textBox' are different: a single line and a multi-line box.
 *
 * The three dropDown variants are what FormQuestion's three dropDownOptions
 * fields exist for — plain, dynamic and dependent each read a different one.
 *
 * NINE, NOT PRODUCTION'S SEVEN. 'checkBoxGroup' and 'radioGroup' are this app's
 * own additions and are listed last so the first seven stay in production's
 * order. Both author their options as ROWS rather than as a comma separated
 * string, and they differ from each other only in how many may be picked. See
 * the note in scripts/seed-configuration.mjs.
 *
 * `radioGroup` OVERLAPS `dropDown` DELIBERATELY: both pick exactly one option.
 * The difference is that a dropdown collapses its choices behind a tap while a
 * radio group shows all of them, which is what a teacher answering in front of a
 * class needs, and that its options are authored one per row so an option may
 * contain a comma.
 */
export const FORM_QUESTION_TYPES: readonly ConfiguredFormQuestionType[] = Object.freeze([
  { key: 'none', display: 'Display Only' },
  { key: 'text', display: 'Text Field' },
  { key: 'textBox', display: 'Text Box' },
  { key: 'dropDown', display: 'Drop Down' },
  { key: 'starRating', display: 'Star Rating' },
  { key: 'dropDownDynamic', display: 'Drop Down (Dynamic)' },
  { key: 'dropDownDependent', display: 'Drop Down (Dependent)' },
  { key: 'checkBoxGroup', display: 'Checkboxes (Multi-Select)' },
  { key: 'radioGroup', display: 'Radio Buttons (Single-Select)' }
]);

/**
 * What a student may be asked to upload, seeded from
 * Configuration/acceptedUploadFormats.formatNames in production.
 *
 * A LIST HERE, A MAP THERE. The document stores `{ PDF: 'PDF', IMAGE: 'Image', … }`;
 * an object has no guaranteed key order and a select needs one, so the fallback is
 * ordered explicitly and the reader keeps whatever order the document iterates in.
 *
 * THE CODE IS WHAT A SLOT STORES in `uploadFileType` — production's real upload
 * slots carry 'IMAGE' — and the label is what the dropdown shows. Storing the
 * display name instead would write a document production's own player cannot match
 * against its format table.
 */
export const UPLOAD_FILE_TYPES: readonly CodedOption[] = Object.freeze([
  { code: 'PDF', label: 'PDF' },
  { code: 'IMAGE', label: 'Image' },
  { code: 'VIDEO', label: 'Video' },
  { code: 'WORD', label: 'Word Document' },
  { code: 'EXCEL', label: 'Spreadsheet' },
  { code: 'PPT', label: 'Powerpoint Presentation' }
]);

/**
 * The two statuses production's own dialogs offer.
 *
 * Its quiz step declares `statusList = ['LIVE', 'DEVELOPMENT']` verbatim. Note
 * DEVELOPMENT with no misspelling, unlike the programme collection's
 * 'DEVELOPEMENT' — the two are separate vocabularies in production and this
 * matches each where it is used rather than tidying either.
 *
 * IT LIVES HERE, not on a component, because all three wizards read it. It used
 * to be exported from the one-step assignment form, which meant the quiz and
 * upload wizards imported a constant from a component they had nothing else to do
 * with — and when that form was retired the constant would have gone with it.
 */
export const ASSIGNMENT_STATUSES = ['LIVE', 'DEVELOPMENT'] as const;

/**
 * Which STORED status values the badge paints as live, and as closed.
 *
 * NOT THE SAME LIST AS ASSIGNMENT_STATUSES, and that is the point of separating
 * them. The collection holds statuses this app never writes — 'active',
 * 'archived' — because production wrote them, so the badge has to colour values
 * the dropdown does not offer. One merged list would either offer 'archived' for
 * creation or paint a stored 'archived' row as a draft.
 *
 * Lowercase, because the comparison lowercases the stored value first: the
 * collection has 'LIVE', 'Live' and 'live'.
 */
export const LIVE_STATUS_VALUES: readonly string[] = Object.freeze(['active', 'live']);
export const CLOSED_STATUS_VALUES: readonly string[] = Object.freeze(['closed', 'archived']);

/**
 * The scalars a new assignment opens with, and the folder its media goes to.
 *
 * THREE UNRELATED VALUES IN ONE PLACE, which is honest about what they are: each
 * was a literal buried in the model or a service, and they are grouped because
 * they are all "what a new assignment starts as" rather than because they belong
 * to one another.
 *
 * `quizMediaFolder` IS PRODUCTION'S OWN FOLDER and changing it has a consequence
 * worth knowing: production's tooling looks for quiz media under
 * `quizzer_resources/`, so a different value writes files it cannot find.
 */
export const ASSIGNMENT_DEFAULTS: ConfiguredAssignmentDefaults = Object.freeze({
  formInstructions: 'Please answer all the questions in the fields provided below',
  slotMaxUploads: 1,
  quizMediaFolder: 'quizzer_resources'
});

import { TestBed } from '@angular/core/testing';

import {
  ASSIGNMENT_TYPE_OPTIONS,
  FORM_QUESTION_TYPES
} from '../data/assignment-options';

import { GRADES, SECTIONS } from '../data/classroom-options';
import { BOARDS } from '../data/institution-options';
import {
  CONFIGURATION_READER,
  ConfigurationDocuments,
  ConfigurationService
} from './configuration.service';

/**
 * The Configuration collection.
 *
 * TWO PROPERTIES MATTER and both are asserted here:
 *
 *   1. what Firestore holds is what the UI shows — otherwise editing a document in the
 *      console does nothing and the whole exercise is decoration;
 *   2. what the app shipped with is what it falls back to — a refused read, a missing
 *      document or an empty array must never leave a form with an empty select.
 *
 * The read is supplied through CONFIGURATION_READER rather than mocked. Angular's
 * vitest setup rejects vi.mock on relative imports, and mocking 'firebase/firestore'
 * globally breaks every other spec that touches Firestore.
 */

describe('ConfigurationService', () => {
  let documents: ConfigurationDocuments;
  let shouldThrow: boolean;
  let service: ConfigurationService;

  beforeEach(() => {
    documents = new Map();
    shouldThrow = false;

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CONFIGURATION_READER,
          useValue: async () => {
            if (shouldThrow) {
              throw new Error('permission-denied');
            }
            return documents;
          }
        }
      ]
    });

    service = TestBed.inject(ConfigurationService);
  });

  /* ---- Fallbacks ---------------------------------------------------------- */

  it('starts holding the values the app shipped with', () => {
    expect(service.boards()).toEqual(BOARDS);
    expect(service.grades()).toEqual(GRADES);
    expect(service.sections()).toEqual(SECTIONS);
  });

  it('keeps the fallback when the collection is empty', async () => {
    await service.load();

    expect(service.grades()).toEqual(GRADES);
  });

  /** A denied read must degrade to the shipped behaviour, not to empty selects. */
  it('keeps the fallback when the read fails', async () => {
    shouldThrow = true;

    await service.load();

    expect(service.boards()).toEqual(BOARDS);
    expect(service.grades()).toEqual(GRADES);
  });

  /* ---- Firestore wins ----------------------------------------------------- */

  it('shows what Firestore holds, so a console edit reaches the UI', async () => {
    documents.set('GradeList', { docId: 'GradeList', grades: ['11', '12'] });
    documents.set('SectionList', { docId: 'SectionList', sections: ['X', 'Y'] });

    await service.load();

    expect(service.grades()).toEqual(['11', '12']);
    expect(service.sections()).toEqual(['X', 'Y']);
  });

  it('reads each list from the document id and key the contract names', async () => {
    documents.set('BoardListAll', { boards: [{ code: 'NEW', label: 'A new board' }] });
    documents.set('Languages', { langTypes: [{ code: 'FR', label: 'French' }] });
    documents.set('typeofSchools', { typeofSchools: [{ value: 'Charter', short: 'Chr' }] });
    documents.set('ProgrammeAges', { ages: ['1', '2'] });
    documents.set('SchoolGenderTypes', { genderTypes: ['Mixed'] });

    await service.load();

    expect(service.boards()).toEqual([{ code: 'NEW', label: 'A new board' }]);
    expect(service.languages()).toEqual([{ code: 'FR', label: 'French' }]);
    expect(service.schoolTypes()).toEqual([{ value: 'Charter', short: 'Chr' }]);
    expect(service.programmeAges()).toEqual(['1', '2']);
    expect(service.genderTypes()).toEqual(['Mixed']);
  });

  it('derives country names and dial codes from CountryCodes', async () => {
    documents.set('CountryCodes', {
      countryCodes: [
        { iso2: 'IN', name: 'India', dial: '+91' },
        { iso2: 'NP', name: 'Nepal', dial: '+977' }
      ]
    });

    await service.load();

    expect(service.countryNamesSignal()).toEqual(['India', 'Nepal']);
    expect(service.dialFor('Nepal')).toBe('+977');
  });

  /**
   * An empty array is far more likely to be somebody having deleted the values than a
   * genuinely empty vocabulary, and applying it blanks a dropdown for every user.
   */
  it('ignores an empty array rather than blanking a dropdown', async () => {
    documents.set('GradeList', { grades: [] });

    await service.load();

    expect(service.grades()).toEqual(GRADES);
  });

  it('only loads once, however many times it is called', async () => {
    documents.set('GradeList', { grades: ['11'] });
    await service.load();

    documents.set('GradeList', { grades: ['12'] });
    await service.load();

    expect(service.grades()).toEqual(['11']);
  });

  /* ---- Behaviour that used to be hardcoded -------------------------------- */

  it('validates a pincode from the rules rather than an if on India', () => {
    expect(service.isCompletePincode('560001', 'India')).toBe(true);
    expect(service.isCompletePincode('56000', 'India')).toBe(false);
    // A leading zero is rejected by the seeded pattern.
    expect(service.isCompletePincode('060001', 'India')).toBe(false);
    // A country with no rule takes anything non-empty, as the old else-branch did.
    expect(service.isCompletePincode('AB1 2CD', 'Nepal')).toBe(true);
    expect(service.isCompletePincode('', 'Nepal')).toBe(false);
  });

  it('takes a new country rule from Firestore', async () => {
    documents.set('PincodeRules', {
      rules: [
        { country: 'India', pattern: '^[1-9][0-9]{5}$', digits: 6 },
        { country: 'Nepal', pattern: '^[0-9]{5}$', digits: 5 }
      ]
    });

    await service.load();

    expect(service.isCompletePincode('44600', 'Nepal')).toBe(true);
    expect(service.isCompletePincode('4460', 'Nepal')).toBe(false);
    expect(service.pincodeDigits('44600123', 'Nepal')).toBe('44600');
  });

  /** A malformed pattern must not make every pincode invalid. */
  it('survives an invalid pattern in Firestore', async () => {
    documents.set('PincodeRules', { rules: [{ country: 'India', pattern: '([', digits: 6 }] });

    await service.load();

    expect(service.isCompletePincode('560001', 'India')).toBe(true);
  });

  it('resolves a dial code, falling back to the default country', () => {
    expect(service.dialFor('India')).toBe('+91');
    expect(service.dialFor('Nowhere')).toBe('+91');
  });

  /* ======================================================================
     The learning unit form's dropdowns.
     ======================================================================
     Every select in the Add-a-Learning-Unit dialog reads one of these. The two
     properties asserted at the top of this file are asserted for each: Firestore
     wins, and the shipped constant holds when the read gives nothing. */

  describe('learning unit vocabularies', () => {

    it('take the type list from Firestore, keyed by code', async () => {
      documents.set('LearningUnitTypes', {
        Types: {
          ZZ: { code: 'ZZ', name: 'Experiment' },
          TA: { code: 'TA', name: 'TACtivity' }
        }
      });

      await service.load();

      // Sorted by code, so the dropdown order does not follow map iteration.
      expect(service.learningUnitTypes().map(t => t.code)).toEqual(['TA', 'ZZ']);
    });

    /** The map key stands in for a missing code field. */
    it('fall back to the map key when a type has no code', async () => {
      documents.set('LearningUnitTypes', { Types: { QQ: { name: 'Keyed only' } } });

      await service.load();

      expect(service.learningUnitTypes()).toEqual([{ code: 'QQ', name: 'Keyed only' }]);
    });

    /** A nameless type would render as a blank option that still mints a typeCode. */
    it('drop a type with no name', async () => {
      documents.set('LearningUnitTypes', {
        Types: { AA: { code: 'AA' }, BB: { code: 'BB', name: 'Real' } }
      });

      await service.load();

      expect(service.learningUnitTypes()).toEqual([{ code: 'BB', name: 'Real' }]);
    });

    it('keep all thirteen shipped types when the document is missing', async () => {
      await service.load();

      expect(service.learningUnitTypes()).toHaveLength(13);
      expect(service.learningUnitTypes().map(t => t.code)).toContain('TT');
    });

    it('take the language list from Firestore', async () => {
      documents.set('LearningUnitLanguages', {
        langTypes: [{ code: 'BN', label: 'Bengali' }]
      });

      await service.load();

      expect(service.learningUnitLanguages()).toEqual([{ code: 'BN', label: 'Bengali' }]);
    });

    /**
     * THE REASON THIS IS A SEPARATE DOCUMENT.
     *
     * Configuration/Languages is a school's medium of instruction and carries OT
     * 'Other'. A learning unit's isoCode becomes a segment of its learningUnitId, so OT
     * would mint 'TA-AE04-OT-V10'. The two lists must not be wired to one document.
     */
    it('keep the school medium list out of the learning unit languages', async () => {
      documents.set('Languages', {
        langTypes: [{ code: 'EN', label: 'English' }, { code: 'OT', label: 'Other' }]
      });

      await service.load();

      expect(service.languages().map(l => l.code)).toContain('OT');
      expect(service.learningUnitLanguages().map(l => l.code)).not.toContain('OT');
      expect(service.learningUnitLanguages()).toHaveLength(6);
    });

    it('take the difficulty levels from Firestore', async () => {
      documents.set('LearningUnitDifficulty', { levels: ['1', '2', '3'] });

      await service.load();

      expect(service.learningUnitDifficulty()).toEqual(['1', '2', '3']);
    });

    it('keep the shipped difficulty levels when the document is empty', async () => {
      documents.set('LearningUnitDifficulty', { levels: [] });

      await service.load();

      // SIX, starting at 0: production's units carry difficultyLevel 0.
      expect(service.learningUnitDifficulty()).toEqual(['0', '1', '2', '3', '4', '5']);
    });

    it('take the taxonomy from Firestore, translating subdomainName', async () => {
      documents.set('learningUnitDomains', {
        domains: [{
          subjectCode: 'M', subjectName: 'Mathematics',
          domainCode: 'Q', domainName: 'Quaternions',
          subDomainCode: 'X', subdomainName: 'Rotations'
        }]
      });

      await service.load();

      expect(service.learningUnitDomains()).toEqual([{
        subjectCode: 'M', subjectName: 'Mathematics',
        domainCode: 'Q', domainName: 'Quaternions',
        subDomainCode: 'X', subDomainName: 'Rotations'
      }]);
    });

    /** A hand edit that used this app's spelling still works. */
    it('accept either spelling of the sub-domain name', async () => {
      documents.set('learningUnitDomains', {
        domains: [{ domainCode: 'Q', subDomainCode: 'X', subDomainName: 'CamelCased' }]
      });

      await service.load();

      expect(service.learningUnitDomains()[0].subDomainName).toBe('CamelCased');
    });

    /** A row with no letter pair can never match a code; it would only pad the lists. */
    it('drop a taxonomy row with no letter pair', async () => {
      documents.set('learningUnitDomains', {
        domains: [
          { domainCode: 'Q', subDomainName: 'No sub-domain code' },
          { domainCode: 'Q', subDomainCode: 'X', subdomainName: 'Kept' }
        ]
      });

      await service.load();

      expect(service.learningUnitDomains()).toHaveLength(1);
      expect(service.learningUnitDomains()[0].subDomainName).toBe('Kept');
    });

    it('keep all 44 shipped taxonomy rows when the document is missing', async () => {
      await service.load();

      expect(service.learningUnitDomains()).toHaveLength(44);
    });

    it('take the maturity ladder from Firestore, in rank order', async () => {
      documents.set('learningUnitMaturity', {
        maturity: {
          platinum: { level: 'Platinum', cumulativeMaturity: ['Platinum', 'Gold', 'Silver'] },
          silver: { level: 'Silver', cumulativeMaturity: ['Silver'], upgradeable: true },
          gold: { level: 'Gold', cumulativeMaturity: ['Gold', 'Silver'] }
        }
      });

      await service.load();

      expect(service.learningUnitMaturities().map(m => m.level))
        .toEqual(['Silver', 'Gold', 'Platinum']);
    });

    /** cumulativeMaturity is what the document is for; without it a level is useless. */
    it('drop a maturity with no cumulative ladder', async () => {
      documents.set('learningUnitMaturity', {
        maturity: {
          gold: { level: 'Gold', cumulativeMaturity: ['Gold', 'Silver'] },
          bronze: { level: 'Bronze' }
        }
      });

      await service.load();

      expect(service.learningUnitMaturities().map(m => m.level)).toEqual(['Gold']);
    });

    /**
     * A REFUSED READ LEAVES EVERY DROPDOWN POPULATED.
     *
     * This is the property the whole fallback design exists for: moving these lists
     * into Firestore must not be able to empty a select.
     */
    it('survive a refused read with every list intact', async () => {
      shouldThrow = true;

      await service.load();

      expect(service.learningUnitTypes()).toHaveLength(13);
      expect(service.learningUnitLanguages()).toHaveLength(6);
      expect(service.learningUnitDifficulty()).toHaveLength(6);
      expect(service.learningUnitDomains()).toHaveLength(44);
      expect(service.learningUnitMaturities()).toHaveLength(4);
      expect(service.programmeStatuses()).toHaveLength(2);
    });
  });

  /* ---- Workflow templates --------------------------------------------------
     THE ONE READER WHOSE DOCUMENT IS PRODUCTION'S OWN and whose row shape
     DISAGREES with this app's. Configuration/WorkflowTypes holds
     `{ code, displayName }`; a CodedOption is `{ code, label }`. That mismatch is
     the whole reason applyWorkflowTypes exists rather than a line of applyList,
     and a future tidy-up that "simplifies" it back would set every label to
     undefined and render blank options rather than failing. */

  describe('workflow types', () => {

    it('starts on the shipped two', () => {
      expect(service.workflowTypes().map(entry => entry.code))
        .toEqual(['CLASSROOM', 'STEM-CLUB']);
    });

    /** displayName -> label. The point of the reader. */
    it('translate the document\'s displayName into a label', async () => {
      documents.set('WorkflowTypes', {
        workflowTypes: [
          { code: 'CLASSROOM', displayName: 'Classroom Workflow' },
          { code: 'STEM-CLUB', displayName: 'STEM Club Workflow' }
        ]
      });

      await service.load();

      expect(service.workflowTypes()).toEqual([
        { code: 'CLASSROOM', label: 'Classroom Workflow' },
        { code: 'STEM-CLUB', label: 'STEM Club Workflow' }
      ]);
    });

    /** A NEW TYPE IS PICKED UP, which is what putting the list in a document buys. */
    it('take a third type from the document', async () => {
      documents.set('WorkflowTypes', {
        workflowTypes: [
          { code: 'CLASSROOM', displayName: 'Classroom' },
          { code: 'STEM-CLUB', displayName: 'Stem Club' },
          { code: 'HOME-LAB', displayName: 'Home Lab' }
        ]
      });

      await service.load();

      expect(service.workflowTypes().map(entry => entry.code))
        .toEqual(['CLASSROOM', 'STEM-CLUB', 'HOME-LAB']);
    });

    /**
     * A ROW WITH NO CODE IS DROPPED. The code is what gets stored on the template,
     * so a row missing it can only add a blank option that writes an empty `type`.
     */
    it('drop a row with no code', async () => {
      documents.set('WorkflowTypes', {
        workflowTypes: [
          { code: 'CLASSROOM', displayName: 'Classroom' },
          { displayName: 'Nameless' },
          { code: '', displayName: 'Blank' }
        ]
      });

      await service.load();

      expect(service.workflowTypes()).toEqual([
        { code: 'CLASSROOM', label: 'Classroom' }
      ]);
    });

    /** A ROW WITH NO displayName KEEPS ITS CODE — ugly beats blank. */
    it('fall back to the code when a row has no displayName', async () => {
      documents.set('WorkflowTypes', {
        workflowTypes: [{ code: 'STEM-CLUB' }]
      });

      await service.load();

      expect(service.workflowTypes()).toEqual([
        { code: 'STEM-CLUB', label: 'STEM-CLUB' }
      ]);
    });

    /** A MALFORMED DOCUMENT MUST NOT EMPTY THE SELECT. */
    it('keep the shipped two when every row is unusable', async () => {
      documents.set('WorkflowTypes', { workflowTypes: [{ displayName: 'No code' }] });

      await service.load();

      expect(service.workflowTypes()).toHaveLength(2);
    });

    it('keep the shipped two when the key is not an array', async () => {
      documents.set('WorkflowTypes', { workflowTypes: 'CLASSROOM' });

      await service.load();

      expect(service.workflowTypes()).toHaveLength(2);
    });

    it('survive a refused read', async () => {
      shouldThrow = true;

      await service.load();

      expect(service.workflowTypes()).toHaveLength(2);
    });
  });

  /* ---- Assignments ---------------------------------------------------------
     TWO LISTS IN ONE DOCUMENT, which is the shape production keeps them in:
     Configuration/AssignmentTypes carries `assignmentsTypes` and
     `questionTypesForm` side by side. That is why the two entries in
     CONFIGURATION_DOCS share an id, and it is the thing a refactor would most
     easily break — splitting them into two documents would leave one list
     silently on its fallback. */

  describe('assignment vocabularies', () => {

    it('starts on the shipped lists', () => {
      expect(service.assignmentTypes()).toEqual(ASSIGNMENT_TYPE_OPTIONS);
      expect(service.formQuestionTypes()).toEqual(FORM_QUESTION_TYPES);
    });

    /** All FIVE, including the two this app does not create. The restriction is
     *  ASSIGNMENT_TYPES in the model, not this list. */
    it('ships all five kinds production offers', () => {
      expect(ASSIGNMENT_TYPE_OPTIONS.map(entry => entry.type))
        .toEqual(['QUIZ', 'UPLOAD', 'GAME', 'FORM', 'TEXTBLOCK']);
    });

    it('ships the form field types in production\'s order', () => {
      expect(FORM_QUESTION_TYPES.map(entry => entry.key)).toEqual([
        'none', 'text', 'textBox', 'dropDown',
        'starRating', 'dropDownDynamic', 'dropDownDependent'
      ]);
    });

    /** The keys are lowerCamel where a quiz question's type is SCREAMING_SNAKE.
     *  Two different vocabularies, neither normalised. */
    it('keeps the form keys lowerCamel', () => {
      expect(FORM_QUESTION_TYPES.every(entry => !entry.key.includes('_'))).toBe(true);
      expect(FORM_QUESTION_TYPES.find(entry => entry.key === 'textBox')?.display)
        .toBe('Text Box');
    });

    /* ---- The four lists production hardcodes ----------------------------- */

    it('starts on the shipped values for the four production hardcodes', () => {
      expect(service.assignmentStatuses()).toEqual(['LIVE', 'DEVELOPMENT']);
      expect(service.quizPedagogyTypes()).toEqual(['FA', 'SA']);
      expect(service.quizAuthTypes()).toEqual(['login', 'anonymous']);
      expect(service.quizQuestionTypes().map(entry => entry.type)).toEqual([
        'MCQ', 'FILL_IN_THE_BLANKS', 'TEXT', 'RICH_BLANKS', 'DESCRIPTIVE'
      ]);
    });

    it('reads the status list and both colouring lists', async () => {
      documents.set('AssignmentStatuses', {
        statuses: ['LIVE', 'DEVELOPMENT', 'REVIEW'],
        liveValues: ['live', 'active', 'open'],
        closedValues: ['closed']
      });

      await service.load();

      expect(service.assignmentStatuses()).toEqual(['LIVE', 'DEVELOPMENT', 'REVIEW']);
      expect(service.liveStatusValues()).toEqual(['live', 'active', 'open']);
      expect(service.closedStatusValues()).toEqual(['closed']);
    });

    /**
     * THE ICON COMES BACK FROM CODE. The document carries type and label only,
     * because an icon names an SVG the icon component knows — a configured value
     * would render as nothing if it did not happen to match.
     */
    it('merges the configured quiz label with the icon the code holds', async () => {
      documents.set('AssignmentTypes', {
        questionTypesQuiz: [
          { type: 'DESCRIPTIVE', label: 'Descriptive' },
          { type: 'MCQ', label: 'Multiple Choice' }
        ]
      });

      await service.load();

      expect(service.quizQuestionTypes()).toEqual([
        { type: 'DESCRIPTIVE', label: 'Descriptive', icon: 'edit' },
        { type: 'MCQ', label: 'Multiple Choice', icon: 'list' }
      ]);
    });

    /** A type the code has never seen gets a generic icon, not a blank space. */
    it('gives an unknown quiz type a fallback icon', async () => {
      documents.set('AssignmentTypes', {
        questionTypesQuiz: [{ type: 'MATCH_THE_PAIRS', label: 'Match the Pairs' }]
      });

      await service.load();

      expect(service.quizQuestionTypes()[0].icon).toBe('list');
    });

    /**
     * THE ONE CONFIGURED VALUE NOT TAKEN AT ITS WORD.
     *
     * `creatableTypes` is a policy, not a vocabulary: adding TEXTBLOCK does not
     * bring a text-block editor into being, so the document may NARROW the three
     * the app implements and never widen them. Trusting it would put an entry in
     * the Create menu that opens nothing.
     */
    it('lets the document narrow the creatable types', async () => {
      documents.set('AssignmentTypes', { creatableTypes: ['QUIZ', 'FORM'] });

      await service.load();

      expect(service.creatableAssignmentTypes()).toEqual(['QUIZ', 'FORM']);
    });

    it('refuses to widen the creatable types past what has an editor', async () => {
      documents.set('AssignmentTypes', {
        creatableTypes: ['QUIZ', 'UPLOAD', 'FORM', 'TEXTBLOCK', 'GAME']
      });

      await service.load();

      expect(service.creatableAssignmentTypes()).toEqual(['QUIZ', 'UPLOAD', 'FORM']);
    });

    it('keeps the shipped set when the document names nothing implemented', async () => {
      documents.set('AssignmentTypes', { creatableTypes: ['GAME', 'TEXTBLOCK'] });

      await service.load();

      expect(service.creatableAssignmentTypes()).toEqual(['QUIZ', 'UPLOAD', 'FORM']);
    });

    /* ---- The upload size caps ------------------------------------------- */

    it('starts on the shipped caps', () => {
      expect(service.uploadSizeCaps()).toEqual({ VIDEO: 200, IMAGE: 20 });
      expect(service.uploadSizeCapDefault()).toBe(40);
    });

    /** DEFAULT is pulled out of the map: it is not an upload type. */
    it('reads the caps and lifts DEFAULT out of the map', async () => {
      documents.set('acceptedUploadFormats', {
        sizeCaps: { VIDEO: 500, IMAGE: 25, PDF: 15, DEFAULT: 60 }
      });

      await service.load();

      expect(service.uploadSizeCaps()).toEqual({ VIDEO: 500, IMAGE: 25, PDF: 15 });
      expect(service.uploadSizeCapDefault()).toBe(60);
    });

    /** A cap of 0 refuses every file and NaN compares false against everything. */
    it('drops a cap that is not a positive number', async () => {
      documents.set('acceptedUploadFormats', {
        sizeCaps: { VIDEO: 0, IMAGE: 'big', PDF: -5, WORD: 30 }
      });

      await service.load();

      expect(service.uploadSizeCaps()).toEqual({ WORD: 30 });
    });

    it('uppercases the cap keys, so a lowercase document still matches', async () => {
      documents.set('acceptedUploadFormats', { sizeCaps: { video: 120 } });

      await service.load();

      expect(service.uploadSizeCaps()).toEqual({ VIDEO: 120 });
    });

    /* ---- The defaults --------------------------------------------------- */

    it('starts on the shipped defaults', () => {
      expect(service.assignmentDefaults()).toEqual({
        formInstructions: 'Please answer all the questions in the fields provided below',
        slotMaxUploads: 1,
        quizMediaFolder: 'quizzer_resources'
      });
    });

    /**
     * FIELD BY FIELD. A document setting only one must leave the others alone —
     * a partial document is the normal way somebody edits one, and `set(value)`
     * would blank the rest.
     */
    it('takes only the default fields the document sets', async () => {
      documents.set('AssignmentDefaults', {
        defaults: { formInstructions: 'Answer every question below.' }
      });

      await service.load();

      expect(service.assignmentDefaults().formInstructions)
        .toBe('Answer every question below.');
      expect(service.assignmentDefaults().slotMaxUploads).toBe(1);
      expect(service.assignmentDefaults().quizMediaFolder).toBe('quizzer_resources');
    });

    it('ignores a default of the wrong type', async () => {
      documents.set('AssignmentDefaults', {
        defaults: { formInstructions: 42, slotMaxUploads: 'three', quizMediaFolder: '' }
      });

      await service.load();

      expect(service.assignmentDefaults()).toEqual({
        formInstructions: 'Please answer all the questions in the fields provided below',
        slotMaxUploads: 1,
        quizMediaFolder: 'quizzer_resources'
      });
    });

    /** Every new reader must survive a refused read with its fallback intact. */
    it('keeps every assignment fallback when the read is refused', async () => {
      shouldThrow = true;

      await service.load();

      expect(service.assignmentStatuses()).toEqual(['LIVE', 'DEVELOPMENT']);
      expect(service.creatableAssignmentTypes()).toEqual(['QUIZ', 'UPLOAD', 'FORM']);
      expect(service.uploadSizeCapDefault()).toBe(40);
      expect(service.assignmentDefaults().slotMaxUploads).toBe(1);
      expect(service.quizQuestionTypes().length).toBe(5);
    });

    it('reads both lists out of the one document', async () => {
      documents.set('AssignmentTypes', {
        assignmentsTypes: [{ type: 'QUIZ', displayName: 'Quizzer' }],
        questionTypesForm: [{ key: 'text', display: 'One Line' }]
      });

      await service.load();

      expect(service.assignmentTypes()).toEqual([{ type: 'QUIZ', displayName: 'Quizzer' }]);
      expect(service.formQuestionTypes()).toEqual([{ key: 'text', display: 'One Line' }]);
    });

    /** One key present and the other absent must not blank the absent one. */
    it('keeps the fallback for whichever key is missing', async () => {
      documents.set('AssignmentTypes', {
        assignmentsTypes: [{ type: 'FORM', displayName: 'Form' }]
      });

      await service.load();

      expect(service.assignmentTypes().length).toBe(1);
      expect(service.formQuestionTypes()).toEqual(FORM_QUESTION_TYPES);
    });
  });
});

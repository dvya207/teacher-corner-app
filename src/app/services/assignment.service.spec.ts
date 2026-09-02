import {
  emptyFormPayload,
  emptyQuizPayload,
  emptyUploadPayload
} from '../models/teaching.model';
import { ASSIGNMENT_RESERVED_DOCS } from '../core/firestore-paths';
import {
  normaliseAssignment,
  stripTrashMetadata,
  stripUndefined
} from './assignment.service';
import { FormAssignment, QuizAssignment, UploadAssignment } from '../models/teaching.model';

/**
 * These guard the boundary with ThinkTac production's Assignments collection.
 *
 * The shape was read from thinktac-india-production itself — the
 * Assignments/--schema-- document plus one real row of each type — and TWO
 * disagreements between the schema document and the live data are pinned below,
 * because both are the kind of thing that silently produces a document
 * production cannot read:
 *
 *   1. --schema-- names the quiz's question array `questionsSchema`. Every real
 *      quiz stores `questionsData`.
 *   2. A FORM stores `questions`, not `questionsData`. The two types use
 *      different keys for the same idea.
 *
 * The third trap is case: a quiz question's `questionType` is uppercase ('MCQ'),
 * a form question's is lowercase ('text').
 */

/**
 * THE FOUR DOCUMENTS IN Assignments THAT ARE NOT ASSIGNMENTS.
 *
 * Production's collection holds them beside the real rows, and this app's database
 * now mirrors three of them so the reference travels with the data. They are
 * harmless in the table for a structural reason worth pinning: `ownedAssignments`
 * queries `where('ownerId','==',uid)` and none of them has an `ownerId` field at
 * all, so Firestore excludes them from the query outright rather than this app
 * filtering them afterwards. Verified in the running app: three real rows, no
 * mention of any sentinel id.
 *
 * What they DO need is protection from being written over, which is what the
 * firestore.rules create exclusion gives them.
 */
describe('the reserved Assignments ids', () => {

  it('names all four, not only the trash', () => {
    expect([...ASSIGNMENT_RESERVED_DOCS]).toEqual([
      '--trash--',
      '--schema--',
      '---quizzer_schema---',
      '--default_assignments--'
    ]);
  });

  /**
   * THREE DASHES ON ONE OF THEM. Not a typo to tidy: the id is what a read looks
   * up, so a "corrected" spelling addresses a document that does not exist.
   */
  it('keeps the three-dash spelling of the quizzer schema', () => {
    expect(ASSIGNMENT_RESERVED_DOCS).toContain('---quizzer_schema---');
    expect(ASSIGNMENT_RESERVED_DOCS).not.toContain('--quizzer_schema--');
  });

  /**
   * THE SCHEMA DOCUMENTS ARE REFERENCE, NOT A SHAPE THIS APP ADOPTS.
   *
   * `--schema--` and `---quizzer_schema---` name a quiz's question array
   * `questionsSchema` and carry `name` and `type` on every question. Across 174
   * questions in 37 real production quizzes those three appear ZERO times — the
   * live documents use `questionsData` and neither extra field. Pinned because the
   * schema document is the more official-looking of the two sources and the wrong
   * one to follow.
   */
  it('does not adopt the schema documents\' own field names', () => {
    const question = normaliseAssignment('a1', {
      type: 'QUIZ',
      questionsData: [{ questionTitle: 'Q1', questionType: 'MCQ' }]
    }) as unknown as Record<string, unknown>;

    expect('questionsData' in question).toBe(true);
    expect('questionsSchema' in question).toBe(false);

    const first = (question['questionsData'] as Record<string, unknown>[])[0];
    expect('name' in first).toBe(false);
    expect('type' in first).toBe(false);
  });
});

describe('normaliseAssignment', () => {

  /**
   * Production writes only what a dialog collected. The `--default_assignments--`
   * row really does carry four keys and no status at all, so reading one straight
   * into the interface leaves undefined on every omitted field — which the type
   * system cannot see and which Firestore rejects on the way back in.
   */
  it('fills the fields a sparse production document does not carry', () => {
    const result = normaliseAssignment<UploadAssignment>('a1', {
      type: 'UPLOAD',
      displayName: 'Upload Assignment',
      assignments: []
    });

    expect(result.status).toBe('');
    expect(result.creator).toBe('');
    expect(result.author).toBe('');
    expect(result.ownerId).toBe('');
    expect(result.createdAt).toBeNull();
    expect(result.updatedAt).toBeNull();
    // The upload's own payload defaults, not a quiz's.
    expect(result.duration).toBe('');
    expect(result.numberOfAllowedSubmissions).toBe(1);
  });

  /** A stored value always wins over the default. */
  it('does not overwrite what the document already holds', () => {
    const result = normaliseAssignment<QuizAssignment>('a1', {
      type: 'QUIZ',
      numberOfAllowedSubmissions: 3,
      authenticationType: 'anonymous',
      questionsData: [{ questionTitle: 'Q1' }]
    });

    expect(result.numberOfAllowedSubmissions).toBe(3);
    expect(result.authenticationType).toBe('anonymous');
    expect(result.questionsData.length).toBe(1);
  });

  /** Production's own table uppercases before comparing, which is the tell that
   *  mixed-case values exist in the data. */
  it('uppercases the type', () => {
    expect(normaliseAssignment('a1', { type: 'quiz' }).type).toBe('QUIZ');
    expect(normaliseAssignment('a1', { type: 'Form' }).type).toBe('FORM');
  });

  it('defaults docId to the path when the field is missing', () => {
    expect(normaliseAssignment('path-id', { type: 'FORM' }).docId).toBe('path-id');
  });

  /**
   * A KEY THIS APP DOES NOT MODEL IS PRESERVED. A quiz carries `backgroundInfo`
   * with images and HTML; a document could carry anything else besides. Dropping
   * an unmodelled key on read would delete it on the next save.
   */
  it('keeps fields the interface does not declare', () => {
    const result = normaliseAssignment('a1', {
      type: 'QUIZ',
      somethingProductionAdded: { nested: true }
    }) as unknown as Record<string, unknown>;

    expect(result['somethingProductionAdded']).toEqual({ nested: true });
  });

  /**
   * AN UNKNOWN TYPE GETS NO PAYLOAD. A CASE_STUDY written by production must keep
   * its base fields — so it counts and renders — without being dressed up as one
   * of the three this app implements.
   */
  it('gives a foreign type its base fields and no payload', () => {
    const result = normaliseAssignment('a1', {
      type: 'CASE_STUDY',
      displayName: 'A case study'
    }) as unknown as Record<string, unknown>;

    expect(result['displayName']).toBe('A case study');
    expect(result['questionsData']).toBeUndefined();
    expect(result['questions']).toBeUndefined();
    expect(result['assignments']).toBeUndefined();
  });
});

describe('the per-type payload defaults', () => {

  /**
   * THE TWO KEY NAMES, pinned. A quiz's array is `questionsData` and a form's is
   * `questions`; swapping them writes a document production reads as having no
   * content at all.
   */
  it('gives a quiz questionsData and a form questions', () => {
    expect('questionsData' in emptyQuizPayload()).toBe(true);
    expect('questions' in emptyQuizPayload()).toBe(false);

    expect('questions' in emptyFormPayload()).toBe(true);
    expect('questionsData' in emptyFormPayload()).toBe(false);
  });

  it('gives an upload its assignments array of slots', () => {
    expect(emptyUploadPayload().assignments).toEqual([]);
  });

  /** Production's real quizzes carry these two; a new one should match. */
  it('uses production\'s quiz defaults', () => {
    const payload = emptyQuizPayload();

    expect(payload.authenticationType).toBe('login');
    expect(payload.numberOfAllowedSubmissions).toBe(1);
    expect(payload.allowExitAndReEntry).toBe(false);
    expect(payload.displayCorrectAnswers).toBe(false);
    // Present and empty, never absent: the editor writes into it.
    expect(payload.backgroundInfo).toEqual({ title: '', description: '', images: [] });
  });

  /** The literal sentence production's create-form step prefills. */
  it('prefills the form\'s instructions as production does', () => {
    expect(emptyFormPayload().instructions)
      .toBe('Please answer all the questions in the fields provided below');
  });

  /**
   * EVERY ARRAY STARTS EMPTY, NEVER ABSENT. A quiz with no questions is a valid,
   * listable document — production's own dialog writes one at the end of step one
   * — but an undefined array is what Firestore rejects outright.
   */
  it('starts every content array empty rather than undefined', () => {
    expect(emptyQuizPayload().questionsData).toEqual([]);
    expect(emptyFormPayload().questions).toEqual([]);
    expect(emptyUploadPayload().assignments).toEqual([]);
  });
});

describe('stripTrashMetadata', () => {

  it('removes trashAt so a restored row is byte-identical to what was deleted', () => {
    const restored = stripTrashMetadata({
      docId: 'a1',
      displayName: 'Feedback Form',
      trashAt: 'a timestamp'
    });

    expect('trashAt' in restored).toBe(false);
    expect(restored['displayName']).toBe('Feedback Form');
  });

  it('does not mutate the object it was given', () => {
    const trashed = { docId: 'a1', trashAt: 'a timestamp' };

    stripTrashMetadata(trashed);

    expect('trashAt' in trashed).toBe(true);
  });
});

/**
 * A compile-time check, not a runtime one.
 *
 * The union's whole purpose is that a quiz cannot be handed a form's fields. If
 * this file compiles, the discriminant is doing its job; the assertions below
 * exist so the block is not dead code.
 */
describe('the discriminated union narrows', () => {

  it('reaches questionsData on a quiz and questions on a form', () => {
    const quiz: QuizAssignment = {
      docId: 'q1', displayName: 'Q', type: 'QUIZ', status: 'LIVE',
      creator: 'A', author: 'B', ownerId: 'uid', createdAt: null, updatedAt: null,
      ...emptyQuizPayload()
    };

    const form: FormAssignment = {
      docId: 'f1', displayName: 'F', type: 'FORM', status: 'LIVE',
      creator: 'A', author: 'B', ownerId: 'uid', createdAt: null, updatedAt: null,
      ...emptyFormPayload()
    };

    expect(quiz.questionsData).toEqual([]);
    expect(form.questions).toEqual([]);
  });
});

describe('stripUndefined', () => {

  /**
   * Firestore rejects `undefined` anywhere in a value tree and fails the WHOLE
   * write. An assignment nests four levels deep — questionsData[].options[] — so
   * one absent field on one option killed an entire quiz save, with an error that
   * named a path rather than a cause.
   */
  it('removes undefined keys at every depth', () => {
    const result = stripUndefined({
      keep: 1,
      drop: undefined,
      questionsData: [
        { questionType: 'TEXT', options: undefined, answer: 'a' },
        { questionType: 'MCQ', options: [{ name: 'x', imagePath: undefined }] }
      ]
    }) as unknown as Record<string, unknown>;

    expect('drop' in result).toBe(false);
    expect(result['keep']).toBe(1);

    const questions = result['questionsData'] as unknown as Record<string, unknown>[];
    expect('options' in questions[0]).toBe(false);
    expect(questions[0]['answer']).toBe('a');

    const options = questions[1]['options'] as Record<string, unknown>[];
    expect('imagePath' in options[0]).toBe(false);
    expect(options[0]['name']).toBe('x');
  });

  /**
   * ARRAYS KEEP THEIR LENGTH. `questionsData` and `workflowIds` are read
   * POSITIONALLY, so splicing out a hole would shift every later entry onto the
   * wrong question. An undefined entry becomes null instead.
   */
  it('preserves array length, turning an undefined entry into null', () => {
    const result = stripUndefined([1, undefined, 3]) as unknown[];

    expect(result.length).toBe(3);
    expect(result[1]).toBeNull();
  });

  /** null is a legitimate stored value and must survive. */
  it('keeps null', () => {
    const result = stripUndefined({ createdAt: null }) as Record<string, unknown>;

    expect('createdAt' in result).toBe(true);
    expect(result['createdAt']).toBeNull();
  });

  /**
   * A CLASS INSTANCE CROSSES UNCHANGED. Rebuilding a Timestamp as a plain object
   * would strip the prototype Firestore recognises, and the field would be written
   * as a map of seconds and nanoseconds instead of a timestamp.
   */
  it('does not rebuild class instances', () => {
    class Stamp {
      constructor(readonly seconds: number) {}
    }

    const stamp = new Stamp(42);
    const result = stripUndefined({ at: stamp }) as Record<string, unknown>;

    expect(result['at']).toBe(stamp);
    expect(result['at'] instanceof Stamp).toBe(true);
  });

  it('leaves a clean object untouched in value', () => {
    const input = { a: 1, b: { c: [1, 2] } };

    expect(stripUndefined(input)).toEqual(input);
  });
});


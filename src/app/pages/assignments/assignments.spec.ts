import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Timestamp } from 'firebase/firestore';

import {
  ASSIGNMENT_TYPES,
  Assignment,
  emptyFormPayload,
  emptyQuizPayload,
  emptyUploadPayload
} from '../../models/teaching.model';
import { AuthService } from '../../services/auth.service';
import { AssignmentService } from '../../services/assignment.service';
import { Assignments } from './assignments';

/**
 * Assignments — the list page.
 *
 * THE ASSERTION THIS FILE EXISTS FOR is that there are THREE types and only
 * three. Production offers six; this app implements Quiz, Upload and Form on
 * instruction. The restriction is enforced in one place — ASSIGNMENT_TYPES — and
 * read by the Create menu, the stat cards and the filter pills, so the way it
 * would regress is a fourth entry appearing there and silently reaching all
 * three surfaces. That is pinned below.
 *
 * The rest covers the counting and the status reading, both of which are quiet
 * when wrong: a miscount shows a plausible number, and a status bucket that
 * mis-sorts shows a plausible badge.
 */

/**
 * A real member of the union, per type.
 *
 * The union is what forces this: a single object literal with `type: 'FORM'` and
 * a `type` override cannot satisfy it, and that is the point — a quiz stores
 * `questionsData` where a form stores `questions`, so a fixture that blurred the
 * two would let a test pass against a document production could not read.
 *
 * `type` is taken separately from the overrides so the payload can be chosen from
 * it before the rest is applied.
 */
function assignment(overrides: {
  docId?: string;
  displayName?: string;
  /* A STRING, not AssignmentType. One test passes 'CASE_STUDY' on purpose: the
     collection can hold a type production writes and this app does not, and the
     page has to count it in the total without inventing a bucket for it. */
  type?: string;
  status?: string;
  creator?: string;
  author?: string;
} = {}): Assignment {
  const { type = 'FORM', ...rest } = overrides;

  const base = {
    docId: 'a1',
    displayName: 'Feedback Form',
    status: 'LIVE',
    creator: 'Divya Jain',
    author: 'ThinkTac',
    ownerId: 'uid-1',
    createdAt: null,
    updatedAt: Timestamp.fromDate(new Date('2026-08-01T00:00:00Z'))
  };

  const payload =
    type === 'QUIZ' ? emptyQuizPayload()
    : type === 'UPLOAD' ? emptyUploadPayload()
    : emptyFormPayload();

  return { ...base, type, ...payload, ...rest } as Assignment;
}

class StubAssignmentService {
  rows: Assignment[] = [];
  listError: unknown = null;
  trashed: unknown[] = [];
  created: unknown[] = [];
  trashedIds: string[] = [];
  patched: { docId: string; patch: Record<string, unknown> }[] = [];
  updateError: unknown = null;

  async update(docId: string, patch: Record<string, unknown>): Promise<void> {
    if (this.updateError) throw this.updateError;
    this.patched.push({ docId, patch });
  }

  async list(): Promise<Assignment[]> {
    if (this.listError) throw this.listError;
    return this.rows;
  }

  async listTrash(): Promise<never[]> {
    return [];
  }

  async create(draft: Record<string, unknown>): Promise<Assignment> {
    this.created.push(draft);
    return assignment({ docId: 'new-1', displayName: String(draft['displayName']) });
  }

  async moveToTrash(docId: string): Promise<void> {
    this.trashedIds.push(docId);
  }

  describeError(error: unknown, fallback: string): string {
    return (error as { message?: string })?.message ?? fallback;
  }
}

class StubAuthService {
  displayName(): string {
    return 'Divya Jain';
  }
}

async function mount(rows: Assignment[] = [], listError: unknown = null): Promise<{
  fixture: ComponentFixture<Assignments>;
  component: Assignments;
  service: StubAssignmentService;
  el: HTMLElement;
}> {
  TestBed.resetTestingModule();
  const service = new StubAssignmentService();
  service.rows = rows;
  service.listError = listError;

  await TestBed.configureTestingModule({
    imports: [Assignments],
    providers: [
      { provide: AssignmentService, useValue: service },
      { provide: AuthService, useValue: new StubAuthService() }
    ]
  }).compileComponents();

  const fixture = TestBed.createComponent(Assignments);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return {
    fixture,
    component: fixture.componentInstance,
    service,
    el: fixture.nativeElement as HTMLElement
  };
}

describe('Assignments', () => {

  /* ---- Three types, and only three -------------------------------------- */

  it('knows exactly Quiz, Upload and Form', () => {
    expect(ASSIGNMENT_TYPES.map(entry => entry.type)).toEqual(['QUIZ', 'UPLOAD', 'FORM']);
  });

  /**
   * PRODUCTION'S OTHER THREE MUST NOT APPEAR. Naming them explicitly rather than
   * asserting a length, so a regression says which one came back.
   */
  it('offers no Textblock, Case Study or Multi-Category', () => {
    const types = ASSIGNMENT_TYPES.map(entry => entry.type) as string[];

    for (const absent of ['TEXTBLOCK', 'CASE_STUDY', 'MULTI_CATEGORY']) {
      expect(types).not.toContain(absent);
    }
  });

  it('renders one Create menu item per type, and nothing else', async () => {
    const { el, component, fixture } = await mount();

    component.toggleCreateMenu();
    fixture.detectChanges();

    const items = [...el.querySelectorAll('.create-item')].map(node => node.textContent?.trim());

    expect(items).toEqual(['Quiz Type', 'Upload Type', 'Form Type']);
  });

  /** All + three, so the pills and the menu cannot drift apart. */
  /**
   * A SIGNAL NOW, because the creatable set comes from Configuration. The default
   * is still the three the app implements, and the service refuses to widen it
   * past what has an editor — see applyCreatableTypes.
   */
  it('has an All pill and one per creatable type', async () => {
    const { component } = await mount();

    expect(component.filters()).toEqual(['All', 'QUIZ', 'UPLOAD', 'FORM']);
    expect(component.types().map(entry => entry.type)).toEqual(['QUIZ', 'UPLOAD', 'FORM']);
  });

  it('renders a stat card for the total and each type', async () => {
    const { el } = await mount();
    const labels = [...el.querySelectorAll('.sc-copy > span')].map(n => n.textContent?.trim());

    expect(labels).toEqual(['Total', 'Quizzes', 'Uploads', 'Forms']);
  });

  /* ---- Counting ---------------------------------------------------------- */

  it('counts per type, and All is the whole list', async () => {
    const { component } = await mount([
      assignment({ docId: 'a1', type: 'QUIZ' }),
      assignment({ docId: 'a2', type: 'QUIZ' }),
      assignment({ docId: 'a3', type: 'UPLOAD' })
    ]);

    expect(component.countFor('All')).toBe(3);
    expect(component.countFor('QUIZ')).toBe(2);
    expect(component.countFor('UPLOAD')).toBe(1);
    expect(component.countFor('FORM')).toBe(0);
  });

  /**
   * A ROW OF AN UNKNOWN TYPE IS COUNTED IN 'All' AND NOWHERE ELSE.
   *
   * The collection can hold a CASE_STUDY written by production. It must still
   * appear in the total — the teacher has one — while belonging to none of the
   * three pills, and the counter must not invent a bucket for it.
   */
  it('keeps a foreign type out of the per-type counts but inside the total', async () => {
    const { component } = await mount([
      assignment({ docId: 'a1', type: 'QUIZ' }),
      // A production-written type this app does not implement.
      assignment({ docId: 'a2', type: 'CASE_STUDY' })
    ]);

    expect(component.countFor('All')).toBe(2);
    expect(component.countFor('QUIZ')).toBe(1);
    expect(component.countFor('UPLOAD')).toBe(0);
  });

  it('filters the rows by the active pill', async () => {
    const { component } = await mount([
      assignment({ docId: 'a1', type: 'QUIZ' }),
      assignment({ docId: 'a2', type: 'FORM' })
    ]);

    expect(component.filtered().length).toBe(2);

    component.setFilter('FORM');

    expect(component.filtered().map(row => row.docId)).toEqual(['a2']);
  });

  /* ---- Status ------------------------------------------------------------ */

  /**
   * PRODUCTION'S OWN READING, from its all-assignments-table: 'active' and 'live'
   * are live, 'closed' and 'archived' are closed, everything else is draft. The
   * fallback matters — the collection holds values the form never offers.
   */
  it('buckets statuses the way production does', async () => {
    const { component } = await mount();

    expect(component.statusKind('LIVE')).toBe('live');
    expect(component.statusKind('active')).toBe('live');
    expect(component.statusKind('CLOSED')).toBe('closed');
    expect(component.statusKind('archived')).toBe('closed');
    expect(component.statusKind('DEVELOPMENT')).toBe('draft');
    expect(component.statusKind('')).toBe('draft');
  });

  /** The badge shows the STORED word, not the bucket it fell into. */
  it('shows the stored status text', async () => {
    const { component } = await mount();

    expect(component.statusLabel('DEVELOPMENT')).toBe('DEVELOPMENT');
    expect(component.statusLabel('  ')).toBe('DRAFT');
  });

  /* ---- Rendering --------------------------------------------------------- */

  it('renders a row per assignment, with a shortened id', async () => {
    const { el, component } = await mount([
      assignment({ docId: 'abcdefghijkl', displayName: 'Reflection Day 2' })
    ]);

    expect(el.querySelectorAll('tbody tr').length).toBe(1);
    expect(el.textContent).toContain('Reflection Day 2');
    expect(component.shortId('abcdefghijkl')).toBe('abcdef…');
    // A short id is left whole rather than gaining a misleading ellipsis.
    expect(component.shortId('abc')).toBe('abc');
  });

  it('shows an empty state rather than a bare table', async () => {
    const { el } = await mount([]);

    expect(el.querySelector('.asgn-state')?.textContent).toContain('No assignments yet');
  });

  /** A failed read must say so, not render as an empty collection. */
  it('shows an error instead of an empty list when the read fails', async () => {
    const { el } = await mount([], new Error('nope'));

    expect(el.querySelector('.load-error')).not.toBeNull();
    expect(el.textContent).not.toContain('No assignments yet');
  });

  /* ---- Create ------------------------------------------------------------ */

  /**
   * ONE EDITOR PER TYPE, and this pins WHICH — the three are not
   * interchangeable. A quiz and an upload each open production's own wizard and
   * emit a whole document; a FORM opens the one-step form, which emits a PATCH
   * because its field builder does not exist yet. Routing a form to a wizard, or
   * an upload to the one-step form, is the kind of mistake that either deletes
   * stored content or silently drops what the user just entered.
   */
  it('opens the right editor for the chosen type and closes the menu', async () => {
    const { component, fixture, el } = await mount();

    component.toggleCreateMenu();
    fixture.detectChanges();
    component.openCreate('UPLOAD');
    fixture.detectChanges();

    expect(component.creating()).toBe('UPLOAD');
    expect(component.createMenuOpen()).toBe(false);
    expect(component.creatingUpload()).toBe(true);
    expect(component.creatingForm()).toBe(false);
    expect(el.querySelector('app-upload-wizard')).not.toBeNull();
    expect(el.querySelector('app-form-wizard')).toBeNull();

    component.openCreate('FORM');
    fixture.detectChanges();

    expect(component.creatingUpload()).toBe(false);
    expect(component.creatingForm()).toBe(true);
    expect(el.querySelector('app-form-wizard')).not.toBeNull();
    expect(el.querySelector('app-upload-wizard')).toBeNull();

    component.openCreate('QUIZ');
    fixture.detectChanges();

    expect(component.creatingForm()).toBe(false);
    expect(el.querySelector('app-quiz-wizard')).not.toBeNull();
  });

  /**
   * PREPENDED, not reloaded. The list is newest-first and a round trip to see a
   * row you just wrote is a wait for no new information.
   */
  it('adds the created row to the top without a reload', async () => {
    const { component, service } = await mount([assignment({ docId: 'old' })]);

    await component.saveNew({
      displayName: 'New Quiz',
      author: 'ThinkTac',
      creator: 'Divya Jain',
      status: 'LIVE',
      type: 'QUIZ',
      ...emptyQuizPayload()
    });

    expect(service.created.length).toBe(1);
    expect(component.rows().map(row => row.docId)).toEqual(['new-1', 'old']);
    expect(component.creating()).toBeNull();
  });

  /* ---- Trash ------------------------------------------------------------- */

  /** Confirmed first: production deletes without asking, this one asks. */
  it('asks before moving a row to the trash', async () => {
    const { component, service, fixture, el } = await mount([assignment({ docId: 'a1' })]);

    component.askMoveToTrash(component.rows()[0]);
    fixture.detectChanges();

    expect(el.querySelector('app-confirm-dialog')).not.toBeNull();
    expect(service.trashedIds).toEqual([]);

    await component.moveToTrash();

    expect(service.trashedIds).toEqual(['a1']);
    expect(component.rows()).toEqual([]);
  });

  /* ---- Edit --------------------------------------------------------------- */

  /**
   * THE DATA-LOSS TRAP THIS PINS. An UPLOAD carries `assignments` file slots and a
   * FORM carries `questions`; neither has a content editor in this app yet. Those
   * two therefore open the ONE-STEP form, which emits a PATCH — three fields —
   * rather than a whole draft. Wiring them to `submitted` instead would send the
   * create path's EMPTY payload and delete every stored slot or question on save.
   */
  it('routes a quiz to the wizard and the other two to the form', async () => {
    const { component, fixture, el } = await mount([
      assignment({ docId: 'q1', type: 'QUIZ' }),
      assignment({ docId: 'f1', type: 'FORM' })
    ]);

    component.openEdit(component.rows()[0]);
    fixture.detectChanges();

    expect(component.editingQuiz()?.docId).toBe('q1');
    expect(component.editingUpload()).toBeNull();
    expect(component.editingForm()).toBeNull();
    expect(el.querySelector('app-quiz-wizard')).not.toBeNull();

    component.openEdit(component.rows()[1]);
    fixture.detectChanges();

    expect(component.editingQuiz()).toBeNull();
    expect(component.editingForm()?.docId).toBe('f1');
    expect(el.querySelector('app-form-wizard')).not.toBeNull();
  });

  /** An UPLOAD edit opens ITS OWN wizard. The three are not interchangeable: the
      slots are the point of editing an upload, and any other editor would save
      the row while leaving them untouched. */
  it('opens the upload wizard to edit an upload', async () => {
    const { component, fixture, el } = await mount([
      assignment({ docId: 'u1', type: 'UPLOAD' })
    ]);

    component.openEdit(component.rows()[0]);
    fixture.detectChanges();

    expect(component.editingUpload()?.docId).toBe('u1');
    expect(component.editingForm()).toBeNull();
    expect(component.editingQuiz()).toBeNull();
    expect(el.querySelector('app-upload-wizard')).not.toBeNull();
    expect(el.querySelector('app-form-wizard')).toBeNull();
  });

  it('renders an Edit button on every row', async () => {
    const { el } = await mount([assignment({ docId: 'a1' })]);

    // `.icon-act`, not `.row-btn`: the table's actions are bare icons now, and
    // `.row-btn` is kept for the trash drawer's labelled Restore button.
    const labels = [...el.querySelectorAll('.asgn-actions .icon-act')]
      .map(node => node.getAttribute('aria-label'));

    expect(labels).toEqual(['Edit', 'Move to Trash']);
  });

  /**
   * A FORM'S WHOLE DOCUMENT GOES NOW, `questions` included.
   *
   * This used to assert the opposite — a three-field patch — and the patch was
   * right while a form had no question editor: sending a full draft would have
   * written the create path's empty payload over every stored question. The form
   * wizard produces the questions, so the whole document is what should land.
   */
  it('sends the whole document when a form is updated', async () => {
    const { component, service } = await mount([assignment({ docId: 'f1', type: 'FORM' })]);

    component.openEdit(component.rows()[0]);
    await component.saveContentEdit({
      displayName: 'Renamed',
      author: 'Someone',
      creator: 'B',
      status: 'DEVELOPMENT',
      type: 'FORM',
      ...emptyFormPayload()
    });

    expect(service.patched.length).toBe(1);
    expect(service.patched[0].docId).toBe('f1');
    expect('questions' in service.patched[0].patch).toBe(true);
    expect(component.rows()[0].displayName).toBe('Renamed');
    expect(component.editing()).toBeNull();
  });

  /** A quiz's whole document goes, because its content is the point of editing. */
  it('sends the whole document when a quiz is updated', async () => {
    const { component, service } = await mount([assignment({ docId: 'q1', type: 'QUIZ' })]);

    component.openEdit(component.rows()[0]);
    await component.saveContentEdit({
      displayName: 'Edited Quiz',
      author: 'A',
      creator: 'B',
      status: 'LIVE',
      type: 'QUIZ',
      ...emptyQuizPayload()
    });

    expect(service.patched.length).toBe(1);
    expect(service.patched[0].docId).toBe('q1');
    expect('questionsData' in service.patched[0].patch).toBe(true);
    expect(component.rows()[0].displayName).toBe('Edited Quiz');
  });

  /** A failed save keeps the dialog open with the input intact. */
  it('keeps the editor open when the save fails', async () => {
    const { component, service } = await mount([assignment({ docId: 'f1', type: 'FORM' })]);

    service.updateError = Object.assign(new Error('nope'), { code: 'permission-denied' });
    component.openEdit(component.rows()[0]);

    await component.saveContentEdit({
      displayName: 'X',
      author: 'Y',
      creator: 'B',
      status: 'LIVE',
      type: 'FORM',
      ...emptyFormPayload()
    });

    expect(component.editing()).not.toBeNull();
    expect(component.modalError()).not.toBe('');
    expect(component.rows()[0].displayName).toBe('Feedback Form');
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Timestamp } from 'firebase/firestore';

import { Assignment, ProgrammeAssignment } from '../../models/teaching.model';
import {
  AssignmentPicker,
  PickableAssignment,
  toPickableAssignments
} from './assignment-picker';

/**
 * Step 4 of Create Programme — choosing a programme's assignments.
 *
 * WHAT MATTERS HERE, and it is not the drag mechanics. The stored shape is a MAP
 * keyed by doc id, `{ [docId]: { assignmentId, assignmentDueDate } }`, read off
 * production's own collection: 2715 of its 14240 programmes carry it that way and
 * every one of the 20 non-empty entries has exactly those two fields, with the key
 * always equal to the id inside it.
 *
 * Three consequences are worth guarding:
 *
 *   1. THE KEY AND THE INNER ID MUST AGREE. A reader with the entry alone still
 *      has to know which assignment it is.
 *   2. THERE IS NO ORDER TO PRESERVE, because a map has none — which is why this
 *      picker has no reorder buttons where the learning-unit one must.
 *   3. THE DUE DATE IS A DAY, NOT AN INSTANT. Built at LOCAL midnight, because
 *      `new Date('2026-09-05')` parses as UTC and would shift the day for every
 *      user this app serves.
 */

const CATALOGUE: PickableAssignment[] = [
  { docId: 'q1', displayName: 'Case Study Quiz', type: 'QUIZ' },
  { docId: 'u1', displayName: 'Observation Sheet', type: 'UPLOAD' },
  { docId: 'f1', displayName: 'Feedback Form', type: 'FORM' },
  { docId: 'f2', displayName: 'Another Form', type: 'FORM' }
];

async function mount(
  selected: Record<string, ProgrammeAssignment> = {}
): Promise<{
  fixture: ComponentFixture<AssignmentPicker>;
  component: AssignmentPicker;
  emitted: Record<string, ProgrammeAssignment>[];
}> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({ imports: [AssignmentPicker] }).compileComponents();

  const fixture = TestBed.createComponent(AssignmentPicker);
  const component = fixture.componentInstance;
  const emitted: Record<string, ProgrammeAssignment>[] = [];

  fixture.componentRef.setInput('assignments', CATALOGUE);
  fixture.componentRef.setInput('selected', selected);
  component.selectedChange.subscribe(value => emitted.push(value));
  fixture.detectChanges();

  return { fixture, component, emitted };
}

describe('toPickableAssignments', () => {

  /**
   * NARROWED TO THREE FIELDS. A quiz document carries `questionsData` with every
   * question, option and blank; handing that to a dropdown that shows a title and
   * a type would ship the whole quiz into the picker.
   */
  it('keeps only what the panel renders', () => {
    const rows = toPickableAssignments([
      {
        docId: 'q1',
        displayName: 'Case Study Quiz',
        type: 'QUIZ',
        status: 'LIVE',
        creator: 'A',
        author: 'B',
        ownerId: 'uid',
        createdAt: null,
        updatedAt: null,
        questionsData: [{ questionTitle: 'Q1', questionType: 'MCQ' }]
      } as unknown as Assignment
    ]);

    expect(rows).toEqual([{ docId: 'q1', displayName: 'Case Study Quiz', type: 'QUIZ' }]);
  });
});

describe('AssignmentPicker', () => {

  it('offers the whole catalogue and nothing selected', async () => {
    const { component } = await mount();

    expect(component.availableCount()).toBe(4);
    expect(component.selectedCount()).toBe(0);
  });

  /**
   * ALL, THEN THE CREATABLE TYPES. Production offers all five kinds; GAME and
   * TEXTBLOCK are excluded on instruction. Read from the configuration service so
   * this filter cannot drift from the Create menu — both answer to
   * Configuration/AssignmentTypes.creatableTypes.
   */
  it('filters by the creatable types, with GAME and TEXTBLOCK absent', async () => {
    const { component } = await mount();

    expect(component.typeOptions().map(option => option.label))
      .toEqual(['ALL', 'QUIZ', 'UPLOAD', 'FORM']);
    expect(component.typeOptions().some(option => option.label === 'GAME')).toBe(false);
    expect(component.typeOptions().some(option => option.label === 'TEXTBLOCK')).toBe(false);
  });

  it('narrows the available list by type', async () => {
    const { component } = await mount();

    component.typeFilter.set('FORM');

    expect(component.available().map(row => row.docId)).toEqual(['f1', 'f2']);
  });

  it('searches the name and the type', async () => {
    const { component } = await mount();

    component.query.set('feedback');
    expect(component.available().map(row => row.docId)).toEqual(['f1']);

    component.query.set('upload');
    expect(component.available().map(row => row.docId)).toEqual(['u1']);
  });

  describe('choosing', () => {

    /** THE KEY AND THE INNER ID AGREE — production's own redundancy. */
    it('adds an entry keyed by doc id, with the id inside it', async () => {
      const { component, emitted } = await mount();

      component.add('q1');

      expect(emitted.length).toBe(1);
      expect(emitted[0]).toEqual({
        q1: { assignmentId: 'q1', assignmentDueDate: null }
      });
      expect(Object.keys(emitted[0])[0]).toBe(emitted[0]['q1'].assignmentId);
    });

    it('takes a chosen assignment out of the available column', async () => {
      const { component } = await mount();

      component.add('q1');

      expect(component.availableCount()).toBe(3);
      expect(component.selectedCount()).toBe(1);
      expect(component.available().some(row => row.docId === 'q1')).toBe(false);
    });

    it('will not add the same one twice', async () => {
      const { component, emitted } = await mount();

      component.add('q1');
      component.add('q1');

      expect(emitted.length).toBe(1);
      expect(component.selectedCount()).toBe(1);
    });

    it('removes an entry and returns it to available', async () => {
      const { component } = await mount({
        q1: { assignmentId: 'q1', assignmentDueDate: null }
      });

      expect(component.selectedCount()).toBe(1);

      component.remove('q1');

      expect(component.selectedCount()).toBe(0);
      expect(component.available().some(row => row.docId === 'q1')).toBe(true);
    });

    /**
     * SORTED BY NAME. A map has no insertion order to honour and an object's key
     * order is not something to rely on; a stable list is what keeps the Review
     * step matching what the picker showed.
     */
    it('lists the selection by name', async () => {
      const { component } = await mount();

      component.add('u1');
      component.add('f2');
      component.add('q1');

      expect(component.picked().map(row => row.displayName))
        .toEqual(['Another Form', 'Case Study Quiz', 'Observation Sheet']);
    });

    /** An id with no matching row is dropped rather than rendered blank. */
    it('ignores a selected id that is not in the catalogue', async () => {
      const { component } = await mount({
        gone: { assignmentId: 'gone', assignmentDueDate: null }
      });

      expect(component.picked()).toEqual([]);
      expect(component.selectedCount()).toBe(1);
    });
  });

  describe('the due date', () => {

    /**
     * LOCAL TIME, NOT UTC. A bare date string is parsed as UTC by spec, which is
     * 05:30 out for India and the previous day anywhere west — so a deadline typed
     * as the 5th must not come back as the 4th.
     */
    it('stores the day and time the user picked', async () => {
      const { component, emitted } = await mount();

      component.add('q1');
      component.setDueDate('q1', '2026-09-05T16:30');

      const stored = emitted[emitted.length - 1]['q1'].assignmentDueDate;
      expect(stored).not.toBeNull();

      const date = (stored as Timestamp).toDate();
      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(8);
      expect(date.getDate()).toBe(5);
      expect(date.getHours()).toBe(16);
      expect(date.getMinutes()).toBe(30);
    });

    /**
     * DATE AND TIME, because production's picker takes both: its dialog carries an
     * hour, a minute and an AM/PM control under the calendar. A date-only field
     * would round every deadline to midnight.
     */
    it('round-trips through the datetime input', async () => {
      const { component } = await mount();

      component.add('q1');
      component.setDueDate('q1', '2026-01-09T09:05');

      expect(component.dueDateFor('q1')).toBe('2026-01-09T09:05');
    });

    /** A value with no time is midnight rather than an invalid Timestamp. */
    it('treats a bare date as local midnight', async () => {
      const { component } = await mount();

      component.add('q1');
      component.setDueDate('q1', '2026-09-05');

      const date = (component.chosen()['q1'].assignmentDueDate as Timestamp).toDate();
      expect(date.getDate()).toBe(5);
      expect(date.getHours()).toBe(0);
      expect(date.getMinutes()).toBe(0);
    });

    it('has no date until one is set', async () => {
      const { component } = await mount();

      component.add('q1');

      expect(component.dueDateFor('q1')).toBe('');
      expect(component.chosen()['q1'].assignmentDueDate).toBeNull();
    });

    it('clears back to null', async () => {
      const { component } = await mount();

      component.add('q1');
      component.setDueDate('q1', '2026-09-05T16:30');
      component.setDueDate('q1', '');

      expect(component.chosen()['q1'].assignmentDueDate).toBeNull();
      expect(component.dueDateFor('q1')).toBe('');
    });

    /** Setting a date on something not chosen must not conjure an entry. */
    it('ignores a date for an assignment that is not selected', async () => {
      const { component, emitted } = await mount();

      component.setDueDate('q1', '2026-09-05T16:30');

      expect(emitted.length).toBe(0);
      expect(component.selectedCount()).toBe(0);
    });

    /** The id stays put when only the date changes. */
    it('keeps the entry\'s id when the date is edited', async () => {
      const { component } = await mount();

      component.add('q1');
      component.setDueDate('q1', '2026-09-05T16:30');

      expect(component.chosen()['q1'].assignmentId).toBe('q1');
    });
  });

  describe('drag and drop', () => {

    const dragEvent = (): DragEvent =>
      ({
        preventDefault: () => undefined,
        stopPropagation: () => undefined,
        dataTransfer: { setData: () => undefined, effectAllowed: '' }
      }) as unknown as DragEvent;

    /**
     * A DROP OPENS THE DIALOG; IT DOES NOT ADD. Production asks for the due date
     * on the drop, and nothing is recorded until Save.
     */
    it('opens the due-date dialog on a drop into the selected column', async () => {
      const { component } = await mount();

      component.onDragStart(dragEvent(), 'q1', 'available');
      component.onDropSelected(dragEvent());

      expect(component.dueDialog()).toEqual({ docId: 'q1', mode: 'add' });
      expect(component.selectedCount()).toBe(0);
      expect(component.draggingId()).toBe('');
    });

    it('removes on a drop back into available', async () => {
      const { component } = await mount({
        q1: { assignmentId: 'q1', assignmentDueDate: null }
      });

      component.onDragStart(dragEvent(), 'q1', 'selected');
      component.onDropAvailable(dragEvent());

      expect(component.selectedCount()).toBe(0);
    });

    /** A row already in Selected dropped there again changes nothing. */
    it('does nothing when a selected row is dropped on selected', async () => {
      const { component, emitted } = await mount({
        q1: { assignmentId: 'q1', assignmentDueDate: null }
      });

      component.onDragStart(dragEvent(), 'q1', 'selected');
      component.onDropSelected(dragEvent());

      expect(emitted.length).toBe(0);
      expect(component.selectedCount()).toBe(1);
    });

    /* ---- The due-date dialog ------------------------------------------- */

    /**
     * CANCELLING AN ADD DOES NOT ADD, which is a deliberate difference from
     * production: it moves the row into Selected as the drop lands and only then
     * opens the dialog, so dismissing it leaves a row on screen that was never
     * recorded and that the next save writes nothing for.
     */
    it('adds nothing when the dialog is cancelled', async () => {
      const { component, emitted } = await mount();

      component.onDragStart(dragEvent(), 'q1', 'available');
      component.onDropSelected(dragEvent());
      component.closeDueDialog();

      expect(component.dueDialog()).toBeNull();
      expect(component.selectedCount()).toBe(0);
      expect(emitted.length).toBe(0);
    });

    /** Save is refused without a value, as production's is. */
    it('refuses to save without a date', async () => {
      const { component, emitted } = await mount();

      component.openDueDialogForAdd('q1');
      expect(component.dueDialogValid()).toBe(false);

      component.saveDueDialog();

      expect(emitted.length).toBe(0);
      expect(component.dueDialog()).not.toBeNull();
    });

    it('adds the assignment with its date on save', async () => {
      const { component, emitted } = await mount();

      component.openDueDialogForAdd('q1');
      component.dueDialogValue.set('2026-09-30T16:45');
      expect(component.dueDialogValid()).toBe(true);

      component.saveDueDialog();

      expect(component.dueDialog()).toBeNull();
      expect(component.selectedCount()).toBe(1);

      const stored = emitted[emitted.length - 1]['q1'];
      expect(stored.assignmentId).toBe('q1');

      const date = (stored.assignmentDueDate as Timestamp).toDate();
      expect(date.getDate()).toBe(30);
      expect(date.getHours()).toBe(16);
      expect(date.getMinutes()).toBe(45);
    });

    /** The pencil reopens it, seeded with what is stored. */
    it('reopens the dialog for an edit with the current value', async () => {
      const { component } = await mount();

      component.openDueDialogForAdd('q1');
      component.dueDialogValue.set('2026-09-30T16:45');
      component.saveDueDialog();

      component.openDueDialogForEdit('q1');

      expect(component.dueDialog()).toEqual({ docId: 'q1', mode: 'edit' });
      expect(component.dueDialogValue()).toBe('2026-09-30T16:45');
    });

    it('replaces the date on an edit and keeps the id', async () => {
      const { component } = await mount();

      component.openDueDialogForAdd('q1');
      component.dueDialogValue.set('2026-09-30T16:45');
      component.saveDueDialog();

      component.openDueDialogForEdit('q1');
      component.dueDialogValue.set('2026-10-01T09:00');
      component.saveDueDialog();

      const stored = component.chosen()['q1'];
      expect(stored.assignmentId).toBe('q1');

      const date = (stored.assignmentDueDate as Timestamp).toDate();
      expect(date.getMonth()).toBe(9);
      expect(date.getDate()).toBe(1);
      expect(date.getHours()).toBe(9);
    });

    /** Cancelling an EDIT leaves the stored date alone. */
    it('keeps the stored date when an edit is cancelled', async () => {
      const { component } = await mount();

      component.openDueDialogForAdd('q1');
      component.dueDialogValue.set('2026-09-30T16:45');
      component.saveDueDialog();

      component.openDueDialogForEdit('q1');
      component.dueDialogValue.set('2027-01-01T00:00');
      component.closeDueDialog();

      const date = (component.chosen()['q1'].assignmentDueDate as Timestamp).toDate();
      expect(date.getDate()).toBe(30);
      expect(date.getHours()).toBe(16);
    });

    it('will not open an edit for something not chosen', async () => {
      const { component } = await mount();

      component.openDueDialogForEdit('q1');

      expect(component.dueDialog()).toBeNull();
    });

    it('will not open an add for something already chosen', async () => {
      const { component } = await mount({
        q1: { assignmentId: 'q1', assignmentDueDate: null }
      });

      component.openDueDialogForAdd('q1');

      expect(component.dueDialog()).toBeNull();
    });

    /** The dialog names the assignment it is about. */
    it('knows which assignment it is open for', async () => {
      const { component } = await mount();

      component.openDueDialogForAdd('u1');

      expect(component.dueDialogRow()?.displayName).toBe('Observation Sheet');
    });

    /** The card shows the date as a sentence once it is set. */
    it('labels the stored date for the card', async () => {
      const { component } = await mount();

      component.openDueDialogForAdd('q1');
      component.dueDialogValue.set('2026-09-30T16:45');
      component.saveDueDialog();

      expect(component.dueLabelFor('q1')).toContain('2026');
      expect(component.dueLabelFor('u1')).toBe('');
    });

    /** The left column only highlights for a drag that can land there. */
    it('highlights available only for a drag out of selected', async () => {
      const { component } = await mount();

      component.onDragStart(dragEvent(), 'q1', 'available');
      component.onDragOverAvailable(dragEvent());
      expect(component.dropOnAvailable()).toBe(false);

      component.onDragEnd();
      component.onDragStart(dragEvent(), 'q1', 'selected');
      component.onDragOverAvailable(dragEvent());
      expect(component.dropOnAvailable()).toBe(true);
    });
  });
});

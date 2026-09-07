import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PickableUnit } from '../../models/teaching.model';
import { LearningUnitPicker } from './learning-unit-picker';

/**
 * The learning-unit picker.
 *
 * WHY THIS EXISTS. The order of the selection is STORED and positional — a
 * classroom's per-unit locking is an array lined up against `learningUnitsIds`
 * index for index — so an off-by-one in a drop silently attaches the wrong lock
 * to the wrong unit. Nothing about that is visible in a screenshot, and it is
 * the only real arithmetic in this component.
 *
 * These tests moved here with the code: they were on AddProgramme until the
 * panel was extracted so Edit Programme's Manage Learning Units tab could use
 * the same one.
 */

function unit(docId: string, code: string, isoCode = 'EN'): PickableUnit {
  return {
    docId,
    code,
    name: `Unit ${code}`,
    typeCode: 'TA',
    isoCode,
    version: 'V10',
    createdAt: null
  };
}

/* One document is one row, so a code in two languages is two entries. */
const CATALOGUE: PickableUnit[] = [
  unit('a', 'AE01', 'TA'),
  unit('b', 'AE02'),
  unit('c', 'AV01', 'HI'),
  unit('d', 'BE15')
];

describe('LearningUnitPicker', () => {

  let fixture: ComponentFixture<LearningUnitPicker>;
  let component: LearningUnitPicker;
  let emitted: string[][];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [LearningUnitPicker] }).compileComponents();

    fixture = TestBed.createComponent(LearningUnitPicker);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('units', CATALOGUE);
    fixture.componentRef.setInput('selected', []);

    emitted = [];
    component.selectedChange.subscribe(ids => emitted.push(ids));

    fixture.detectChanges();
  });

  function dragEvent(): DragEvent {
    return {
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
      dataTransfer: { setData: () => undefined, effectAllowed: '' }
    } as unknown as DragEvent;
  }

  function drag(docId: string, from: 'available' | 'selected'): void {
    component.onDragStart(dragEvent(), docId, from);
  }

  function dropAt(index: number | null): void {
    component.onDragOverSelected(dragEvent(), index);
    component.onDropSelected(dragEvent());
  }

  /* ---- Selection -------------------------------------------------------- */

  it('starts from the selection it was given', () => {
    fixture.componentRef.setInput('selected', ['b']);
    fixture.detectChanges();

    expect(component.chosen()).toEqual(['b']);
    expect(component.available().map(row => row.docId)).toEqual(['a', 'c', 'd']);
  });

  it('moves a unit out of Available once it is selected', () => {
    component.add('b');

    expect(component.chosen()).toEqual(['b']);
    expect(component.available().map(row => row.docId)).toEqual(['a', 'c', 'd']);
  });

  it('emits every change', () => {
    component.add('b');
    component.add('a');
    component.remove('b');

    expect(emitted).toEqual([['b'], ['b', 'a'], ['a']]);
  });

  it('never selects the same unit twice', () => {
    component.add('b');
    component.add('b');

    expect(component.chosen()).toEqual(['b']);
  });

  it('returns a removed unit to Available', () => {
    component.add('b');
    component.remove('b');

    expect(component.chosen()).toEqual([]);
    expect(component.available().length).toBe(4);
  });

  /* SELECTED ORDER, NOT CATALOGUE ORDER — the whole point of the array. */
  it('keeps Selected in the order chosen', () => {
    component.add('d');
    component.add('a');
    component.add('c');

    expect(component.picked().map(row => row.docId)).toEqual(['d', 'a', 'c']);
  });

  it('swaps with the neighbour on reorder, and refuses at the ends', () => {
    component.add('a');
    component.add('b');
    component.add('c');

    component.move(2, -1);
    expect(component.chosen()).toEqual(['a', 'c', 'b']);

    component.move(0, -1);
    expect(component.chosen()).toEqual(['a', 'c', 'b']);

    component.move(2, 1);
    expect(component.chosen()).toEqual(['a', 'c', 'b']);
  });

  /* ---- Dragging --------------------------------------------------------- */

  it('appends when dropped past the last row', () => {
    component.add('a');

    drag('c', 'available');
    dropAt(null);

    expect(component.chosen()).toEqual(['a', 'c']);
  });

  it('inserts before the row it was dropped on', () => {
    component.add('a');
    component.add('b');

    drag('c', 'available');
    dropAt(0);

    expect(component.chosen()).toEqual(['c', 'a', 'b']);
  });

  /*
   * THE OFF-BY-ONE THIS GUARDS.
   *
   * A reorder removes the dragged id first, so an index captured against the
   * list BEFORE the removal is one too high for every position after it.
   * Dragging the first row onto the last must land it last.
   */
  it('moves a row to the end when dragged onto the last position', () => {
    component.add('a');
    component.add('b');
    component.add('c');

    drag('a', 'selected');
    dropAt(null);

    expect(component.chosen()).toEqual(['b', 'c', 'a']);
  });

  it('moves a row backwards without duplicating it', () => {
    component.add('a');
    component.add('b');
    component.add('c');

    drag('c', 'selected');
    dropAt(0);

    expect(component.chosen()).toEqual(['c', 'a', 'b']);
    expect(component.chosen().length).toBe(3);
  });

  it('removes a unit dragged back onto Available', () => {
    component.add('a');
    component.add('b');

    drag('a', 'selected');
    component.onDropAvailable(dragEvent());

    expect(component.chosen()).toEqual(['b']);
  });

  /* Dropping an AVAILABLE unit back on Available must change nothing. */
  it('ignores an available unit dropped on its own column', () => {
    component.add('a');

    drag('c', 'available');
    component.onDropAvailable(dragEvent());

    expect(component.chosen()).toEqual(['a']);
  });

  it('clears the drag state when the drag ends', () => {
    drag('c', 'available');
    component.onDragOverSelected(dragEvent(), 0);

    expect(component.draggingId()).toBe('c');
    expect(component.dropIndex()).toBe(0);

    component.onDragEnd();

    expect(component.draggingId()).toBe('');
    expect(component.draggingFrom()).toBe('');
    expect(component.dropIndex()).toBeNull();
  });

  it('does nothing when a drop arrives with no drag in flight', () => {
    component.add('a');
    component.onDropSelected(dragEvent());

    expect(component.chosen()).toEqual(['a']);
  });

  /* ---- Filters ---------------------------------------------------------- */

  /* STRICT on isoCode, as production's `e.isoCode === selected` is: one row is
     one document and one language. */
  it('filters by isoCode, strictly', () => {
    component.language.set('TA');
    expect(component.available().map(row => row.docId)).toEqual(['a']);

    component.language.set('HI');
    expect(component.available().map(row => row.docId)).toEqual(['c']);
  });

  it('searches code, name and isoCode, case-insensitively', () => {
    component.query.set('av01');
    expect(component.available().map(row => row.docId)).toEqual(['c']);

    component.query.set('unit be15');
    expect(component.available().map(row => row.docId)).toEqual(['d']);

    // Production searches the isoCode too, so 'hi' finds the Hindi row.
    component.query.set('hi');
    expect(component.available().map(row => row.docId)).toEqual(['c']);
  });

  /* PRODUCTION'S THREE PARTS: typeCode · isoCode · v+version. 'TA' here is
     TACtivity, not Tamil — reading it as a language was the original bug. */
  it('renders the row meta as typeCode, isoCode and version', () => {
    expect(component.meta(unit('x', 'PT12', 'EN'))).toBe('TA · EN · vV10');
    expect(component.tooltip(unit('x', 'PT12', 'EN')))
      .toBe('PT12 · Unit PT12 · TA · EN · vV10');
  });
});

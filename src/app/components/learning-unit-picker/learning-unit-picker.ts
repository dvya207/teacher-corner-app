import { Component, computed, input, output, signal } from '@angular/core';

import { Icon } from '../icon/icon';
import { PickableUnit } from '../../models/teaching.model';
import { ConfigurationService } from '../../services/configuration.service';
import { inject } from '@angular/core';

/**
 * Choosing a programme's learning units, and their ORDER.
 *
 * SHARED BY TWO SURFACES, which is why it is a component rather than markup in
 * one of them: step 3 of Create Programme, and the Manage Learning Units tab of
 * Edit Programme. Production has the same panel in both places — its
 * learning-list component is used by add-new-programme and by the programme
 * editor — and a second copy here would be two implementations of the drag
 * arithmetic to keep in step.
 *
 * THE ORDER IS THE POINT, not just the membership. `learningUnitsIds` is
 * positional: a classroom's per-unit locking is an array lined up against it
 * index for index (ClassroomProgramme.workflowIds), and a document written here
 * has to be readable by production, which reads it the same way. So the Selected
 * column is an ordered list with the position shown, not a set.
 *
 * PRESENTATIONAL. It takes the catalogue and the current selection and emits a
 * new selection; it reads nothing and writes nothing. Whoever owns the programme
 * owns the save.
 *
 * DRAG AND DROP IS NATIVE HTML5, not @angular/cdk — see the note on the handlers
 * below for why, and why the buttons stay regardless.
 */
@Component({
  selector: 'app-learning-unit-picker',
  imports: [Icon],
  templateUrl: './learning-unit-picker.html',
  styleUrl: './learning-unit-picker.css'
})
export class LearningUnitPicker {

  private config = inject(ConfigurationService);

  /** The catalogue to choose from, already filtered to live units. */
  readonly units = input<PickableUnit[]>([]);

  /** The current selection, in order. */
  readonly selected = input<string[]>([]);

  readonly selectedChange = output<string[]>();

  readonly language = signal('');
  readonly query = signal('');

  /**
   * The working copy of the selection.
   *
   * Seeded from the input and edited here, rather than emitting on every keypress
   * and waiting for the parent to hand it back — that round trip makes a drag
   * feel laggy and, if the parent debounces, briefly wrong. `selectedChange`
   * fires after every change, so the parent is never behind.
   */
  private readonly working = signal<string[] | null>(null);

  readonly chosen = computed(() => this.working() ?? this.selected());

  /**
   * The filter's options: the CONFIGURED language vocabulary, by NAME.
   *
   * The whole vocabulary, not just the languages present — which is production's
   * behaviour, and means an option can match nothing. Hiding a language because
   * no unit happens to be in it reads as the language not existing.
   */
  readonly languageOptions = this.config.learningUnitLanguages;

  /**
   * The left column: everything not already chosen, filtered.
   *
   * STRICT on isoCode, as production's `e.isoCode === this.selectedIsoCode` is:
   * one row is one document and one language.
   */
  readonly available = computed(() => {
    const taken = new Set(this.chosen());
    const language = this.language();
    const query = this.query().trim().toLowerCase();

    return this.units().filter(unit => {
      if (taken.has(unit.docId)) {
        return false;
      }

      if (language !== '' && unit.isoCode !== language) {
        return false;
      }

      if (query === '') {
        return true;
      }

      // Name, code and isoCode — production searches all three.
      return (
        unit.code.toLowerCase().includes(query) ||
        unit.name.toLowerCase().includes(query) ||
        unit.isoCode.toLowerCase().includes(query)
      );
    });
  });

  /**
   * The right column, IN THE CHOSEN ORDER.
   *
   * Built by walking the id list rather than filtering the catalogue, because
   * filtering returns catalogue order and would silently discard the sequence.
   */
  readonly picked = computed(() => {
    const byId = new Map(this.units().map(unit => [unit.docId, unit]));

    return this.chosen()
      .map(id => byId.get(id))
      .filter((unit): unit is PickableUnit => unit !== undefined);
  });

  /** The second line of a row: typeCode · isoCode · v+version, as production's. */
  meta(unit: PickableUnit): string {
    return [unit.typeCode, unit.isoCode, unit.version ? `v${unit.version}` : '']
      .filter(part => part !== '')
      .join(' · ');
  }

  tooltip(unit: PickableUnit): string {
    return [unit.code, unit.name, this.meta(unit)].filter(part => part !== '').join(' · ');
  }

  private commit(ids: string[]): void {
    this.working.set(ids);
    this.selectedChange.emit(ids);
  }

  add(docId: string): void {
    if (!this.chosen().includes(docId)) {
      this.commit([...this.chosen(), docId]);
    }
  }

  remove(docId: string): void {
    this.commit(this.chosen().filter(id => id !== docId));
  }

  /** Swaps one entry with its neighbour. A no-op at either end. */
  move(index: number, delta: number): void {
    const current = this.chosen();
    const target = index + delta;

    if (index < 0 || target < 0 || index >= current.length || target >= current.length) {
      return;
    }

    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    this.commit(next);
  }

  /* ---- Drag and drop -----------------------------------------------------

     NATIVE HTML5, not @angular/cdk. This project's dependencies are Angular,
     Firebase and a font; the CDK would be the first addition to that list, for
     one panel, and the browser already implements dragging a row between lists.

     WHAT THE CDK WOULD BUY is touch support — HTML5 drag events do not fire on
     a touchscreen at all — which is exactly why the ▲▼ and ✕ buttons stay. They
     are also the only way to reorder from a keyboard, on any implementation.
     ---------------------------------------------------------------------- */

  readonly draggingId = signal('');
  readonly draggingFrom = signal<'available' | 'selected' | ''>('');

  /** Where it would land: an index to insert BEFORE, or null for the end. */
  readonly dropIndex = signal<number | null>(null);
  readonly dropOnAvailable = signal(false);

  onDragStart(event: DragEvent, docId: string, from: 'available' | 'selected'): void {
    this.draggingId.set(docId);
    this.draggingFrom.set(from);

    // REQUIRED by Firefox: a drag with an empty DataTransfer is cancelled there
    // before any dragover fires. The value is unused.
    event.dataTransfer?.setData('text/plain', docId);

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onDragEnd(): void {
    this.draggingId.set('');
    this.draggingFrom.set('');
    this.dropIndex.set(null);
    this.dropOnAvailable.set(false);
  }

  /**
   * preventDefault is what makes an element a drop target — without it the
   * browser's default handling wins and `drop` never fires at all.
   */
  onDragOverSelected(event: DragEvent, index: number | null): void {
    if (this.draggingId() === '') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.dropIndex.set(index);
    this.dropOnAvailable.set(false);
  }

  onDragOverAvailable(event: DragEvent): void {
    // Only meaningful coming FROM Selected: highlighting the left column for a
    // row that already lives there would promise something that does nothing.
    if (this.draggingFrom() !== 'selected') {
      return;
    }

    event.preventDefault();
    this.dropOnAvailable.set(true);
    this.dropIndex.set(null);
  }

  onDropSelected(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const docId = this.draggingId();
    const at = this.dropIndex();

    if (docId === '') {
      return;
    }

    // Remove first, THEN insert: the index was captured against the list before
    // the removal, so clamping to the shortened list is what makes dragging the
    // first row onto the last land it last rather than second-to-last.
    const without = this.chosen().filter(id => id !== docId);
    const target = at === null ? without.length : Math.min(at, without.length);

    this.commit([...without.slice(0, target), docId, ...without.slice(target)]);
    this.onDragEnd();
  }

  onDropAvailable(event: DragEvent): void {
    event.preventDefault();

    if (this.draggingFrom() === 'selected') {
      this.remove(this.draggingId());
    }

    this.onDragEnd();
  }

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }
}

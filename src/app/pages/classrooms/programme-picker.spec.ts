import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Timestamp } from 'firebase/firestore';

import {
  Classroom,
  ClassroomProgramme,
  ClassroomProgrammeWorkflow,
  LearningUnit,
  Programme
} from '../../models/teaching.model';
import { programmesFor } from '../../services/programme.service';
import { EditClassroom } from './edit-classroom';

/**
 * The classroom Manage Programmes picker, end to end through the component.
 *
 * WHAT THESE EXIST FOR. The picker reported "AVAILABLE 0" with "Show all
 * programmes" ticked, and there were two separate causes plus four silent ones:
 *
 *   1. show-all sourced from `term ? … : []`, so the box did the opposite of
 *      what it says until something was typed.
 *   2. programmesFor rejected any status that was not exactly 'LIVE', while the
 *      Programme table judged the same field with isActiveStatus.
 *   3-6. wrong school, wrong grade, wrong type and not-live all emptied the pane
 *      with the same wordless message.
 *
 * Each is pinned below, so a regression names itself instead of reappearing as
 * an empty box.
 */

function ts(iso: string): Timestamp {
  return Timestamp.fromDate(new Date(iso));
}

function programme(overrides: Partial<Programme> = {}): Programme {
  return {
    docId: 'prog-1',
    programmeId: 'prog-1',
    programmeName: 'Oak 26-27 Grade 8 - Science',
    programmeCode: 'P10001',
    displayName: 'Oak 26-27 Grade 8 - Science',
    programmeDescription: '',
    institutionId: 'inst-1',
    institutionName: 'Oak Valley School',
    grades: ['8'],
    age: [],
    type: 'REGULAR',
    programmeStatus: 'LIVE',
    programmeImagePath: '',
    learningUnitsIds: [],
    assignmentIds: [],
    ownerId: 'alice',
    createdAt: ts('2026-08-01T10:00:00Z'),
    updatedAt: ts('2026-08-01T10:00:00Z'),
    ...overrides
  };
}

function classroom(overrides: Partial<Classroom> = {}): Classroom {
  return {
    docId: 'cls-1',
    classroomId: 'cls-1',
    classroomCode: '001',
    type: 'CLASSROOM',
    classroomName: '8 B',
    stemClubName: '',
    grade: '8',
    section: 'B',
    board: 'CBSE',
    institutionId: 'inst-1',
    institutionName: 'Oak Valley School',
    programmes: {},
    studentCounter: 0,
    studentCredentialStoragePath: '',
    ownerId: 'alice',
    creationDate: ts('2026-08-01T10:00:00Z'),
    createdAt: ts('2026-08-01T10:00:00Z'),
    updatedAt: ts('2026-08-01T10:00:00Z'),
    ...overrides
  };
}

/** One learning unit's locking row, typed so a Timestamp date is accepted. */
function wf(overrides: Partial<ClassroomProgrammeWorkflow> = {}): ClassroomProgrammeWorkflow {
  return {
    learningUnitId: 'lu-1',
    workflowId: '',
    openAt: '',
    closeAt: '',
    workflowLocked: false,
    ...overrides
  };
}

/** An entry as it is stored on the classroom: the denormalised four fields. */
function chosen(overrides: Partial<ClassroomProgramme> = {}): ClassroomProgramme {
  return {
    programmeId: 'prog-2',
    programmeName: 'Oak 26-27 Grade 8 - Maths',
    programmeCode: 'P10002',
    displayName: 'Oak 26-27 Grade 8 - Maths',
    ...overrides
  };
}

describe('EditClassroom — Manage Programmes picker', () => {
  let fixture: ComponentFixture<EditClassroom>;
  let component: EditClassroom;

  async function open(
    target: Classroom,
    catalogue: Programme[],
    catalogueError = '',
    units: Partial<LearningUnit>[] = []
  ): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({ imports: [EditClassroom] }).compileComponents();

    fixture = TestBed.createComponent(EditClassroom);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('classroom', target);
    fixture.componentRef.setInput('programmes', catalogue);
    fixture.componentRef.setInput('catalogueError', catalogueError);
    fixture.componentRef.setInput('learningUnits', units as LearningUnit[]);
    fixture.detectChanges();
  }

  /* ---- The reported bug ------------------------------------------------- */

  /**
   * THE REGRESSION. With the box ticked and the search empty, Available was
   * hardcoded to nothing.
   */
  it('shows the catalogue when "Show all programmes" is ticked and nothing is typed', async () => {
    await open(
      // A classroom that matches nothing by default: other school, other grade.
      classroom({ institutionId: 'inst-other', institutionName: 'Elsewhere', grade: '3' }),
      [programme()]
    );

    expect(component.available().length).toBe(0);

    component.toggleShowAll();
    fixture.detectChanges();

    expect(component.showAll()).toBe(true);
    expect(component.available().length).toBe(1);
  });

  /** Show all widens school AND grade — the two gates that produce the report. */
  it('show all crosses both the school and the grade boundary', async () => {
    await open(
      classroom({ institutionId: 'inst-other', grade: '3' }),
      [
        programme({ docId: 'a', programmeId: 'a', institutionId: 'inst-other', grades: ['9'] }),
        programme({ docId: 'b', programmeId: 'b', institutionId: 'inst-far', grades: ['3'] })
      ]
    );

    expect(component.available().length).toBe(0);

    component.toggleShowAll();
    expect(component.available().map(row => row.programmeId).sort()).toEqual(['a', 'b']);
  });

  /** It does NOT drop the type guard: a club must not be offered a REGULAR one. */
  it('show all still refuses the wrong programme type', async () => {
    await open(
      classroom({ type: 'STEM-CLUB', stemClubName: 'Robotics', grade: '', section: '' }),
      [programme({ type: 'REGULAR' })]
    );

    component.toggleShowAll();

    expect(component.available().length).toBe(0);
    expect(component.emptyReason()).toContain('STEM-CLUB');
  });

  /** Nor the live guard. */
  it('show all still refuses a programme that is not live', async () => {
    await open(classroom(), [programme({ programmeStatus: 'DEVELOPEMENT' })]);

    component.toggleShowAll();

    expect(component.available().length).toBe(0);
    expect(component.emptyReason()).toContain('still in development');
  });

  /* ---- The status-comparison bug ---------------------------------------- */

  /**
   * programmesFor rejected anything but the exact string 'LIVE', so a programme
   * the Programme table showed as Active was invisible here.
   */
  it('accepts the other spellings of live that production stores', async () => {
    const lower = programme({ docId: 'a', programmeId: 'a' });
    (lower as { programmeStatus: string }).programmeStatus = 'live';
    const active = programme({ docId: 'b', programmeId: 'b' });
    (active as { programmeStatus: string }).programmeStatus = 'ACTIVE';

    await open(classroom(), [lower, active]);

    expect(component.available().length).toBe(2);
  });

  it('programmesFor agrees with the table about what live means', () => {
    const active = programme({});
    (active as { programmeStatus: string }).programmeStatus = 'ACTIVE';

    const offered = programmesFor([active], {
      institutionId: 'inst-1',
      type: 'REGULAR',
      grade: '8'
    });

    expect(offered.length).toBe(1);
  });

  /* ---- The default path works ------------------------------------------- */

  it('offers a matching programme with no filters touched', async () => {
    await open(classroom(), [programme()]);

    expect(component.available().length).toBe(1);
    expect(component.available()[0].displayName).toBe('Oak 26-27 Grade 8 - Science');
  });

  it('narrows by the search box, across name, display name and code', async () => {
    await open(classroom(), [
      programme({ docId: 'a', programmeId: 'a', programmeName: 'Science', displayName: 'Science' }),
      programme({ docId: 'b', programmeId: 'b', programmeName: 'Maths', displayName: 'Maths',
                  programmeCode: 'P10002' })
    ]);

    component.setSearch('maths');
    expect(component.available().map(row => row.programmeId)).toEqual(['b']);

    component.setSearch('P10002');
    expect(component.available().map(row => row.programmeId)).toEqual(['b']);
  });

  /* ---- Selecting and saving -------------------------------------------- */

  /**
   * The classroom stores a MAP keyed by programmeId, holding the four fields the
   * table renders. The ids are the map's keys, so the selection and the display
   * names are one write rather than two.
   */
  it('adds a programme, keyed by its id, and moves it out of Available', async () => {
    await open(classroom(), [programme()]);

    component.addProgramme(component.available()[0]);
    fixture.detectChanges();

    expect(component.selectedProgrammes().map(row => row.programmeId)).toEqual(['prog-1']);
    expect(component.available().length).toBe(0);
  });

  it('emits the programmes map on save, and nothing else about the classroom', async () => {
    await open(classroom(), [programme()]);
    component.addProgramme(component.available()[0]);

    let saved: Partial<Classroom> | undefined;
    component.saved.subscribe(patch => (saved = patch));
    component.save();

    expect(Object.keys(saved?.programmes ?? {})).toEqual(['prog-1']);
    expect(saved?.programmes?.['prog-1'].displayName).toBe('Oak 26-27 Grade 8 - Science');
    // Identity and scope fields are not the picker's to change.
    expect(saved?.institutionId).toBeUndefined();
    expect(saved?.classroomCode).toBeUndefined();
  });

  it('removes a programme and returns it to Available', async () => {
    await open(
      classroom({
        programmes: {
          'prog-1': {
            programmeId: 'prog-1',
            programmeName: 'Oak 26-27 Grade 8 - Science',
            programmeCode: 'P10001',
            displayName: 'Oak 26-27 Grade 8 - Science'
          }
        }
      }),
      [programme()]
    );

    expect(component.selectedProgrammes().length).toBe(1);
    expect(component.available().length).toBe(0);

    component.removeProgramme('prog-1');
    fixture.detectChanges();

    expect(component.selectedProgrammes().length).toBe(0);
    expect(component.available().length).toBe(1);
  });

  /* ---- The diagnosis --------------------------------------------------- */

  it('names an empty catalogue rather than showing a bare zero', async () => {
    await open(classroom(), []);

    expect(component.emptyReason()).toContain('No programmes exist yet');
  });

  it('reports a failed catalogue read instead of claiming none exist', async () => {
    await open(classroom(), [], 'Could not load the programme catalogue.');

    expect(component.emptyReason()).toBe('Could not load the programme catalogue.');
  });

  it('names the wrong school, and points at the fix', async () => {
    await open(classroom(), [programme({ institutionId: 'inst-other' })]);

    expect(component.emptyReason()).toContain('Oak Valley School');
    expect(component.emptyReason()).toContain('Show all programmes');
  });

  it('names the wrong grade, and points at the fix', async () => {
    await open(classroom({ grade: '3' }), [programme({ grades: ['8'] })]);

    expect(component.emptyReason()).toContain('grade 3');
    expect(component.emptyReason()).toContain('Show all programmes');
  });

  it('says so when everything matching is already selected', async () => {
    await open(
      classroom({
        programmes: {
          'prog-1': {
            programmeId: 'prog-1', programmeName: 'x', programmeCode: 'P1', displayName: 'x'
          }
        }
      }),
      [programme()]
    );

    expect(component.emptyReason()).toContain('already selected');
  });

  it('says so when only the search term is hiding them', async () => {
    await open(classroom(), [programme()]);

    component.setSearch('zzz');

    expect(component.emptyReason()).toContain('zzz');
  });
  /* ---- Drag and drop --------------------------------------------------- */

  /**
   * Dispatched through the DOM rather than by calling the handlers, so the
   * draggable attributes and the bindings are covered too. jsdom has no
   * DataTransfer, so a minimal stand-in is attached: the component reads the id
   * from its own signal and treats dataTransfer as optional precisely because it
   * cannot be relied on.
   */
  function stubTransfer(): { effectAllowed: string; dropEffect: string; data: Record<string, string> } {
    return { effectAllowed: '', dropEffect: '', data: {} };
  }

  function dragEvent(type: string, transfer: ReturnType<typeof stubTransfer>): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });

    Object.defineProperty(event, 'dataTransfer', {
      value: {
        setData: (format: string, value: string) => { transfer.data[format] = value; },
        getData: (format: string) => transfer.data[format] ?? '',
        set effectAllowed(value: string) { transfer.effectAllowed = value; },
        get effectAllowed() { return transfer.effectAllowed; },
        set dropEffect(value: string) { transfer.dropEffect = value; },
        get dropEffect() { return transfer.dropEffect; }
      }
    });

    return event;
  }

  function pane(which: 'available' | 'selected'): HTMLElement {
    const panes = fixture.nativeElement.querySelectorAll('.pane');
    return (which === 'available' ? panes[0] : panes[1]) as HTMLElement;
  }

  /** Both panes render CARDS: bordered on all four sides, names wrapping. */
  function rows(which: 'available' | 'selected'): HTMLElement[] {
    return Array.from(pane(which).querySelectorAll('.prog-card'));
  }

  it('marks both panes\' cards as draggable', async () => {
    await open(classroom({ programmes: { 'prog-2': chosen() } }), [programme()]);

    expect(rows('available')[0].getAttribute('draggable')).toBe('true');
    expect(rows('selected')[0].getAttribute('draggable')).toBe('true');
  });

  it('adds a programme dragged from Available onto Selected', async () => {
    await open(classroom(), [programme()]);

    const transfer = stubTransfer();
    rows('available')[0].dispatchEvent(dragEvent('dragstart', transfer));
    fixture.detectChanges();

    expect(component.dragging()).toEqual({ programmeId: 'prog-1', from: 'available' });
    // The payload rides along, even though the component does not depend on it.
    expect(transfer.data['text/plain']).toBe('prog-1');

    pane('selected').dispatchEvent(dragEvent('dragover', transfer));
    fixture.detectChanges();
    expect(component.dropTarget()).toBe('selected');

    pane('selected').dispatchEvent(dragEvent('drop', transfer));
    fixture.detectChanges();

    expect(component.selectedProgrammes().map(row => row.programmeId)).toEqual(['prog-1']);
    expect(component.available().length).toBe(0);
    // The drag state is cleared, so no stale highlight survives the drop.
    expect(component.dragging()).toBeNull();
    expect(component.dropTarget()).toBeNull();
  });

  it('removes a programme dragged from Selected onto Available', async () => {
    // The map KEY and the entry's own programmeId must agree, as addProgramme
    // always makes them: removeProgramme deletes by key.
    await open(
      classroom({ programmes: { 'prog-1': chosen({ programmeId: 'prog-1' }) } }),
      [programme()]
    );

    const transfer = stubTransfer();
    rows('selected')[0].dispatchEvent(dragEvent('dragstart', transfer));
    pane('available').dispatchEvent(dragEvent('dragover', transfer));
    pane('available').dispatchEvent(dragEvent('drop', transfer));
    fixture.detectChanges();

    expect(component.selectedProgrammes().length).toBe(0);
    expect(component.available().map(row => row.programmeId)).toEqual(['prog-1']);
  });

  /**
   * A pane refuses a drag that started in it. preventDefault is what opts a drop
   * target in, so NOT calling it is the refusal — asserted on defaultPrevented
   * rather than on the outcome, because the outcome of a no-op is invisible.
   */
  it('refuses a drop back into the pane the row came from', async () => {
    await open(classroom(), [programme()]);

    const transfer = stubTransfer();
    rows('available')[0].dispatchEvent(dragEvent('dragstart', transfer));

    const over = dragEvent('dragover', transfer);
    pane('available').dispatchEvent(over);

    expect(over.defaultPrevented).toBe(false);
    expect(component.dropTarget()).toBeNull();

    pane('available').dispatchEvent(dragEvent('drop', transfer));
    fixture.detectChanges();

    expect(component.selectedProgrammes().length).toBe(0);
  });

  it('accepts the drop the other way round, so the panes are not both closed', async () => {
    await open(classroom(), [programme()]);

    const transfer = stubTransfer();
    rows('available')[0].dispatchEvent(dragEvent('dragstart', transfer));

    const over = dragEvent('dragover', transfer);
    pane('selected').dispatchEvent(over);

    expect(over.defaultPrevented).toBe(true);
    expect(transfer.dropEffect).toBe('move');
  });

  it('ignores a drop with no drag in progress', async () => {
    await open(classroom(), [programme()]);

    pane('selected').dispatchEvent(dragEvent('drop', stubTransfer()));
    fixture.detectChanges();

    expect(component.selectedProgrammes().length).toBe(0);
  });

  it('clears the highlight when the pointer leaves the pane', async () => {
    await open(classroom(), [programme()]);

    const transfer = stubTransfer();
    rows('available')[0].dispatchEvent(dragEvent('dragstart', transfer));
    pane('selected').dispatchEvent(dragEvent('dragover', transfer));
    expect(component.dropTarget()).toBe('selected');

    pane('selected').dispatchEvent(dragEvent('dragleave', transfer));
    expect(component.dropTarget()).toBeNull();
  });

  it('clears the drag state when the drag is abandoned', async () => {
    await open(classroom(), [programme()]);

    const transfer = stubTransfer();
    rows('available')[0].dispatchEvent(dragEvent('dragstart', transfer));
    rows('available')[0].dispatchEvent(dragEvent('dragend', transfer));

    expect(component.dragging()).toBeNull();
    expect(component.dropTarget()).toBeNull();
  });

  /**
   * A dropped id is resolved against candidates(), which has already passed the
   * type and live guards. So even a forged drop cannot add what the buttons
   * refuse.
   */
  it('will not add a programme of the wrong type on drop', async () => {
    await open(
      classroom({ type: 'STEM-CLUB', stemClubName: 'Robotics', grade: '', section: '' }),
      [programme({ type: 'REGULAR' })]
    );

    component.dragging.set({ programmeId: 'prog-1', from: 'available' });
    pane('selected').dispatchEvent(dragEvent('drop', stubTransfer()));
    fixture.detectChanges();

    expect(component.selectedProgrammes().length).toBe(0);
  });

  /* ---- Keyboard --------------------------------------------------------- */

  /** The row is a div now, so Enter and Space have to be wired by hand. */
  it('adds a programme with Enter on a focused row', async () => {
    await open(classroom(), [programme()]);

    rows('available')[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    fixture.detectChanges();

    expect(component.selectedProgrammes().map(row => row.programmeId)).toEqual(['prog-1']);
  });

  it('adds a programme with Space, and stops the pane scrolling', async () => {
    await open(classroom(), [programme()]);

    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    rows('available')[0].dispatchEvent(event);
    fixture.detectChanges();

    expect(component.selectedProgrammes().map(row => row.programmeId)).toEqual(['prog-1']);
    expect(event.defaultPrevented).toBe(true);
  });

  /** Still clickable. The div kept role=button and an accessible name. */
  it('keeps the row clickable, with a name a screen reader can read', async () => {
    await open(classroom(), [programme()]);

    const row = rows('available')[0];
    expect(row.getAttribute('role')).toBe('button');
    expect(row.getAttribute('tabindex')).toBe('0');
    expect(row.getAttribute('aria-label')).toBe('Add Oak 26-27 Grade 8 - Science');

    row.click();
    fixture.detectChanges();

    expect(component.selectedProgrammes().length).toBe(1);
  });
  /* ---- Save Changes is shut until the selection changes ------------------ */

  function saveButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('.modal-foot .save-btn') as HTMLButtonElement;
  }

  it('opens with Save Changes disabled', async () => {
    await open(classroom(), [programme()]);

    expect(component.dirty()).toBe(false);
    expect(saveButton().disabled).toBe(true);
  });

  /**
   * The things that must NOT enable it. Save Changes is gated on the SELECTION
   * changing, not on the pane being touched: searching and ticking Show all
   * change what is displayed and nothing that is stored.
   */
  it('stays disabled while only the view is changed', async () => {
    await open(classroom(), [programme()]);

    component.setSearch('science');
    fixture.detectChanges();
    expect(saveButton().disabled).toBe(true);

    component.toggleShowAll();
    fixture.detectChanges();
    expect(saveButton().disabled).toBe(true);

    component.setSearch('');
    fixture.detectChanges();
    expect(saveButton().disabled).toBe(true);
    expect(component.dirty()).toBe(false);
  });

  it('enables Save Changes once a programme is dragged in', async () => {
    await open(classroom(), [programme()]);

    const transfer = stubTransfer();
    rows('available')[0].dispatchEvent(dragEvent('dragstart', transfer));
    pane('selected').dispatchEvent(dragEvent('dragover', transfer));
    pane('selected').dispatchEvent(dragEvent('drop', transfer));
    fixture.detectChanges();

    expect(component.dirty()).toBe(true);
    expect(saveButton().disabled).toBe(false);
  });

  /**
   * Dragged in and dragged back out is not a change. dirty compares the selected
   * ID SET against the stored one, so an undone drag shuts the button again
   * rather than leaving it live over a selection that matches Firestore.
   */
  it('disables it again when the drag is undone', async () => {
    await open(classroom(), [programme()]);

    const inbound = stubTransfer();
    rows('available')[0].dispatchEvent(dragEvent('dragstart', inbound));
    pane('selected').dispatchEvent(dragEvent('drop', inbound));
    fixture.detectChanges();

    const outbound = stubTransfer();
    rows('selected')[0].dispatchEvent(dragEvent('dragstart', outbound));
    pane('available').dispatchEvent(dragEvent('drop', outbound));
    fixture.detectChanges();

    expect(component.dirty()).toBe(false);
    expect(saveButton().disabled).toBe(true);
  });

  it('enables it when an already-saved programme is dragged out', async () => {
    await open(
      classroom({ programmes: { 'prog-1': chosen({ programmeId: 'prog-1' }) } }),
      [programme()]
    );

    expect(saveButton().disabled).toBe(true);

    const transfer = stubTransfer();
    rows('selected')[0].dispatchEvent(dragEvent('dragstart', transfer));
    pane('available').dispatchEvent(dragEvent('drop', transfer));
    fixture.detectChanges();

    expect(component.dirty()).toBe(true);
    expect(saveButton().disabled).toBe(false);
  });

  /** Same rule for the buttons, since they do the same thing. */
  it('enables it from the row button too', async () => {
    await open(classroom(), [programme()]);

    rows('available')[0].click();
    fixture.detectChanges();

    expect(saveButton().disabled).toBe(false);
  });
  /* ---- Locking details, through the picker ------------------------------ */

  function lockButton(): HTMLButtonElement {
    return pane('selected').querySelector('.prog-edit') as HTMLButtonElement;
  }

  it('offers a locking button on each selected programme', async () => {
    await open(
      classroom({ programmes: { 'prog-1': chosen({ programmeId: 'prog-1' }) } }),
      [programme()]
    );

    expect(lockButton()).not.toBeNull();
    expect(lockButton().getAttribute('aria-label'))
      .toBe('Edit locking details for Oak 26-27 Grade 8 - Maths');
    // Not open until it is asked for.
    expect(fixture.nativeElement.querySelector('app-programme-locking')).toBeNull();
  });

  it('opens the locking dialog for that programme, with its learning units', async () => {
    await open(
      classroom({ programmes: { 'prog-1': chosen({ programmeId: 'prog-1' }) } }),
      [programme({ learningUnitsIds: ['lu-1', 'lu-2'] })],
      '',
      [
        { docId: 'lu-1', learningUnitId: 'lu-1', learningUnitName: 'Squares' },
        { docId: 'lu-2', learningUnitId: 'lu-2', learningUnitName: 'Card Sorting' }
      ]
    );

    lockButton().click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-programme-locking')).not.toBeNull();
    expect(component.lockingUnits().map(unit => unit.name)).toEqual(['Squares', 'Card Sorting']);
  });

  /**
   * The units are listed in the PROGRAMME's order, because the locks are stored
   * positionally against learningUnitsIds. A unit missing from the catalogue
   * still gets a slot, labelled with its id, rather than shifting the rest up.
   */
  it('keeps the programme order and does not drop an unknown unit', async () => {
    await open(
      classroom({ programmes: { 'prog-1': chosen({ programmeId: 'prog-1' }) } }),
      [programme({ learningUnitsIds: ['lu-2', 'lu-gone', 'lu-1'] })],
      '',
      [
        { docId: 'lu-1', learningUnitId: 'lu-1', learningUnitName: 'Squares' },
        { docId: 'lu-2', learningUnitId: 'lu-2', learningUnitName: 'Card Sorting' }
      ]
    );

    lockButton().click();

    expect(component.lockingUnits().map(unit => unit.learningUnitId))
      .toEqual(['lu-2', 'lu-gone', 'lu-1']);
    expect(component.lockingUnits().map(unit => unit.name))
      .toEqual(['Card Sorting', 'lu-gone', 'Squares']);
  });

  /**
   * THE INTEGRATION THAT WAS BROKEN. Locking details change an entry without
   * changing which programmes are selected, and dirty compared only the id set —
   * so Save Changes stayed shut over an edit that could never be written.
   */
  it('marks the classroom dirty for a locking change, and saves it', async () => {
    await open(
      classroom({ programmes: { 'prog-1': chosen({ programmeId: 'prog-1' }) } }),
      [programme({ learningUnitsIds: ['lu-1'] })],
      '',
      [{ docId: 'lu-1', learningUnitId: 'lu-1', learningUnitName: 'Squares' }]
    );

    expect(saveButton().disabled).toBe(true);

    component.openLocking('prog-1');
    component.applyLocking({
      sequentiallyLocked: true,
      workflowIds: [wf({ workflowLocked: true })]
    });
    fixture.detectChanges();

    expect(component.dirty()).toBe(true);
    expect(saveButton().disabled).toBe(false);
    // And it closed itself.
    expect(fixture.nativeElement.querySelector('app-programme-locking')).toBeNull();

    let saved: Partial<Classroom> | undefined;
    component.saved.subscribe(patch => (saved = patch));
    component.save();

    const entry = saved!.programmes!['prog-1'];

    expect(entry.sequentiallyLocked).toBe(true);
    expect(entry.workflowIds!.length).toBe(1);
    expect(entry.workflowIds![0].workflowLocked).toBe(true);
    // The four catalogue fields are still there: locks are added, not swapped in.
    expect(entry.displayName).toBe('Oak 26-27 Grade 8 - Maths');
    expect(entry.programmeCode).toBe('P10002');
  });

  it('shows on the card that a programme carries locking details', async () => {
    await open(
      classroom({
        programmes: {
          'prog-1': {
            ...chosen({ programmeId: 'prog-1' }),
            sequentiallyLocked: true
          }
        }
      }),
      [programme()]
    );

    expect(lockButton().classList.contains('is-set')).toBe(true);

    expect(component.hasLocking({ ...chosen(), sequentiallyLocked: false })).toBe(false);
    expect(component.hasLocking({
      ...chosen(),
      workflowIds: [wf({ openAt: Timestamp.fromDate(new Date(2026, 8, 1)) })]
    })).toBe(true);
  });

  /** A locking change that changes nothing leaves Save Changes shut. */
  it('stays clean when the locking dialog hands back what was already stored', async () => {
    const stored = {
      ...chosen({ programmeId: 'prog-1' }),
      sequentiallyLocked: false,
      workflowIds: [wf({ openAt: Timestamp.fromDate(new Date(2026, 8, 1, 9, 30)) })]
    };

    await open(classroom({ programmes: { 'prog-1': stored } }), [programme()]);

    component.openLocking('prog-1');
    component.applyLocking({
      sequentiallyLocked: false,
      // A DIFFERENT Timestamp object for the same instant, as a Firestore read
      // would produce.
      workflowIds: [wf({ openAt: Timestamp.fromDate(new Date(2026, 8, 1, 9, 30)) })]
    });
    fixture.detectChanges();

    expect(component.dirty()).toBe(false);
    expect(saveButton().disabled).toBe(true);
  });
});

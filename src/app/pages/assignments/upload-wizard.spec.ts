import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UploadAssignment, UploadSlot } from '../../models/teaching.model';
import { AuthService } from '../../services/auth.service';
import { UPLOAD_STEPS, UploadWizard } from './upload-wizard';

/**
 * Create Upload Assignment — the three-step wizard.
 *
 * WHAT IS WORTH TESTING HERE, and it is not the markup. Four things in this
 * component are quiet when wrong, and each produces a document that looks saved:
 *
 *   1. THE SLOT SHAPE. Production's current dialog writes exactly ten keys per
 *      slot. An extra one is harmless; a MISSING one is a slot its player cannot
 *      render, and `undefined` on any of them fails the whole write.
 *   2. `uploadFileType` STORES THE CODE, uppercase. The select shows 'Image' and
 *      the document must say 'IMAGE' — production's own legacy row uses lowercase,
 *      which is what makes this worth pinning.
 *   3. `submissionId` IS POSITIONAL. Production reads it to order the slots, so a
 *      gap left by a removal puts them out of order.
 *   4. THE EDIT PREFILL COPIES. The slots arrive on a signal input and are the
 *      rows the table is rendering; editing them in place would show unsaved
 *      changes in the list and survive a cancel.
 */

class StubAuthService {
  displayName(): string {
    return 'Santosh Kanta';
  }
}

/** The ten keys production's current dialog writes on every slot. */
const SLOT_KEYS = [
  'title',
  'instructions',
  'maxFileSize',
  'maxNoOfUploads',
  'uploadFileType',
  'submissionId',
  'resourcePath',
  'durationInHours',
  'durationInMinutes',
  'durationInSeconds'
];

async function mount(existing: UploadAssignment | null = null): Promise<{
  fixture: ComponentFixture<UploadWizard>;
  component: UploadWizard;
  saved: UploadAssignment[];
}> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [UploadWizard],
    providers: [{ provide: AuthService, useValue: new StubAuthService() }]
  }).compileComponents();

  const fixture = TestBed.createComponent(UploadWizard);
  const component = fixture.componentInstance;
  const saved: UploadAssignment[] = [];

  fixture.componentRef.setInput('assignment', existing);
  component.submitted.subscribe(draft => saved.push(draft as UploadAssignment));
  fixture.detectChanges();

  return { fixture, component, saved };
}

/** Fills step 1 so the wizard can advance. */
function fillBasics(component: UploadWizard): void {
  component.displayName.set('Observation Sheet');
  component.author.set('Madhukar N P');
  component.status.set('LIVE');
}

/**
 * Fills the three fields a slot needs before step two will pass.
 *
 * A HELPER RATHER THAN A TITLE, because a slot now opens with no file type and
 * no size — production's own behaviour — and every save test needs all three.
 */
function fillSlot(component: UploadWizard, index: number, title: string): void {
  component.setSlotTitle(index, title);
  component.setSlotFileType(index, 'IMAGE');
  component.setSlotMaxSize(index, '10');
}

/** A stored upload, shaped like a real production document. */
function storedUpload(overrides: Partial<UploadAssignment> = {}): UploadAssignment {
  return {
    docId: 'u1',
    displayName: 'JNV DBU - Magnetic Pen Stand Observation Sheet',
    type: 'UPLOAD',
    status: 'LIVE',
    creator: 'Anany Ranjan',
    author: 'Madhukar N P',
    ownerId: 'uid',
    createdAt: null,
    updatedAt: null,
    duration: '',
    numberOfAllowedSubmissions: 84,
    totalDurationInHours: 23,
    totalDurationInMinutes: 59,
    totalDurationInSeconds: 59,
    assignments: [
      {
        title: 'Magnetic Pen Stand - Observation Sheet',
        instructions: '<p><strong>Please upload the observation sheet</strong></p>',
        maxFileSize: 10,
        maxNoOfUploads: '1',
        uploadFileType: 'IMAGE',
        submissionId: 1,
        resourcePath: '',
        durationInHours: 23,
        durationInMinutes: 59,
        durationInSeconds: 59
      }
    ],
    ...overrides
  } as UploadAssignment;
}

/** Walks a value tree for `undefined` at any depth. Firestore rejects all of them. */
function findUndefined(value: unknown, path = '$'): string[] {
  if (value === undefined) {
    return [path];
  }

  if (value === null || typeof value !== 'object') {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findUndefined(entry, `${path}[${index}]`));
  }

  return Object.entries(value).flatMap(([key, entry]) =>
    findUndefined(entry, `${path}.${key}`)
  );
}

describe('UploadWizard', () => {

  it('opens on step one with one slot', async () => {
    const { component } = await mount();

    expect(component.step()).toBe(1);
    expect(component.slots().length).toBe(1);
    expect(UPLOAD_STEPS.length).toBe(3);
  });

  /**
   * ZERO, ON INSTRUCTION, and pinned BECAUSE production disagrees: every recent
   * upload document there carries 23/59/59, so anyone comparing the two would
   * reasonably "correct" this back and silently reintroduce a duration nobody set.
   */
  it('opens every duration at zero', async () => {
    const { component } = await mount();

    expect(component.totalDurationInHours()).toBe(0);
    expect(component.totalDurationInMinutes()).toBe(0);
    expect(component.totalDurationInSeconds()).toBe(0);

    const slot = component.slots()[0];
    expect(slot.durationInHours).toBe(0);
    expect(slot.durationInMinutes).toBe(0);
    expect(slot.durationInSeconds).toBe(0);
  });

  /**
   * A NEW SLOT OFFERS NO FILE TYPE AND NO SIZE, which is production's own dialog
   * and matters more than it looks: the type caps the size and decides what a
   * student may attach, so defaulting it would make a real choice on their
   * behalf, and there is no sensible size to suggest before it is picked.
   *
   * One allowed upload IS production's opening value and stays.
   */
  it('opens a new slot with no file type and no size', async () => {
    const { component } = await mount();
    const slot = component.slots()[0];

    expect(slot.uploadFileType).toBe('');
    expect(slot.maxFileSize).toBe('');
    expect(slot.maxNoOfUploads).toBe(1);
  });

  it('takes the creator from the signed-in user and does not let it be typed', async () => {
    const { component } = await mount();

    expect(component.creator()).toBe('Santosh Kanta');
  });

  /** An edit keeps the ORIGINAL creator: it records who made the assignment. */
  it('keeps the stored creator when editing', async () => {
    const { component } = await mount(storedUpload());

    expect(component.creator()).toBe('Anany Ranjan');
  });

  describe('navigation', () => {

    it('will not advance past step one until the required fields are filled', async () => {
      const { component } = await mount();

      expect(component.continueBlocked()).toBe(true);

      component.next();
      expect(component.step()).toBe(1);

      fillBasics(component);
      expect(component.continueBlocked()).toBe(false);

      component.next();
      expect(component.step()).toBe(2);
    });

    /** Status opens unselected, and that alone must block Next. */
    it('blocks step one while the status is unselected', async () => {
      const { component } = await mount();

      component.displayName.set('A');
      component.author.set('B');
      expect(component.continueBlocked()).toBe(true);

      component.status.set('LIVE');
      expect(component.continueBlocked()).toBe(false);
    });

    /**
     * THREE FIELDS, not one. The file type is the one worth spelling out: a slot
     * opens unselected because the type caps the size and decides what a student
     * may attach, and a slot saved without one accepts nothing.
     */
    it('blocks step two until every slot has a title, a type and a size', async () => {
      const { component } = await mount();

      fillBasics(component);
      component.next();

      expect(component.continueBlocked()).toBe(true);

      component.setSlotTitle(0, 'Upload the sheet');
      expect(component.continueBlocked()).toBe(true);

      component.setSlotFileType(0, 'IMAGE');
      expect(component.continueBlocked()).toBe(true);

      component.setSlotMaxSize(0, '10');
      expect(component.continueBlocked()).toBe(false);

      // A second slot with none of the three blocks it again.
      component.addSlot();
      expect(component.continueBlocked()).toBe(true);
    });
  });

  describe('the slot strip', () => {

    it('adds a slot and opens it', async () => {
      const { component } = await mount();

      component.addSlot();

      expect(component.slots().length).toBe(2);
      expect(component.activeSlot()).toBe(1);
      expect(component.slots()[1].submissionId).toBe(2);
    });

    /**
     * `submissionId` IS POSITIONAL — production reads it to order the slots, so
     * removing the middle one must renumber the rest rather than leave 1 and 3.
     */
    it('renumbers submissionId after a removal', async () => {
      const { component } = await mount();

      component.setSlotTitle(0, 'first');
      component.addSlot();
      component.setSlotTitle(1, 'second');
      component.addSlot();
      component.setSlotTitle(2, 'third');

      component.removeSlot(1);

      expect(component.slots().map(slot => slot.title)).toEqual(['first', 'third']);
      expect(component.slots().map(slot => slot.submissionId)).toEqual([1, 2]);
    });

    /** Zero slots is not a valid upload, and step two would have nothing to show. */
    it('refuses to remove the last slot', async () => {
      const { component } = await mount();

      component.removeSlot(0);

      expect(component.slots().length).toBe(1);
    });

    it('keeps the active tab in range after removing the last slot', async () => {
      const { component } = await mount();

      component.addSlot();
      expect(component.activeSlot()).toBe(1);

      component.removeSlot(1);

      expect(component.slots().length).toBe(1);
      expect(component.activeSlot()).toBe(0);
    });

    /**
     * REPLACED, NOT MUTATED. The template reads `slots()`, and an assignment into
     * the stored object is a change the signal never announces — under zoneless
     * change detection the edit simply would not appear.
     */
    it('replaces the slot object on every edit', async () => {
      const { component } = await mount();

      const before = component.slots()[0];
      component.setSlotTitle(0, 'changed');

      expect(component.slots()[0]).not.toBe(before);
      expect(before.title).toBe('');
    });

    it('clamps the numeric fields rather than storing NaN', async () => {
      const { component } = await mount();

      component.setSlotMinutes(0, '999');
      component.setSlotSeconds(0, '');
      component.setSlotMaxSize(0, '0');
      component.setSlotMaxUploads(0, 'abc');

      const slot = component.slots()[0];
      expect(slot.durationInMinutes).toBe(59);
      expect(slot.durationInSeconds).toBe(0);
      expect(slot.maxFileSize).toBe(1);
      expect(slot.maxNoOfUploads).toBe(1);
    });

    /**
     * THE SIZE CAP FOLLOWS THE TYPE — production's own limits: 200mb for a video,
     * 20 for an image, 40 for anything else.
     */
    it('caps the size by the chosen type', async () => {
      const { component } = await mount();

      component.setSlotFileType(0, 'VIDEO');
      component.setSlotMaxSize(0, '500');
      expect(component.slots()[0].maxFileSize).toBe(200);

      component.setSlotFileType(0, 'PDF');
      expect(component.sizeCap(component.slots()[0])).toBe(40);

      component.setSlotMaxSize(0, '999');
      expect(component.slots()[0].maxFileSize).toBe(40);
    });

    /**
     * CHANGING THE TYPE RE-CAPS A SIZE THAT NO LONGER FITS. Video at 200mb then
     * switched to Image would otherwise leave 200 on a slot whose ceiling is 20 —
     * past the field's own max, so nothing on screen would say so.
     */
    it('shrinks an oversized value when the type changes', async () => {
      const { component } = await mount();

      component.setSlotFileType(0, 'VIDEO');
      component.setSlotMaxSize(0, '200');

      component.setSlotFileType(0, 'IMAGE');

      expect(component.slots()[0].maxFileSize).toBe(20);
    });

    /** Clearing the field to retype must not snap to 1 on the first keystroke. */
    it('lets the size be cleared', async () => {
      const { component } = await mount();

      component.setSlotMaxSize(0, '12');
      component.setSlotMaxSize(0, '');

      expect(component.slots()[0].maxFileSize).toBe('');
    });

    /** Production's rule is `i > 0`: the first slot has no Remove. */
    it('offers Remove past the first slot only', async () => {
      const { component } = await mount();

      expect(component.canRemove(0)).toBe(false);

      component.addSlot();
      expect(component.canRemove(1)).toBe(true);

      component.removeSlot(0);
      expect(component.slots().length).toBe(2);
    });

    /** A slot can only wait for ones BEFORE it. */
    it('offers only earlier slots as dependencies', async () => {
      const { component } = await mount();

      component.addSlot();
      component.addSlot();

      expect(component.dependencyOptions(0)).toEqual([]);
      expect(component.dependencyOptions(2)).toEqual([
        { value: 0, label: '1' },
        { value: 1, label: '2' }
      ]);
    });

    /**
     * REMOVING A SLOT REWRITES THE DEPENDENCIES, and this is the one that is easy
     * to miss: they hold POSITIONS, so dropping slot 2 leaves every later slot
     * pointing one place too high — waiting for the wrong predecessor, or for one
     * that no longer exists.
     */
    it('renumbers dependencies after a removal', async () => {
      const { component } = await mount();

      component.addSlot();
      component.addSlot();
      component.addSlot();

      // Slot 4 waits for slots 1 and 3 (indices 0 and 2).
      component.toggleDependency(3, 0, true);
      component.toggleDependency(3, 2, true);
      expect(component.slots()[3].dependentOnStepNumbers).toEqual([0, 2]);

      // Remove slot 2 (index 1): index 0 stays, index 2 becomes 1.
      component.removeSlot(1);

      expect(component.slots().length).toBe(3);
      expect(component.slots()[2].dependentOnStepNumbers).toEqual([0, 1]);
    });

    /**
     * THROUGH THE DOM, not by calling the method — which is the whole point of
     * this one.
     *
     * The checkbox lives in a @for over the dependency options, nested inside the
     * @for over the slots. Angular has no `$parent`, so `$index` inside the inner
     * loop is the OPTION's index, and the handler was reading it as the slot's:
     * every dependency was written onto slot 0. The strip showed the right slot,
     * the checkbox ticked, and only the saved document disagreed.
     *
     * Every test above calls toggleDependency directly and passes regardless, so
     * none of them could see it. A browser did.
     */
    it('writes a dependency ticked in the DOM onto the right slot', async () => {
      const { fixture, component } = await mount();
      const el = fixture.nativeElement as HTMLElement;

      fillBasics(component);
      fillSlot(component, 0, 'first');
      component.next();
      component.addSlot();
      fillSlot(component, 1, 'second');
      fixture.detectChanges();

      expect(component.activeSlot()).toBe(1);

      const box = el.querySelector('.uw-dep input') as HTMLInputElement;
      expect(box).not.toBeNull();

      box.checked = true;
      box.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      // On the SECOND slot, waiting for the first — not on slot 0.
      expect(component.slots()[1].dependentOnStepNumbers).toEqual([0]);
      expect(component.slots()[0].dependentOnStepNumbers).toBeUndefined();
    });

    /**
     * The same trap for the plain fields: every input in the slot body sits beside
     * that nested loop, so a stray `$index` would write to the wrong slot.
     */
    it('writes a title typed in the DOM onto the active slot', async () => {
      const { fixture, component } = await mount();
      const el = fixture.nativeElement as HTMLElement;

      fillBasics(component);
      fillSlot(component, 0, 'first');
      component.next();
      component.addSlot();
      fixture.detectChanges();

      const input = el.querySelector('#uw-title-1') as HTMLInputElement;
      expect(input).not.toBeNull();

      input.value = 'typed into slot two';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(component.slots()[1].title).toBe('typed into slot two');
      expect(component.slots()[0].title).toBe('first');
    });

    /** A dependency on the removed slot itself is dropped, not shifted. */
    it('drops a dependency on the slot that was removed', async () => {
      const { component } = await mount();

      component.addSlot();
      component.addSlot();

      component.toggleDependency(2, 1, true);
      expect(component.dependsOn(component.slots()[2], 1)).toBe(true);

      component.removeSlot(1);

      expect(component.slots()[1].dependentOnStepNumbers).toEqual([]);
    });

    /** The tab falls back to a number, so an untitled slot is still reachable. */
    it('captions an untitled slot by its position', async () => {
      const { component } = await mount();

      expect(component.slotCaption(component.slots()[0], 0)).toBe('Slot 1');

      component.setSlotTitle(0, 'Named');
      expect(component.slotCaption(component.slots()[0], 0)).toBe('Named');
    });
  });

  /**
   * WHY NEXT IS REFUSING.
   *
   * Step two shows one slot at a time, so a fourth slot filled in while the third
   * is empty leaves a complete slot on screen and a dead Next button — reported
   * as "this save is disabled", and correctly so: nothing said which slot or what
   * it wanted.
   */
  describe('the blocked reason', () => {

    it('says nothing while every slot is complete', async () => {
      const { component } = await mount();

      fillBasics(component);
      component.next();
      fillSlot(component, 0, 'done');

      expect(component.blockedReason()).toBe('');
      expect(component.continueBlocked()).toBe(false);
    });

    it('lists everything one slot is missing', async () => {
      const { component } = await mount();

      fillBasics(component);
      component.next();

      expect(component.blockedReason())
        .toBe('Slot 1 needs a title, a file type and a max size.');
    });

    /** The list shrinks as the fields are filled, so it stays accurate. */
    it('narrows as the slot is filled in', async () => {
      const { component } = await mount();

      fillBasics(component);
      component.next();

      component.setSlotTitle(0, 'Send it');
      expect(component.blockedReason())
        .toBe('Send it needs a file type and a max size.');

      component.setSlotFileType(0, 'IMAGE');
      expect(component.blockedReason()).toBe('Send it needs a max size.');

      component.setSlotMaxSize(0, '10');
      expect(component.blockedReason()).toBe('');
    });

    /**
     * THE REPORTED CASE: four slots, the third left empty, the fourth complete
     * and on screen. The message must name the THIRD.
     */
    it('names the offending slot when a later one is complete and showing', async () => {
      const { component } = await mount();

      fillBasics(component);
      component.next();

      fillSlot(component, 0, 'spanish');
      component.addSlot();
      fillSlot(component, 1, 'spanish dance');
      component.addSlot();
      // Slot 3 deliberately left empty.
      component.addSlot();
      fillSlot(component, 3, 'spain beauty');

      expect(component.activeSlot()).toBe(3);
      expect(component.continueBlocked()).toBe(true);
      expect(component.blockedReason())
        .toBe('Slot 3 needs a title, a file type and a max size.');
      expect(component.alsoIncomplete()).toBe(0);
    });

    it('counts the others when more than one is unfinished', async () => {
      const { component } = await mount();

      fillBasics(component);
      component.next();
      component.addSlot();
      component.addSlot();

      expect(component.alsoIncomplete()).toBe(2);
    });

    /** The message is a shortcut: it opens the slot it names. */
    it('jumps to the slot it names', async () => {
      const { component } = await mount();

      fillBasics(component);
      component.next();

      fillSlot(component, 0, 'one');
      component.addSlot();
      component.addSlot();
      fillSlot(component, 2, 'three');

      expect(component.activeSlot()).toBe(2);

      component.goToBlocking();

      expect(component.activeSlot()).toBe(1);
    });

    /** The strip marks the unfinished tabs, so the reader can see which. */
    it('marks an unfinished slot for the strip', async () => {
      const { component } = await mount();

      expect(component.isIncomplete(component.slots()[0])).toBe(true);

      fillSlot(component, 0, 'done');

      expect(component.isIncomplete(component.slots()[0])).toBe(false);
    });

    /** Only on step two: it explains that step's Next and nothing else. */
    it('says nothing on the other steps', async () => {
      const { component } = await mount();

      expect(component.step()).toBe(1);
      expect(component.blockedReason()).toBe('');
    });
  });

  describe('the edit prefill', () => {

    /**
     * ngOnInit, not the constructor: a signal input is not bound until after
     * construction, so a constructor read sees null and opens an empty dialog
     * over a real document — which the first save then overwrites with nothing.
     */
    it('loads the stored assignment', async () => {
      const { component } = await mount(storedUpload());

      expect(component.isEdit()).toBe(true);
      expect(component.heading()).toBe('Edit Upload Assignment');
      expect(component.saveLabel()).toBe('Update Assignment');
      expect(component.displayName())
        .toBe('JNV DBU - Magnetic Pen Stand Observation Sheet');
      expect(component.author()).toBe('Madhukar N P');
      expect(component.status()).toBe('LIVE');
      expect(component.numberOfAllowedSubmissions()).toBe(84);
      expect(component.slots().length).toBe(1);
    });

    /** '1' is what one of production's real slots holds. It has to arrive usable. */
    it('coerces a stored string count to a number', async () => {
      const { component } = await mount(storedUpload());

      expect(component.slots()[0].maxNoOfUploads).toBe(1);
    });

    /** Production's legacy row stores 'image'; the select's values are uppercase. */
    it('uppercases a legacy lowercase file type', async () => {
      const stored = storedUpload();
      stored.assignments[0].uploadFileType = 'pdf';

      const { component } = await mount(stored);

      expect(component.slots()[0].uploadFileType).toBe('PDF');
    });

    /**
     * COPIED, NOT REFERENCED. The slots are nested objects on an input and the
     * row is what the table is rendering: editing in place would show unsaved
     * changes in the list, and cancelling would not undo them.
     */
    it('does not mutate the row it was given', async () => {
      const stored = storedUpload();
      const original = stored.assignments[0].title;

      const { component } = await mount(stored);
      component.setSlotTitle(0, 'edited in the dialog');

      expect(stored.assignments[0].title).toBe(original);
    });

    /**
     * A KEY THIS APP DOES NOT MODEL SURVIVES. The oldest documents carry
     * `sizeType: 'MB'` and `dueDate`; dropping them on read would delete them on
     * the next save.
     */
    it('carries through fields the current dialog does not offer', async () => {
      const stored = storedUpload();
      (stored.assignments[0] as unknown as Record<string, unknown>)['sizeType'] = 'MB';

      const { component, saved } = await mount(stored);
      component.step.set(3);
      component.save();

      const slot = saved[0].assignments[0] as unknown as Record<string, unknown>;
      expect(slot['sizeType']).toBe('MB');
    });

    /** An upload with no slots would open step two on an empty strip. */
    it('gives a slotless document one slot to edit', async () => {
      const { component } = await mount(storedUpload({ assignments: [] }));

      expect(component.slots().length).toBe(1);
    });
  });

  describe('saving', () => {

    it('emits the base fields production stores', async () => {
      const { component, saved } = await mount();

      fillBasics(component);
      fillSlot(component, 0, 'Upload the sheet');
      component.numberOfAllowedSubmissions.set(3);
      component.save();

      expect(saved.length).toBe(1);

      const draft = saved[0];
      expect(draft.type).toBe('UPLOAD');
      expect(draft.displayName).toBe('Observation Sheet');
      expect(draft.author).toBe('Madhukar N P');
      expect(draft.creator).toBe('Santosh Kanta');
      expect(draft.status).toBe('LIVE');
      expect(draft.numberOfAllowedSubmissions).toBe(3);
      expect(draft.totalDurationInHours).toBe(0);
      expect(draft.totalDurationInMinutes).toBe(0);
      expect(draft.totalDurationInSeconds).toBe(0);
    });

    /**
     * THE LEGACY `duration` STRING IS STILL WRITTEN, empty, because every
     * production document carries it. Dropping a field changes the document's
     * shape for anything that expects it to exist.
     */
    it('writes the empty legacy duration string', async () => {
      const { component, saved } = await mount();

      fillBasics(component);
      fillSlot(component, 0, 'Upload the sheet');
      component.save();

      expect(saved[0].duration).toBe('');
    });

    /** The ten keys, pinned. A missing one is a slot production cannot render. */
    it('emits every slot key production\'s dialog writes', async () => {
      const { component, saved } = await mount();

      fillBasics(component);
      fillSlot(component, 0, 'Upload the sheet');
      component.save();

      const slot = saved[0].assignments[0] as unknown as Record<string, unknown>;

      for (const key of SLOT_KEYS) {
        expect(key in slot).toBe(true);
      }
    });

    /** The select shows 'Image'; the document has to say 'IMAGE'. */
    it('stores the file type code, not its label', async () => {
      const { component, saved } = await mount();

      fillBasics(component);
      fillSlot(component, 0, 'Upload the sheet');
      component.setSlotFileType(0, 'PDF');
      component.save();

      expect(saved[0].assignments[0].uploadFileType).toBe('PDF');
      expect(component.fileTypeLabel('PDF')).toBe('PDF');
      expect(component.fileTypeLabel('IMAGE')).toBe('Image');
      expect(component.fileTypeLabel('WORD')).toBe('Word Document');
    });

    /** An unknown code shows itself rather than nothing. */
    it('falls back to the code when it is not in the configured list', async () => {
      const { component } = await mount();

      expect(component.fileTypeLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    });

    it('trims the titles and renumbers on the way out', async () => {
      const { component, saved } = await mount();

      fillBasics(component);
      fillSlot(component, 0, '  first  ');
      component.addSlot();
      fillSlot(component, 1, 'second');
      component.save();

      expect(saved[0].assignments.map(slot => slot.title)).toEqual(['first', 'second']);
      expect(saved[0].assignments.map(slot => slot.submissionId)).toEqual([1, 2]);
    });

    /**
     * FIRESTORE REJECTS `undefined` ANYWHERE and fails the WHOLE write. This is
     * the bug that made the quiz wizard's Update button look dead: one absent
     * field on one nested option killed the save, with an error naming a path
     * rather than a cause. Walked here on the real stored shape.
     */
    it('emits no undefined at any depth', async () => {
      const { component, saved } = await mount(storedUpload());

      component.addSlot();
      fillSlot(component, 1, 'A second upload');
      component.step.set(3);
      component.save();

      expect(findUndefined(saved[0])).toEqual([]);
    });

    /**
     * NAVIGATES TO THE PROBLEM rather than returning silently. A refused save on
     * the last step with the offending field two steps back is what reads as a
     * button that does nothing.
     */
    it('jumps back to the step that is blocking instead of doing nothing', async () => {
      const { component, saved } = await mount();

      component.step.set(3);
      component.save();

      expect(saved.length).toBe(0);
      expect(component.step()).toBe(1);

      fillBasics(component);
      component.step.set(3);
      component.save();

      expect(saved.length).toBe(0);
      expect(component.step()).toBe(2);
    });

    it('does not emit twice while a save is in flight', async () => {
      const { fixture, component, saved } = await mount();

      fillBasics(component);
      fillSlot(component, 0, 'Upload the sheet');
      fixture.componentRef.setInput('saving', true);

      component.save();

      expect(saved.length).toBe(0);
    });
  });

  describe('the review step', () => {

    it('strips the HTML from the instructions', async () => {
      const { component } = await mount();

      expect(component.plainText('<p><strong>Upload</strong> the&nbsp;sheet</p>'))
        .toBe('Upload the sheet');
    });

    it('prints the duration as production reads it', async () => {
      const { component } = await mount();

      component.totalDurationInHours.set(2);
      component.totalDurationInMinutes.set(1);
      component.totalDurationInSeconds.set(58);

      expect(component.durationLabel()).toBe('2h 1m 58s');
    });

    it('ticks the steps already passed', async () => {
      const { component } = await mount();

      component.step.set(3);

      expect(component.isDone(1)).toBe(true);
      expect(component.isDone(2)).toBe(true);
      expect(component.isDone(3)).toBe(false);
    });
  });

  /** The slot type is what production reads; the compiler is the check. */
  it('builds a slot the interface accepts', async () => {
    const { component } = await mount();

    const slot: UploadSlot = component.slots()[0];

    expect(slot.resourcePath).toBe('');
  });
});

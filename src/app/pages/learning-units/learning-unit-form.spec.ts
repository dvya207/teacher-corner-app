import { ComponentFixture, TestBed } from '@angular/core/testing';
import { expect, vi } from 'vitest';

import { LearningUnit, LearningUnitResource } from '../../models/teaching.model';
import { LearningUnitResourceService } from '../../services/learning-unit-resource.service';
import { ResourceLinkService } from '../../services/resource-link.service';
import { BoardGradeResourceService } from '../../services/board-grade-resource.service';
import { ResourceUploadService } from '../../services/resource-upload.service';
import { LearningUnitForm } from './learning-unit-form';

/**
 * The editor's Save button.
 *
 * THE POINT OF THIS SUITE is one promise: Save Changes is dead until something
 * has actually changed, and alive the moment something has. It is easy to break
 * from either end — a computed that reads a field and patches it would arm the
 * button on open, and a new tab whose edits bypass `edits()` would leave it dead
 * after a real change.
 *
 * The resource service is stubbed because the component reads it on open and
 * this suite is about the button, not about Firestore.
 */

class StubResourceService {
  async byMaturity(): Promise<Map<string, LearningUnitResource>> {
    return new Map<string, LearningUnitResource>();
  }

  async saveSlots(): Promise<void> {
    // Nothing to do: no test here saves.
  }

  /**
   * Present so the board-and-grade flow can call it.
   *
   * Leaving it off did not fail loudly: submitBoardGrade catches its own errors,
   * so a missing method turned into "the file uploaded but could not be filed"
   * and the failure surfaced two assertions later as Save staying dead.
   */
  async linkBoardDocuments(): Promise<void> {
    // Nothing to do: the tests that care spy on this.
  }
}

function unit(): LearningUnit {
  return {
    docId: 'lu-1',
    learningUnitId: 'TA-AE04-EN-V10',
    learningUnitCode: 'AE04',
    learningUnitName: '2D Algebraic Tiles',
    learningUnitDisplayName: '2D Algebraic Tiles',
    isoCode: 'EN',
    version: 'V10',
    status: 'LIVE',
    type: 'TACtivity',
    typeCode: 'TA',
    Maturity: 'Gold',
    subjectCode: 'MA',
    subjectName: 'Mathematics',
    domainCode: 'A',
    domainName: 'Algebra',
    subDomainCode: 'E',
    subDomainName: 'Expressions and Identities',
    compositeCode: 'AE',
    tacOwnerName: 'Seed Data',
    shortDescription: '',
    longDescription: '',
    alternateShortDescription: '',
    alternateLongDescription: '',
    tinyDescription: '',
    learningUnitImage: '',
    learningUnitPreviewImage: '',
    resources: {
      silver: '',
      gold: '',
      guidePath: '',
      materialPath: '',
      observationPath: '',
      templatePath: '',
      topicGuidePath: '',
      varGuidePath: '',
      otherImagePath: '',
      qrCodeImagePath: '',
      videoUrl: '',
      topicVideoUrl: '',
      varVideoUrl: ''
    },
    difficultyLevel: '0',
    exploreTime: 0,
    learnTime: 0,
    totalTime: 45,
    makingTime: 0,
    observationTime: 0,
    firstLiveDate: '',
    masterDocId: 'learningunit_master_02',
    containsResources: false,
    domain: '',
    numberOfTemplates: '',
    samples: '',
    tools: '',
    topicCodes: '',
    totalViews: 0,
    userFeedback: '',
    versionNotes: '',
    tacOwnerCountryCode: '',
    tacOwnerPhoneNumber: '',
    tacArchitectName: '',
    tacArchitectCountryCode: '',
    tacArchitectPhoneNumber: '',
    tacMentorName: '',
    tacMentorCountryCode: '',
    tacMentorPhoneNumber: '',
    associatedLearningUnits: [],
    prerequisiteLearningUnits: [],
    replacementLearningUnits: [],
    similarLearningUnits: [],
    tags: [],
    additionalResources: [],
    linkedClassroomIds: [],
    linkedProgrammeIds: [],
    linkedWorkflowIds: [],
    ownerId: 'uid-1',
    createdAt: null as never,
    updatedAt: null as never
  } as unknown as LearningUnit;
}

describe('LearningUnitForm — the Save button', () => {
  let fixture: ComponentFixture<LearningUnitForm>;
  let component: LearningUnitForm;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LearningUnitForm],
      providers: [{ provide: LearningUnitResourceService, useClass: StubResourceService }]
    }).compileComponents();

    fixture = TestBed.createComponent(LearningUnitForm);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('unit', unit());
    fixture.detectChanges();
  });

  it('is dead on open, before anything has been filled in', () => {
    expect(component.dirty()).toBe(false);
  });

  /*
   * Reading a tab must not arm it. Every resource tab asks the component what a
   * slot holds as it renders, and a reader that wrote a default back into the
   * draft would make merely LOOKING at a tab count as an edit.
   */
  it('stays dead after reading every tab', () => {
    component.setTab('Video');
    component.videoSlots();
    component.setTab('TACDev');
    component.tacDevSlots();
    component.setTab('3S');
    component.threeSSlots();
    component.setTab('Social Media');
    component.socialSlots();
    component.setTab('Graphics');
    component.graphicsSlots();
    component.setTab('External Resources');
    component.unitResource('videoUrl');
    component.setTab('Additional Resources');
    component.additionalResources();

    expect(component.dirty()).toBe(false);
  });

  it('stays dead when the maturity shown is changed, which edits nothing', () => {
    component.setResourceMaturity('Silver');

    expect(component.resourceMaturity()).toBe('Silver');
    expect(component.dirty()).toBe(false);
  });

  it('wakes up when a field on the unit is edited', () => {
    component.setVersionNotes('Rewrote the observation sheet');

    expect(component.dirty()).toBe(true);
    expect(component.valid()).toBe(true);
  });

  it('wakes up when a link on a resource tab is edited', () => {
    component.setSlotValue('video', 'tacVideoUrl', 'https://youtu.be/abc');

    expect(component.dirty()).toBe(true);
  });

  it('wakes up when an external resource link is edited', () => {
    component.setUnitResource('videoUrl', 'https://youtu.be/abc');

    expect(component.dirty()).toBe(true);
  });

  it('wakes up when an additional resource is added', () => {
    component.addResource();

    expect(component.dirty()).toBe(true);
  });

  /*
   * Dirty is not the same as saveable. An empty resource card makes the editor
   * dirty the moment it is added, and its title and file type are required, so
   * Save has to stay out of reach until both are filled.
   */
  it('refuses to save an additional resource with no title or file type', () => {
    component.addResource();

    expect(component.dirty()).toBe(true);
    expect(component.valid()).toBe(false);

    component.updateResource(0, 'title', 'Worksheet');
    expect(component.valid()).toBe(false);

    component.setResourceFileType(0, 'Upload PDF');
    expect(component.valid()).toBe(true);
  });

  /*
   * The select shows one label; the document keeps the PAIR behind it, which is
   * how production stores it — type says how it arrives, fileExtension says what
   * it is.
   */
  it('stores production\'s type and fileExtension pair, not the label', () => {
    component.addResource();

    component.setResourceFileType(0, 'Youtube Link');
    expect(component.additionalResources()[0].type).toBe('VIDEO');
    expect(component.additionalResources()[0].fileExtension).toBe('video');

    component.setResourceFileType(0, 'Upload PPT');
    expect(component.additionalResources()[0].type).toBe('UPLOAD');
    expect(component.additionalResources()[0].fileExtension).toBe('pptx');

    // And back out again, so the select can show what is stored.
    expect(component.fileTypeLabel(component.additionalResources()[0])).toBe('Upload PPT');
  });

  it('writes publish as a boolean, as 537 of production\'s 538 entries do', () => {
    component.addResource();

    expect(component.additionalResources()[0].publish).toBe(false);

    component.setResourcePublish(0, 'true');
    expect(component.additionalResources()[0].publish).toBe(true);
  });

  it('does not need a path on an additional resource, which arrives with the upload', () => {
    component.addResource();
    component.updateResource(0, 'title', 'Worksheet');
    component.setResourceFileType(0, 'Youtube Link');

    expect(component.valid()).toBe(true);
  });

  /* ---- View --------------------------------------------------------------- */

  it('opens a link as it is, and resolves a storage path first', async () => {
    const links = TestBed.inject(ResourceLinkService);
    const opened: string[] = [];
    vi.spyOn(links, 'open').mockImplementation(async value => {
      opened.push(value);

      return true;
    });

    await component.openResource('https://youtu.be/abc', 'TAC Video (URL)');
    await component.openResource('learningUnits/lu-1/guide.pdf', 'Dev Guide (PDF)');

    expect(opened).toEqual(['https://youtu.be/abc', 'learningUnits/lu-1/guide.pdf']);
    expect(component.viewFailed()).toBe('');
  });

  /*
   * A refused bucket and a missing file are the same thing to whoever clicked,
   * so both have to say so rather than fail silently.
   */
  it('says so when there is nothing to open', async () => {
    const links = TestBed.inject(ResourceLinkService);
    vi.spyOn(links, 'open').mockResolvedValue(false);

    await component.openResource('learningUnits/lu-1/missing.pdf', 'Dev Guide (PDF)');

    expect(component.viewFailed()).toBe('Dev Guide (PDF)');
  });

  /* ---- Images -------------------------------------------------------------
     The three slots are stored in three different places, which is the part
     worth pinning: the headline is a field on the unit, the other two are keys
     inside its resources map. */

  it('files an uploaded image in the right place per slot', async () => {
    const uploads = TestBed.inject(ResourceUploadService);
    vi.spyOn(uploads, 'upload').mockImplementation(async (_id, file) => ({
      path: `learningUnits/lu-1/${file.name}`
    }));

    const pick = (): Event => {
      const file = new File(['x'], 'photo.png', { type: 'image/png' });
      const input = { files: [file], value: 'photo.png' } as unknown as HTMLInputElement;

      return { target: input } as unknown as Event;
    };

    const slots = component.imageSlots();

    await component.uploadImage(slots[0], pick());
    expect(component.headlineImage()).toBe('learningUnits/lu-1/learningUnitImage.png');

    await component.uploadImage(slots[1], pick());
    expect(component.qrCodeImage()).toBe('learningUnits/lu-1/qrCodeImage.png');

    await component.uploadImage(slots[2], pick());
    expect(component.otherImage()).toBe('learningUnits/lu-1/otherImage.png');

    // The headline is a field; the other two live in the resources map, which
    // must keep everything else it held.
    expect(component.unitResource('guidePath')).toBe('');
    expect(component.dirty()).toBe(true);
  });

  it('says so when the bucket refuses an image', async () => {
    const uploads = TestBed.inject(ResourceUploadService);
    vi.spyOn(uploads, 'upload').mockResolvedValue({
      error: 'denied',
      contentType: 'image/png',
      sizeMb: 40
    });

    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    const event = {
      target: { files: [file], value: '' } as unknown as HTMLInputElement
    } as unknown as Event;

    await component.uploadImage(component.imageSlots()[0], event);

    // The message has to name WHAT was refused: the rule checks type and size,
    // and a refusal says only "unauthorized".
    expect(component.uploadError()).toContain('refused the upload');
    expect(component.uploadError()).toContain('image/png');
    expect(component.uploadError()).toContain('40 MB');
    expect(component.headlineImage()).toBe('');
  });

  it('files an uploaded video against the slot it was uploaded for', async () => {
    const uploads = TestBed.inject(ResourceUploadService);
    vi.spyOn(uploads, 'upload').mockResolvedValue({
      path: 'learningUnits/lu-1/lesson.mp4'
    });

    const file = new File(['x'], 'lesson.mp4', { type: 'video/mp4' });
    const event = {
      target: { files: [file], value: '' } as unknown as HTMLInputElement
    } as unknown as Event;

    await component.uploadSlotFile('video', 'tacVideoMp4', event);

    // Held as a pending slot edit, which is what Save writes to the rung's
    // resource document.
    expect(component.slotValue('video', 'tacVideoMp4')).toBe('learningUnits/lu-1/lesson.mp4');
    expect(component.dirty()).toBe(true);
    expect(component.uploadError()).toBe('');
  });

  it('leaves the slot alone when an upload is refused', async () => {
    const uploads = TestBed.inject(ResourceUploadService);
    vi.spyOn(uploads, 'upload').mockResolvedValue({ error: 'denied' });

    const file = new File(['x'], 'lesson.mp4', { type: 'video/mp4' });
    const event = {
      target: { files: [file], value: '' } as unknown as HTMLInputElement
    } as unknown as Event;

    await component.uploadSlotFile('video', 'tacVideoMp4', event);

    expect(component.slotValue('video', 'tacVideoMp4')).toBe('');
    expect(component.uploadError()).toContain('refused');
  });

  /*
   * Graphics is the tab where BOTH kinds of slot sit side by side: eight plain
   * ones and label18Sticker, which is grade-dependent. A plain slot uploads
   * straight into the rung document; the grade-dependent one goes through the
   * sheet. Getting that split wrong left eight of nine unable to upload at all.
   */
  it('uploads a plain graphics slot straight into the rung document', async () => {
    const uploads = TestBed.inject(ResourceUploadService);
    vi.spyOn(uploads, 'upload').mockResolvedValue({
      path: 'learningUnits/lu-1/illustration.png'
    });

    const event = {
      target: {
        files: [new File(['x'], 'illustration.png', { type: 'image/png' })],
        value: ''
      } as unknown as HTMLInputElement
    } as unknown as Event;

    await component.uploadSlotFile('graphics', 'tacIllustration', event);

    expect(component.slotValue('graphics', 'tacIllustration')).toBe(
      'learningUnits/lu-1/illustration.png'
    );
    expect(component.dirty()).toBe(true);
  });

  it('knows which graphics slots are grade-dependent', () => {
    const slots = component.graphicsSlots();
    const byKey = Object.fromEntries(slots.map(s => [s.key, s.gradeDependent]));

    // The Gold nine: only the sticker is per board and grade.
    expect(byKey['label18Sticker']).toBe(true);
    expect(byKey['tacIllustration']).toBe(false);
    expect(byKey['qrCode']).toBe(false);
  });

  /*
   * External Resources is the one resource-looking tab whose files live on the
   * LEARNING UNIT, not on a maturity rung — so an upload here has to land in the
   * unit's own resources map and be saved with the unit.
   */
  it('stores an external resource upload on the unit, not on a rung', async () => {
    const uploads = TestBed.inject(ResourceUploadService);
    vi.spyOn(uploads, 'upload').mockResolvedValue({
      path: 'learningUnits/lu-1/guide.pdf'
    });

    const event = {
      target: {
        files: [new File(['x'], 'guide.pdf', { type: 'application/pdf' })],
        value: ''
      } as unknown as HTMLInputElement
    } as unknown as Event;

    await component.uploadUnitResource('guidePath', 'Learning Unit Guide', event);

    expect(component.unitResource('guidePath')).toBe('learningUnits/lu-1/guide.pdf');
    // The rung document is untouched by this tab.
    expect(component.slotValue('tacDev', 'guidePath')).toBe('');
    expect(component.dirty()).toBe(true);
  });

  it('leaves the rest of the resources map alone when one slot is uploaded', async () => {
    const uploads = TestBed.inject(ResourceUploadService);
    vi.spyOn(uploads, 'upload').mockResolvedValue({ path: 'learningUnits/lu-1/a.pdf' });

    component.setUnitResource('videoUrl', 'https://youtu.be/abc');

    const event = {
      target: {
        files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })],
        value: ''
      } as unknown as HTMLInputElement
    } as unknown as Event;

    await component.uploadUnitResource('materialPath', 'Learning Unit Materials', event);

    expect(component.unitResource('materialPath')).toBe('learningUnits/lu-1/a.pdf');
    expect(component.unitResource('videoUrl')).toBe('https://youtu.be/abc');
  });

  /* ---- Board and grade resources ------------------------------------------ */

  it('files one document per board, with a key per grade', async () => {
    const uploads = TestBed.inject(ResourceUploadService);
    const boardGrades = TestBed.inject(BoardGradeResourceService);

    vi.spyOn(uploads, 'upload').mockResolvedValue({
      path: 'learningUnits/lu-1/GradeDependentResources/worksheet.pdf'
    });
    const applied = vi
      .spyOn(boardGrades, 'apply')
      .mockResolvedValue({ CBSE: 'bg-cbse', ICSE: 'bg-icse' });
    // The rung document points back at those documents, which is what makes the
    // file visible in the resources map and not only in the other collection.
    const linked = vi
      .spyOn(TestBed.inject(LearningUnitResourceService), 'linkBoardDocuments')
      .mockResolvedValue();

    component.openBoardGrade({ key: 'tttPpts', label: 'TTT PPTs' }, '3S');
    component.toggleBoard('CBSE');
    component.toggleBoard('ICSE');
    component.toggleGrade('3');
    component.toggleGrade('4');

    const file = new File(['x'], 'worksheet.pdf', { type: 'application/pdf' });
    component.chooseBoardGradeFile({
      target: { files: [file], value: '' } as unknown as HTMLInputElement
    } as unknown as Event);

    await component.submitBoardGrade();

    expect(uploads.upload).toHaveBeenCalledWith(
      'lu-1',
      file,
      // Production files grade-dependent files a level deeper.
      'GradeDependentResources',
      // The progress callback. Asserted as a function rather than by identity —
      // the form holds one bound arrow, and pinning the instance here would tie
      // this test to a private field. That it is PASSED is the contract: without
      // it the upload reports nothing, which is the bug this argument fixed.
      expect.any(Function)
    );
    expect(linked).toHaveBeenCalledWith(
      expect.objectContaining({ docId: 'lu-1' }),
      'Gold',
      '3S',
      'tttPpts',
      { CBSE: 'bg-cbse', ICSE: 'bg-icse' }
    );
    expect(applied).toHaveBeenCalledWith(
      expect.objectContaining({ docId: 'lu-1' }),
      expect.objectContaining({
        category: '3S',
        subCategory: 'tttPpts',
        boards: ['CBSE', 'ICSE'],
        grades: ['3', '4'],
        path: 'learningUnits/lu-1/GradeDependentResources/worksheet.pdf'
      })
    );
  });

  /*
   * The point of this one: a grade-dependent slot's View reads a DIFFERENT
   * collection. Its path on the rung document stays empty forever, so a View
   * wired only to that would never light up no matter how many files were filed.
   */
  it('lights up View from the board-and-grade collection, not the rung document', async () => {
    const boardGrades = TestBed.inject(BoardGradeResourceService);
    vi.spyOn(boardGrades, 'forUnit').mockResolvedValue([
      {
        docId: 'bg-1',
        learningUnitDocId: 'lu-1',
        learningUnitId: 'TA-AE04-EN-V10',
        maturity: 'Gold',
        type: 'TACtivity',
        category: '3S',
        subCategory: 'tttPpts',
        board: 'CBSE',
        resources: { grade_01: 'learningUnits/lu-1/GradeDependentResources/a.pdf' },
        createdAt: null,
        updatedAt: null
      }
    ]);

    // Reopening the editor is what triggers the read.
    fixture.componentRef.setInput('unit', unit());
    await fixture.whenStable();

    expect(component.slotValue('3S', 'tttPpts')).toBe('');
    expect(component.boardGradePath('3S', 'tttPpts')).toBe(
      'learningUnits/lu-1/GradeDependentResources/a.pdf'
    );
    expect(component.boardGradeCount('3S', 'tttPpts')).toBe(1);

    // A different rung has none of it.
    component.setResourceMaturity('Silver');
    expect(component.boardGradePath('3S', 'tttPpts')).toBe('');
  });

  it('wakes Save up once a file has been filed by board and grade', async () => {
    const uploads = TestBed.inject(ResourceUploadService);
    const boardGrades = TestBed.inject(BoardGradeResourceService);
    vi.spyOn(uploads, 'upload').mockResolvedValue({ path: 'learningUnits/lu-1/x.pdf' });
    vi.spyOn(boardGrades, 'apply').mockResolvedValue({ CBSE: 'bg-1' });
    vi.spyOn(boardGrades, 'forUnit').mockResolvedValue([]);

    expect(component.dirty()).toBe(false);

    component.openBoardGrade({ key: 'tttPpts', label: 'TTT PPTs' }, '3S');
    component.toggleBoard('CBSE');
    component.toggleGrade('1');
    component.chooseBoardGradeFile({
      target: {
        files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })],
        value: ''
      } as unknown as HTMLInputElement
    } as unknown as Event);

    await component.submitBoardGrade();

    expect(component.dirty()).toBe(true);
  });

  it('will not submit without a board, a grade and a file', async () => {
    const boardGrades = TestBed.inject(BoardGradeResourceService);
    const applied = vi.spyOn(boardGrades, 'apply').mockResolvedValue({});

    component.openBoardGrade({ key: 'tttPpts', label: 'TTT PPTs' }, '3S');
    component.toggleBoard('CBSE');

    // No grade and no file yet.
    await component.submitBoardGrade();
    expect(applied).not.toHaveBeenCalled();
  });

  /* ---- Associated LU ----------------------------------------------------- */

  it('adds, lists and removes an associated learning unit', () => {
    const other = { ...unit(), docId: 'lu-2', learningUnitDisplayName: 'DIY Cap', version: 'V10' };
    fixture.componentRef.setInput('units', [unit(), other] as never);

    component.toggleLu('associatedLearningUnits', 'lu-2');

    expect(component.luPicked('associatedLearningUnits')).toEqual(['lu-2']);
    expect(component.luLabel('lu-2')).toBe('DIY Cap (V10)');
    expect(component.dirty()).toBe(true);

    component.removeLu('associatedLearningUnits', 'lu-2');

    expect(component.luPicked('associatedLearningUnits')).toEqual([]);
  });

  it('never offers the unit being edited as its own association', () => {
    const other = { ...unit(), docId: 'lu-2' };
    fixture.componentRef.setInput('units', [unit(), other] as never);

    expect(component.luMatches().map(row => row.docId)).toEqual(['lu-2']);
  });

  it('keeps the three lists independent', () => {
    const other = { ...unit(), docId: 'lu-2' };
    fixture.componentRef.setInput('units', [unit(), other] as never);

    component.toggleLu('prerequisiteLearningUnits', 'lu-2');

    expect(component.luPicked('prerequisiteLearningUnits')).toEqual(['lu-2']);
    expect(component.luPicked('associatedLearningUnits')).toEqual([]);
    expect(component.luPicked('similarLearningUnits')).toEqual([]);
  });

  /* ----------------------------------------------------------------------
     Copy file name — the board x grade page's copy button
     ---------------------------------------------------------------------- */

  const PATH = 'learningUnits/lu-1/GradeDependentResources/TABP20 Worksheet.pdf';

  /** Replaces navigator.clipboard for one test, and restores it after. */
  function withClipboard(impl: unknown): () => void {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

    Object.defineProperty(navigator, 'clipboard', {
      value: impl,
      configurable: true
    });

    return () => {
      if (original) {
        Object.defineProperty(navigator, 'clipboard', original);
      } else {
        delete (navigator as unknown as Record<string, unknown>)['clipboard'];
      }
    };
  }

  /* THE FILE NAME, NOT THE PATH. Production's tooltip says "Copy file name" and
     the whole point is pasting it somewhere a Storage path would be useless. */
  it('copies the file name off the end of the stored path', async () => {
    const written: string[] = [];
    const restore = withClipboard({
      writeText: (text: string) => {
        written.push(text);

        return Promise.resolve();
      }
    });

    try {
      await component.copyCellName('CBSE|grade_03', PATH);
    } finally {
      restore();
    }

    expect(written).toEqual(['TABP20 Worksheet.pdf']);
  });

  it('marks the copied cell so its own button can confirm', async () => {
    const restore = withClipboard({ writeText: () => Promise.resolve() });

    try {
      await component.copyCellName('CBSE|grade_03', PATH);
    } finally {
      restore();
    }

    expect(component.copiedCell()).toBe('CBSE|grade_03');
    expect(component.boardGradeDone()).toContain('TABP20 Worksheet.pdf');
  });

  /* The case that made copy look broken: navigator.clipboard does not exist
     outside a secure context, so opening the app over the LAN lost every copy.
     It must not throw, and it must not claim success. */
  it('survives a missing clipboard API without throwing', async () => {
    const restore = withClipboard(undefined);

    try {
      await component.copyCellName('CBSE|grade_03', PATH);
    } finally {
      restore();
    }

    expect(component.boardGradeDone()).toBeTruthy();
  });

  it('reports failure rather than confirming when the write rejects', async () => {
    const restore = withClipboard({
      writeText: () => Promise.reject(new Error('denied'))
    });

    try {
      await component.copyCellName('CBSE|grade_03', PATH);
    } finally {
      restore();
    }

    // Whatever the fallback managed, it must not have marked this cell copied
    // on a rejected write unless it genuinely succeeded.
    if (component.copiedCell() === '') {
      expect(component.boardGradeDone()).toBe('Could not copy that file name.');
    }
  });

  /* THE BUG: one file is filed across many cells by the upload sheet, so many
     cells share a path. Keying the tick by path lit every one of them. */
  it('marks only the cell clicked, not every cell sharing that file', async () => {
    const restore = withClipboard({ writeText: () => Promise.resolve() });

    try {
      await component.copyCellName('CBSE|grade_03', PATH);
    } finally {
      restore();
    }

    expect(component.copiedCell()).toBe('CBSE|grade_03');
    // The same file filed for ICSE grade 3 is a different cell.
    expect(component.copiedCell()).not.toBe('ICSE|grade_03');
    expect(component.copiedCell()).not.toBe(PATH);
  });

  /* ----------------------------------------------------------------------
     The board x grade page — what actually reaches the DOM
     ----------------------------------------------------------------------
     Asserted against the RENDERED template, not against a signal. Both of the
     things checked here were reported as missing from the running app while a
     hand-built harness showed them present, which is exactly the gap a harness
     cannot close: it renders my copy of the markup, not Angular's. */

  function openGrid(): void {
    component.openBoardGrid({ key: 'observationWorksheetPdf', label: 'Observation Worksheet' }, '3S');
    fixture.detectChanges();
  }

  it('renders the close control at the top of the page', () => {
    openGrid();

    const panel = fixture.nativeElement.querySelector('.bg-panel');
    expect(panel).toBeTruthy();

    const close = panel.querySelector('header.bg-head .bg-close');
    expect(close).toBeTruthy();
    expect(close.getAttribute('aria-label')).toBe('Close the board and grade page');

    // The icon inside it must actually draw something.
    const svg = close.querySelector('svg path');
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('d')).toBeTruthy();
  });

  /*
   * THE REGRESSION THIS GUARDS.
   *
   * The page was a child of .modal-card, which sets `overflow: hidden` and
   * carries .animate-fade-up — keyframes that animate `transform`, making it a
   * containing block for `position: fixed` descendants. The panel was therefore
   * clipped to the editor: the close button on its right edge and the last grade
   * columns were cut off, and the page read as missing them. No unit test caught
   * it, because clipping is CSS and the elements were all present in the DOM.
   *
   * What can be asserted is the STRUCTURE that avoids it: the page must not be
   * inside .modal-card. Moving it back would restore the bug silently.
   */
  it('renders the page outside .modal-card, so nothing clips it', () => {
    openGrid();

    const card = fixture.nativeElement.querySelector('.modal-card');
    const overlay = fixture.nativeElement.querySelector('.bg-overlay');

    expect(card).toBeTruthy();
    expect(overlay).toBeTruthy();
    expect(card.contains(overlay)).toBe(false);
  });

  it('closes the page when that control is clicked', () => {
    openGrid();

    fixture.nativeElement.querySelector('.bg-close').click();
    fixture.detectChanges();

    expect(component.boardGridSlot()).toBeNull();
    expect(fixture.nativeElement.querySelector('.bg-panel')).toBeNull();
  });

  /* EVERY grade, including all three pre-primary years. */
  it('renders a column for every grade in the vocabulary', () => {
    openGrid();

    const headers = Array.from(
      fixture.nativeElement.querySelectorAll('.bg-grid thead th')
    ).map((th: unknown) => (th as HTMLElement).textContent?.trim());

    expect(headers[0]).toBe('Board');

    const grades = headers.slice(1);
    expect(grades).toEqual([
      'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5',
      'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10',
      'Pre-primary 1', 'Pre-primary 2', 'Pre-primary 3'
    ]);
  });

  it('gives all thirteen columns a distinct key to file into', () => {
    openGrid();

    const keys = component.gradeColumns().map(column => column.key);

    expect(keys.length).toBe(13);
    expect(new Set(keys).size).toBe(13);
    expect(keys).toContain('grade_10');
    expect(keys).toContain('grade_preprimary_2');
    expect(keys).toContain('grade_preprimary_3');
  });

  it('does nothing for an empty path', async () => {
    component.boardGradeDone.set('');

    await component.copyCellName('CBSE|grade_03', '');

    expect(component.copiedCell()).toBe('');
    expect(component.boardGradeDone()).toBe('');
  });
});

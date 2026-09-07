import { TestBed } from '@angular/core/testing';

import {
  ResolvedResource,
  WorkflowContentResourceService,
  resourceKind,
  youtubeId
} from './workflow-content-resource.service';
import { BoardGradeResourceService } from './board-grade-resource.service';
import { LearningUnitResourceService } from './learning-unit-resource.service';
import { emptyWorkflowContent } from '../models/teaching.model';
import {
  EXTERNAL_RESOURCES_CATEGORY,
  EXTERNAL_RESOURCE_SLOTS
} from '../data/learning-unit-options';

/**
 * Resolving a workflow content block to the learning unit's actual file.
 *
 * WHY THIS IS WORTH TESTING. A content block names a SLOT — 'video' plus
 * 'tacVideoUrl' — and carries no file. The file lives on the unit's resource
 * document for its maturity. Reading `content.resourcePath` alone, which is empty
 * on almost every block, made every step in the stepper claim no file was attached
 * when the unit had one; that is the bug this service exists to fix, and it failed
 * silently rather than erroring.
 *
 * FOUR RULES, each of which changes which file a teacher is shown:
 *
 *   1. THE BLOCK'S OWN PATH WINS over the unit's, because a block edited to point
 *      somewhere specific is an override.
 *   2. A PLAIN STRING is the file. A MAP is a grade-dependent slot.
 *   3. A GRADE-DEPENDENT SLOT prefers this class's board-and-grade copy, then the
 *      one universal file.
 *   4. AN EMPTY VALUE IS NOT A FILE. '' must not resolve to something openable.
 *   5. THERE ARE TWO STORES. The unit's own maturity-less "External Resources"
 *      map is separate from the per-maturity resource documents, and reading only
 *      the latter is the bug that prompted this: a teacher uploaded a guide on the
 *      editor's External Resources tab and no workflow step could show it.
 */

class StubUnitResources {
  documents = new Map<string, { resources: Record<string, unknown> }>();
  calls = 0;

  async byMaturity(_id: string): Promise<Map<string, unknown>> {
    this.calls += 1;

    return this.documents as unknown as Map<string, unknown>;
  }
}

class StubBoardResources {
  documents: { docId: string; resources: Record<string, string> }[] = [];
  calls = 0;

  async forUnit(_id: string): Promise<unknown[]> {
    this.calls += 1;

    return this.documents;
  }
}

function make(): {
  service: WorkflowContentResourceService;
  units: StubUnitResources;
  boards: StubBoardResources;
} {
  const units = new StubUnitResources();
  const boards = new StubBoardResources();

  TestBed.configureTestingModule({
    providers: [
      WorkflowContentResourceService,
      { provide: LearningUnitResourceService, useValue: units },
      { provide: BoardGradeResourceService, useValue: boards }
    ]
  });

  return { service: TestBed.inject(WorkflowContentResourceService), units, boards };
}

describe('WorkflowContentResourceService', () => {

  describe('forUnit', () => {

    it('maps a filled string slot to its value', async () => {
      const { service, units } = make();

      units.documents.set('Gold', {
        resources: {
          video: {
            tacVideoUrl: 'https://www.youtube.com/watch?v=lY2yjAdbvdQ',
            tacVideoMp4: 'learningUnits/u1/clip.mp4'
          }
        }
      });

      const map = await service.forUnit('u1', 'Gold', { board: 'CBSE', grade: '8' });

      expect(map.get('video.tacVideoUrl')).toEqual({
        value: 'https://www.youtube.com/watch?v=lY2yjAdbvdQ',
        origin: 'unit',
        slot: 'video.tacVideoUrl'
      });
      expect(map.get('video.tacVideoMp4')?.value).toBe('learningUnits/u1/clip.mp4');
    });

    /** AN EMPTY SLOT IS NOT A FILE. Most slots on a real document are ''. */
    it('skips an empty slot', async () => {
      const { service, units } = make();

      units.documents.set('Gold', { resources: { video: { tacVideoUrl: '' } } });

      const map = await service.forUnit('u1', 'Gold', { board: 'CBSE', grade: '8' });

      expect(map.has('video.tacVideoUrl')).toBe(false);
    });

    /**
     * THE MATURITY SELECTS THE DOCUMENT. A unit has one per rung, so a Gold unit
     * must not be shown its Silver files.
     */
    it('reads the document for the unit’s own maturity', async () => {
      const { service, units } = make();

      units.documents.set('Gold', { resources: { video: { tacVideoUrl: 'gold.mp4' } } });
      units.documents.set('Silver', {
        resources: { video: { tacVideoUrl: 'silver.mp4' } }
      });

      const gold = await service.forUnit('u1', 'Gold', { board: '', grade: '' });
      const silver = await service.forUnit('u1', 'Silver', { board: '', grade: '' });

      expect(gold.get('video.tacVideoUrl')?.value).toBe('gold.mp4');
      expect(silver.get('video.tacVideoUrl')?.value).toBe('silver.mp4');
    });

    /** A lowercase stored maturity still matches. */
    it('falls back to a lowercase maturity key', async () => {
      const { service, units } = make();

      units.documents.set('gold', { resources: { video: { tacVideoUrl: 'x.mp4' } } });

      const map = await service.forUnit('u1', 'Gold', { board: '', grade: '' });

      expect(map.get('video.tacVideoUrl')?.value).toBe('x.mp4');
    });

    describe('a grade-dependent slot', () => {

      /**
       * THE BOARD KEY HOLDS A DOCUMENT ID, not a path — the paths live on that
       * document under `grade_08` and friends. Getting this wrong shows the id as
       * though it were a file.
       */
      it('follows the board key to the grade’s file', async () => {
        const { service, units, boards } = make();

        units.documents.set('Gold', {
          resources: {
            graphics: {
              label18Sticker: {
                CBSE: 'board-doc-1',
                universalGradeBoardResourcePath: 'universal.pdf'
              }
            }
          }
        });
        boards.documents = [
          { docId: 'board-doc-1', resources: { grade_08: 'cbse-grade-8.pdf' } }
        ];

        const map = await service.forUnit('u1', 'Gold', { board: 'CBSE', grade: '8' });

        expect(map.get('graphics.label18Sticker')).toEqual({
          value: 'cbse-grade-8.pdf',
          origin: 'grade',
          slot: 'graphics.label18Sticker'
        });
      });

      /** THE UNIVERSAL FILE IS THE FALLBACK, not an alternative. */
      it('falls back to the universal file when the grade has none', async () => {
        const { service, units, boards } = make();

        units.documents.set('Gold', {
          resources: {
            graphics: {
              label18Sticker: {
                CBSE: 'board-doc-1',
                universalGradeBoardResourcePath: 'universal.pdf'
              }
            }
          }
        });
        boards.documents = [{ docId: 'board-doc-1', resources: { grade_09: 'other.pdf' } }];

        const map = await service.forUnit('u1', 'Gold', { board: 'CBSE', grade: '8' });

        expect(map.get('graphics.label18Sticker')).toEqual({
          value: 'universal.pdf',
          origin: 'universal',
          slot: 'graphics.label18Sticker'
        });
      });

      /** A class on a board the slot has no copy for still gets the universal. */
      it('uses the universal file for an unlisted board', async () => {
        const { service, units } = make();

        units.documents.set('Gold', {
          resources: {
            graphics: {
              label18Sticker: {
                CBSE: 'board-doc-1',
                universalGradeBoardResourcePath: 'universal.pdf'
              }
            }
          }
        });

        const map = await service.forUnit('u1', 'Gold', { board: 'ICSE', grade: '8' });

        expect(map.get('graphics.label18Sticker')?.origin).toBe('universal');
      });

      /** Nothing at all: the slot is absent rather than present and empty. */
      it('skips a grade-dependent slot with nothing in it', async () => {
        const { service, units } = make();

        units.documents.set('Gold', {
          resources: {
            graphics: { label18Sticker: { universalGradeBoardResourcePath: '' } }
          }
        });

        const map = await service.forUnit('u1', 'Gold', { board: 'CBSE', grade: '8' });

        expect(map.has('graphics.label18Sticker')).toBe(false);
      });

      /**
       * THE BOARD DOCUMENTS ARE READ ONCE, AND ONLY WHEN NEEDED. Most units have
       * no grade-dependent slot filled, and the read is a whole extra query.
       */
      it('does not read the board documents when no slot needs them', async () => {
        const { service, units, boards } = make();

        units.documents.set('Gold', { resources: { video: { tacVideoUrl: 'x.mp4' } } });

        await service.forUnit('u1', 'Gold', { board: 'CBSE', grade: '8' });

        expect(boards.calls).toBe(0);
      });

      it('reads them once for several grade-dependent slots', async () => {
        const { service, units, boards } = make();

        units.documents.set('Gold', {
          resources: {
            graphics: { a: { CBSE: 'd1' }, b: { CBSE: 'd1' } }
          }
        });
        boards.documents = [
          { docId: 'd1', resources: { grade_08: 'one.pdf' } }
        ];

        await service.forUnit('u1', 'Gold', { board: 'CBSE', grade: '8' });

        expect(boards.calls).toBe(1);
      });
    });

    /* ---- The unit's own "External Resources" ------------------------------
       A SECOND STORE, with no maturity: one set per unit, written by the
       learning-unit editor's External Resources tab onto the unit document
       rather than onto a resource document. Reading only the per-maturity
       documents left every file uploaded there unreachable from a workflow. */

    describe('the unit’s own External Resources', () => {

      it('resolves a slot from the unit’s own resources map', async () => {
        const { service } = make();

        const map = await service.forUnit('u1', 'Gold', {
          board: '',
          grade: '',
          external: { guidePath: 'learningUnits/u1/Sample.pdf', materialPath: '' }
        });

        expect(map.get('externalResources.guidePath')).toEqual({
          value: 'learningUnits/u1/Sample.pdf',
          origin: 'external',
          slot: 'externalResources.guidePath'
        });
      });

      /** An empty external slot is not a file, exactly as an empty schema slot. */
      it('skips an empty external slot', async () => {
        const { service } = make();

        const map = await service.forUnit('u1', 'Gold', {
          board: '',
          grade: '',
          external: { guidePath: '' }
        });

        expect(map.has('externalResources.guidePath')).toBe(false);
      });

      /**
       * ONLY THE NINE KNOWN SLOTS ARE READ, and this is the one that would do
       * real damage if it regressed. The same `resources` map ALSO carries the
       * maturity ladder — `silver` and `gold` hold resource DOCUMENT IDS, not
       * paths — so reading every key would offer a document id as though it were
       * a file, and the pane would try to open it from Storage.
       */
      it('ignores the maturity ladder keys on the same map', async () => {
        const { service } = make();

        const map = await service.forUnit('u1', 'Gold', {
          board: '',
          grade: '',
          external: {
            guidePath: 'learningUnits/u1/Sample.pdf',
            silver: 'someResourceDocId',
            gold: 'anotherResourceDocId'
          }
        });

        expect(map.has('externalResources.guidePath')).toBe(true);
        expect([...map.keys()].some(key => key.includes('silver'))).toBe(false);
        expect([...map.keys()].some(key => key.includes('gold'))).toBe(false);
      });

      /** Nor the two image keys the editor's tab does not offer. */
      it('ignores keys outside the editor’s nine', async () => {
        const { service } = make();

        const map = await service.forUnit('u1', 'Gold', {
          board: '',
          grade: '',
          external: { qrCodeImagePath: 'learningUnits/u1/qr.png' }
        });

        expect(map.size).toBe(0);
      });

      /** BOTH STORES AT ONCE, which is the normal case for a real unit. */
      it('resolves the external store and the maturity store together', async () => {
        const { service, units } = make();

        units.documents.set('Gold', {
          resources: { video: { tacVideoUrl: 'https://youtu.be/lY2yjAdbvdQ' } }
        });

        const map = await service.forUnit('u1', 'Gold', {
          board: '',
          grade: '',
          external: { guidePath: 'learningUnits/u1/Sample.pdf' }
        });

        expect(map.get('externalResources.guidePath')?.origin).toBe('external');
        expect(map.get('video.tacVideoUrl')?.origin).toBe('unit');
      });

      it('copes with a unit that has no resources map at all', async () => {
        const { service } = make();

        const map = await service.forUnit('u1', 'Gold', { board: '', grade: '' });

        expect(map.size).toBe(0);
      });

      /** Every slot the editor offers is reachable — see the constant's note. */
      it('reads every slot the editor can write', async () => {
        const { service } = make();
        const external: Record<string, string> = {};

        for (const slot of EXTERNAL_RESOURCE_SLOTS) {
          external[slot.code] = `learningUnits/u1/${slot.code}`;
        }

        const map = await service.forUnit('u1', 'Gold', {
          board: '',
          grade: '',
          external
        });

        expect(map.size).toBe(EXTERNAL_RESOURCE_SLOTS.length);

        for (const slot of EXTERNAL_RESOURCE_SLOTS) {
          expect(map.get(`${EXTERNAL_RESOURCES_CATEGORY}.${slot.code}`)?.value).toBe(
            `learningUnits/u1/${slot.code}`
          );
        }
      });
    });

    it('returns nothing for a unit with no id', async () => {
      const { service, units } = make();

      const map = await service.forUnit('', 'Gold', { board: '', grade: '' });

      expect(map.size).toBe(0);
      expect(units.calls).toBe(0);
    });
  });

  describe('resolve', () => {

    const unitMap = new Map<string, ResolvedResource>([
      ['video.tacVideoUrl', { value: 'unit.mp4', origin: 'unit', slot: 'video.tacVideoUrl' }]
    ]);

    it('reads the unit’s file for the block’s slot', () => {
      const { service } = make();

      const resolved = service.resolve(
        {
          ...emptyWorkflowContent(),
          contentCategory: 'video',
          contentSubCategory: 'tacVideoUrl'
        },
        unitMap
      );

      expect(resolved).toEqual({
        value: 'unit.mp4',
        origin: 'unit',
        slot: 'video.tacVideoUrl'
      });
    });

    /**
     * THE BLOCK'S OWN PATH WINS. A block edited to point somewhere specific is an
     * override, and re-deriving it from the unit would silently undo that edit —
     * production applies the same precedence (`content.resourcePath || …`).
     */
    it('prefers a path stored on the block itself', () => {
      const { service } = make();

      const resolved = service.resolve(
        {
          ...emptyWorkflowContent(),
          contentCategory: 'video',
          contentSubCategory: 'tacVideoUrl',
          resourcePath: 'override.mp4'
        },
        unitMap
      );

      expect(resolved).toEqual({
        value: 'override.mp4',
        origin: 'content',
        slot: 'video.tacVideoUrl'
      });
    });

    /** A block in the external category reads that store. */
    it('reads an external slot for a block in that category', () => {
      const { service } = make();

      const resolved = service.resolve(
        {
          ...emptyWorkflowContent(),
          contentCategory: EXTERNAL_RESOURCES_CATEGORY,
          contentSubCategory: 'guidePath'
        },
        new Map([
          [
            'externalResources.guidePath',
            {
              value: 'learningUnits/u1/Sample.pdf',
              origin: 'external' as const,
              slot: 'externalResources.guidePath'
            }
          ]
        ])
      );

      expect(resolved.value).toBe('learningUnits/u1/Sample.pdf');
      expect(resolved.origin).toBe('external');
    });

    /** AND A BLOCK-LEVEL PATH STILL WINS, external store or not. */
    it('prefers the block’s own path over an external slot', () => {
      const { service } = make();

      const resolved = service.resolve(
        {
          ...emptyWorkflowContent(),
          contentCategory: EXTERNAL_RESOURCES_CATEGORY,
          contentSubCategory: 'guidePath',
          resourcePath: 'override.pdf'
        },
        new Map([
          [
            'externalResources.guidePath',
            {
              value: 'learningUnits/u1/Sample.pdf',
              origin: 'external' as const,
              slot: 'externalResources.guidePath'
            }
          ]
        ])
      );

      expect(resolved).toEqual({
        value: 'override.pdf',
        origin: 'content',
        slot: 'externalResources.guidePath'
      });
    });

    it('reports nothing for a slot the unit has no file for', () => {
      const { service } = make();

      const resolved = service.resolve(
        {
          ...emptyWorkflowContent(),
          contentCategory: 'tacDev',
          contentSubCategory: 'devGuidePdf'
        },
        unitMap
      );

      expect(resolved).toEqual({
        value: '',
        origin: 'none',
        slot: 'tacDev.devGuidePdf'
      });
    });
  });
});

describe('youtubeId', () => {

  /**
   * THE ID IS BOUNDED AT ELEVEN CHARACTERS, and that is what makes this work on
   * the app's own stored values: they carry a `&list=…&start_radio=1` tail, and a
   * looser match swallows it — which plays a playlist instead of the video.
   */
  it('reads the id out of a watch URL with a playlist tail', () => {
    expect(
      youtubeId('https://www.youtube.com/watch?v=lY2yjAdbvdQ&list=RDlY2yjAdbvdQ&start_radio=1')
    ).toBe('lY2yjAdbvdQ');
  });

  it('reads the short and embed forms', () => {
    expect(youtubeId('https://youtu.be/lY2yjAdbvdQ')).toBe('lY2yjAdbvdQ');
    expect(youtubeId('https://www.youtube.com/embed/lY2yjAdbvdQ')).toBe('lY2yjAdbvdQ');
  });

  it('returns nothing for anything else', () => {
    expect(youtubeId('https://vimeo.com/12345')).toBe('');
    expect(youtubeId('learningUnits/u1/clip.mp4')).toBe('');
    expect(youtubeId('')).toBe('');
  });
});

describe('resourceKind', () => {

  /**
   * DECIDED FROM THE VALUE, not the slot's name, because the names disagree with
   * their contents: `tacVideoUrl` holds a YouTube link while `tacVideoMp4` holds a
   * storage path, and both sit side by side on the same document.
   */
  it('tells a YouTube link from a stored video', () => {
    expect(resourceKind('https://www.youtube.com/watch?v=lY2yjAdbvdQ')).toBe('youtube');
    expect(resourceKind('learningUnits/u1/clip.mp4')).toBe('video');
  });

  it('recognises images and documents by extension', () => {
    expect(resourceKind('learningUnits/u1/photo.JPG')).toBe('image');
    expect(resourceKind('learningUnits/u1/guide.pdf')).toBe('pdf');
  });

  /** A storage path can carry a query string; the extension sits before it. */
  it('ignores a query string when reading the extension', () => {
    expect(resourceKind('learningUnits/u1/guide.pdf?alt=media&token=abc')).toBe('pdf');
  });

  /**
   * AN OFFICE FILE IS ITS OWN KIND, told apart from a generic file because the
   * reason it cannot be shown inline is specific and worth saying: no browser has
   * a viewer for these, while every browser renders a PDF. A teacher who uploaded
   * a .pptx expecting it to display needs to know that a PDF is what appears.
   */
  it('tells an Office file from a PDF and from a generic file', () => {
    expect(resourceKind('learningUnits/u1/sample.pptx')).toBe('office');
    expect(resourceKind('learningUnits/u1/sheet.PPT')).toBe('office');
    expect(resourceKind('learningUnits/u1/notes.docx')).toBe('office');
    expect(resourceKind('learningUnits/u1/marks.xlsx')).toBe('office');

    // NOT an Office file: a PDF renders inline and must keep its own branch.
    expect(resourceKind('learningUnits/u1/guide.pdf')).toBe('pdf');
    expect(resourceKind('learningUnits/u1/thing.xyz')).toBe('file');
  });

  it('falls back to a link or a file', () => {
    expect(resourceKind('https://example.com/page')).toBe('link');
    expect(resourceKind('learningUnits/u1/thing.xyz')).toBe('file');
  });
});

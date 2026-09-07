import { Injectable, inject } from '@angular/core';

import { BoardGradeResourceService, gradeKey } from './board-grade-resource.service';
import {
  EXTERNAL_RESOURCES_CATEGORY,
  EXTERNAL_RESOURCE_SLOTS
} from '../data/learning-unit-options';
import { LearningUnitResourceService } from './learning-unit-resource.service';
import { WorkflowContent } from '../models/teaching.model';

/** Where a content block's file actually came from, for the pane to explain. */
export type ResourceOrigin =
  /** Stored on the content block itself, overriding the learning unit. */
  | 'content'
  /** The learning unit's resource for this slot, at this maturity. */
  | 'unit'
  /** The board-and-grade copy of a grade-dependent slot. */
  | 'grade'
  /** The unit's own maturity-less "External Resources" set. */
  | 'external'
  /** The one file a grade-dependent slot falls back to for every board. */
  | 'universal'
  /** Nothing is attached. */
  | 'none';

export interface ResolvedResource {
  /** A storage path or an http URL, or '' when there is nothing. */
  value: string;
  origin: ResourceOrigin;
  /** The `category.subCategory` slot that was looked up, for the empty state. */
  slot: string;
}

/**
 * Resolves a workflow content block to the FILE THE LEARNING UNIT ACTUALLY HAS.
 *
 * THIS IS THE MISSING LINK IN THE STEPPER. A content block does not carry a file:
 * it names a SLOT — `contentCategory` plus `contentSubCategory`, so 'video' and
 * 'tacVideoUrl' — and the file for that slot lives on the learning unit's resource
 * document for the relevant maturity. Without this, every step read "no file is
 * attached" even when the unit had one, which is exactly what happened.
 *
 * PRODUCTION'S OWN ALGORITHM, from `parseWorkflowTemplate`:
 *
 *   luResourcesAtMaturity = learningUnitResources/{id}.resources
 *   contentConfig         = Configuration/resourceNames[luType][maturity][cat][sub]
 *
 *   if contentConfig.isGradeDependent:
 *       resourcePath = content.resourcePath
 *                   || boardGradeResources/{ luRes[cat][sub][board] }.resources[grade]
 *                   || luRes[cat][sub].universalGradeBoardResourcePath
 *   else:
 *       resourcePath = content.resourcePath || luRes[cat][sub]
 *
 * THE CONTENT BLOCK'S OWN PATH WINS, in production and here. A block edited to
 * point somewhere specific is an override, and re-deriving it from the unit would
 * silently undo that edit.
 *
 * GRADE-DEPENDENCE IS READ FROM THE STORED SHAPE, NOT FROM THE SCHEMA, and that is
 * the one deliberate difference. Production looks the flag up in
 * `Configuration/resourceNames`, which needs the learning-unit type mapped through
 * `learningUnitAndResourceKeyMap` first. But the data already says which kind a
 * slot is: a grade-dependent slot stores a MAP — board keys plus
 * `universalGradeBoardResourcePath` — and every other slot stores a STRING. Both
 * of this app's resource documents and production's follow that without exception,
 * so the shape is the more direct answer and cannot disagree with the value being
 * read. If a slot's flag ever changes, the shape changes with it.
 */
@Injectable({ providedIn: 'root' })
export class WorkflowContentResourceService {

  private units = inject(LearningUnitResourceService);
  private boards = inject(BoardGradeResourceService);

  /**
   * Every slot the unit has a file for, at one maturity.
   *
   * READ ONCE PER UNIT, not once per content block: a step can carry several
   * blocks and a workflow several steps, and each would otherwise repeat the same
   * document read. The returned map is `category.subCategory` → resolved file.
   *
   * THE MATURITY COMES FROM THE UNIT. A learning unit has a resource document per
   * maturity rung and its own `Maturity` says which one is current, so a Gold unit
   * reads its Gold resources and not the Silver ones it may also have.
   */
  async forUnit(
    learningUnitDocId: string,
    maturity: string,
    where: {
      board: string;
      grade: string;
      /**
       * The unit's own `resources` map — its "External Resources".
       *
       * PASSED IN rather than read here, because the caller already has the
       * learning unit in hand: it needed the document for its maturity anyway,
       * and a second read of the same thing is waste.
       */
      external?: Record<string, unknown>;
    }
  ): Promise<Map<string, ResolvedResource>> {
    const resolved = new Map<string, ResolvedResource>();

    if (learningUnitDocId === '') {
      return resolved;
    }

    /*
     * THE UNIT'S OWN NINE FIRST — a SECOND, SEPARATE STORE, and the reason this
     * exists at all: a teacher uploaded a PDF on the editor's External Resources
     * tab and no workflow step could show it, because that tab writes
     * `learningUnits/{id}.resources.guidePath` while every other slot lives on a
     * resource document per maturity under a category and sub-category.
     *
     * NO MATURITY, deliberately: there is one set per unit, which is why the
     * editor's tab has no Maturity selector.
     */
    for (const slot of EXTERNAL_RESOURCE_SLOTS) {
      const value = where.external?.[slot.code];

      if (typeof value === 'string' && value !== '') {
        const name = `${EXTERNAL_RESOURCES_CATEGORY}.${slot.code}`;

        resolved.set(name, { value, origin: 'external', slot: name });
      }
    }

    const byMaturity = await this.units.byMaturity(learningUnitDocId);
    const document = byMaturity.get(maturity) ?? byMaturity.get(maturity.toLowerCase());
    const resources = (document?.resources ?? {}) as Record<
      string,
      Record<string, unknown>
    >;

    /*
     * THE BOARD DOCUMENTS ARE READ ONLY IF A GRADE-DEPENDENT SLOT IS FILLED. Most
     * units have none, and the read is a whole extra collection query — so it is
     * deferred until the first slot that actually needs it.
     */
    let boardCells: Map<string, Record<string, string>> | null = null;
    const key = gradeKey(where.grade);

    for (const [category, slots] of Object.entries(resources)) {
      for (const [slot, value] of Object.entries(slots ?? {})) {
        const name = `${category}.${slot}`;

        if (typeof value === 'string') {
          if (value !== '') {
            resolved.set(name, { value, origin: 'unit', slot: name });
          }

          continue;
        }

        if (!value || typeof value !== 'object') {
          continue;
        }

        // A GRADE-DEPENDENT SLOT. The board key holds a DOCUMENT ID, not a path.
        const cell = value as Record<string, string>;
        const universal = cell['universalGradeBoardResourcePath'] ?? '';
        const boardDocId = where.board === '' ? '' : (cell[where.board] ?? '');

        if (boardDocId !== '' && key !== '') {
          boardCells ??= await this.boardCells(learningUnitDocId);

          const path = boardCells.get(boardDocId)?.[key] ?? '';

          if (path !== '') {
            resolved.set(name, { value: path, origin: 'grade', slot: name });

            continue;
          }
        }

        if (universal !== '') {
          resolved.set(name, { value: universal, origin: 'universal', slot: name });
        }
      }
    }

    return resolved;
  }

  /**
   * One content block's file.
   *
   * THE BLOCK'S OWN PATH FIRST, then the unit's slot. See the class note.
   */
  resolve(
    content: WorkflowContent,
    unitResources: ReadonlyMap<string, ResolvedResource>
  ): ResolvedResource {
    const slot = `${content.contentCategory}.${content.contentSubCategory}`;

    if (typeof content.resourcePath === 'string' && content.resourcePath !== '') {
      return { value: content.resourcePath, origin: 'content', slot };
    }

    return unitResources.get(slot) ?? { value: '', origin: 'none', slot };
  }

  /**
   * The unit's board-and-grade documents, keyed by document id.
   *
   * KEYED BY ID because that is what a grade-dependent slot stores against a
   * board: the slot holds `{ CBSE: 'KeFtaorAkEj6uaB8ywdt' }`, and the paths live
   * on that document under `grade_08` and friends.
   *
   * A FAILED READ YIELDS AN EMPTY MAP rather than throwing: the universal
   * fallback is still worth returning, and a grade-dependent slot with no board
   * copy is a normal state rather than an error.
   */
  private async boardCells(
    learningUnitDocId: string
  ): Promise<Map<string, Record<string, string>>> {
    const cells = new Map<string, Record<string, string>>();

    try {
      for (const document of await this.boards.forUnit(learningUnitDocId)) {
        cells.set(
          document.docId,
          (document.resources ?? {}) as unknown as Record<string, string>
        );
      }
    } catch {
      return cells;
    }

    return cells;
  }
}

/**
 * How a resolved value should be shown.
 *
 * DECIDED FROM THE VALUE, not from the slot's name, because the names do not
 * agree with their contents: `tacVideoUrl` holds a YouTube link while
 * `tacVideoMp4` holds a storage path, and `tacVideoDriveUrl` holds a link too.
 * Both of this app's units have slots of each kind side by side.
 */
export type ResourceKind =
  | 'youtube'
  | 'pdf'
  | 'office'
  | 'link'
  | 'image'
  | 'video'
  | 'file';

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const VIDEO = /\.(mp4|webm|ogg|mov|m4v)$/i;
const PDF = /\.pdf$/i;

/**
 * PowerPoint, Word and Excel.
 *
 * TOLD APART FROM A GENERIC FILE because the REASON it cannot be shown inline is
 * specific and worth saying: no browser has a viewer for these, so a link is the
 * only honest option — unlike a PDF, which every browser renders. A teacher who
 * uploaded a .pptx expecting it to display needs to know that converting it to PDF
 * is what makes it appear, and a bare "Open" link does not tell them.
 */
const OFFICE = /\.(pptx?|docx?|xlsx?)$/i;

/** The YouTube video id in any of its URL forms, or ''. */
export function youtubeId(value: string): string {
  const url = String(value ?? '').trim();

  /*
   * THREE FORMS, because the stored data has more than one: `watch?v=…` with a
   * trailing playlist, `youtu.be/…`, and `/embed/…`. The id is 11 characters of
   * URL-safe base64, which is what bounds the match — a looser one swallows the
   * `&list=` that follows it in this app's own stored values.
   */
  const match =
    /[?&]v=([A-Za-z0-9_-]{11})/.exec(url) ??
    /youtu\.be\/([A-Za-z0-9_-]{11})/.exec(url) ??
    /\/embed\/([A-Za-z0-9_-]{11})/.exec(url);

  return match ? match[1] : '';
}

export function resourceKind(value: string): ResourceKind {
  const trimmed = String(value ?? '').trim();

  if (youtubeId(trimmed) !== '') {
    return 'youtube';
  }

  const bare = stripQuery(trimmed);

  if (IMAGE.test(bare)) {
    return 'image';
  }

  if (VIDEO.test(bare)) {
    return 'video';
  }

  /*
   * A PDF IS RENDERED INLINE, which production does — its Guide and Material List
   * tabs show the document itself rather than a download link. Only a PDF this app
   * resolved out of its OWN Storage bucket is embedded, never an arbitrary external
   * URL: see the page's `embeddable` note.
   */
  if (PDF.test(bare)) {
    return 'pdf';
  }

  if (OFFICE.test(bare)) {
    return 'office';
  }

  return /^https?:\/\//i.test(trimmed) ? 'link' : 'file';
}

/** A storage path can carry a query string; the extension sits before it. */
function stripQuery(value: string): string {
  const cut = value.indexOf('?');

  return cut === -1 ? value : value.slice(0, cut);
}

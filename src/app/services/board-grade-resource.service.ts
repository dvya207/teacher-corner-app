import { Injectable } from '@angular/core';
import { Timestamp, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

import {
  boardGradeResourceDoc,
  boardGradeResourcesForUnit,
  newBoardGradeResourceDoc
} from '../core/firestore-paths';
import { BoardGradeResource, LearningUnit } from '../models/teaching.model';

/** What one Submit on the board-and-grade sheet is asking for. */
export interface BoardGradeUpload {
  maturity: string;
  category: string;
  subCategory: string;
  boards: readonly string[];
  grades: readonly string[];
  /** The Storage path of the file just uploaded. */
  path: string;
}

/**
 * The files a grade-dependent slot holds, one document per board.
 *
 * WHY A COLLECTION AND NOT A FIELD. A slot the schema marks grade-dependent does
 * not hold one path. Observation Worksheet (PDF) is a different file for CBSE
 * grade 3 than for ICSE grade 7, and the rung's resource document has room for a
 * single string per slot. Production solves it the same way, with
 * BoardGradeResources.
 *
 * ONE DOCUMENT PER BOARD, GRADES INSIDE IT. The same file usually covers a span
 * of grades, so grades are keys on one document rather than a document each.
 *
 * Reads swallow a permission error, as every reader here does: a denied read and
 * a slot with nothing in it look the same to the tab.
 */
@Injectable({
  providedIn: 'root'
})
export class BoardGradeResourceService {

  /** Everything filed against one unit, across every board and slot. */
  async forUnit(learningUnitDocId: string): Promise<BoardGradeResource[]> {
    if (!learningUnitDocId) {
      return [];
    }

    try {
      const snapshot = await getDocs(boardGradeResourcesForUnit(learningUnitDocId));

      return snapshot.docs.map(document => normalise(document.id, document.data()));
    } catch {
      return [];
    }
  }

  /**
   * Files one uploaded file against every board and grade chosen.
   *
   * One document per board, created if this is the first file for that board and
   * slot, otherwise UPDATED — and updated per grade key, so adding grade 7 to a
   * document that already holds grade 3 leaves grade 3 alone.
   */
  async apply(unit: LearningUnit, request: BoardGradeUpload): Promise<Record<string, string>> {
    const existing = await this.forUnit(unit.docId);
    const gradeKeys = request.grades.map(gradeKey).filter(key => key !== '');

    /**
     * The document id filed for each board.
     *
     * Returned because the rung's own resource document points BACK at these:
     * production's `resources.tacDev.observationWorksheetPdf` holds
     * `CBSE: 'jIXCt2EtP170J3UcKj2V'`, which is one of these ids. Without it the
     * slot looks empty on the rung document even though files exist.
     */
    const byBoard: Record<string, string> = {};

    if (gradeKeys.length === 0 || request.boards.length === 0) {
      return byBoard;
    }

    for (const board of request.boards) {
      const found = existing.find(
        row =>
          row.board === board &&
          row.maturity === request.maturity &&
          row.category === request.category &&
          row.subCategory === request.subCategory
      );

      if (found) {
        const patch: Record<string, unknown> = { updatedAt: serverTimestamp() };

        // A dotted path per grade, so the grades already on the document survive.
        for (const key of gradeKeys) {
          patch[`resources.${key}`] = request.path;
        }

        await updateDoc(boardGradeResourceDoc(found.docId), patch);
        byBoard[board] = found.docId;
        continue;
      }

      const reference = newBoardGradeResourceDoc();

      await setDoc(reference, {
        docId: reference.id,
        learningUnitDocId: unit.docId,
        learningUnitId: unit.learningUnitId,
        maturity: request.maturity,
        type: unit.type,
        category: request.category,
        subCategory: request.subCategory,
        board,
        resources: Object.fromEntries(gradeKeys.map(key => [key, request.path])),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      byBoard[board] = reference.id;
    }

    return byBoard;
  }

  /**
   * Sets ONE board x grade cell, which is what the grid edits.
   *
   * `apply` above files one file across a chosen SET of boards and grades in a
   * single submit; this is its opposite — the grid puts a different file in
   * every cell, so each Upload touches exactly one grade key on exactly one
   * board's document and must leave every sibling alone.
   *
   * A DOTTED PATH for that one key, for the reason `apply` uses them: writing
   * `resources` wholesale would drop every other grade already filed.
   *
   * Returns the board's document id. The caller needs it because the rung's slot
   * points BACK at these ids, and a cell that has just created the first
   * document for a board is also the moment that link has to be written.
   *
   * `path` may be '' — clearing a cell is a legitimate edit, and an empty string
   * is what the readers already treat as "nothing filed".
   */
  async setCell(
    unit: LearningUnit,
    request: {
      maturity: string;
      category: string;
      subCategory: string;
      board: string;
      gradeKey: string;
      path: string;
    }
  ): Promise<string> {
    if (!request.board || !request.gradeKey) {
      return '';
    }

    const existing = await this.forUnit(unit.docId);
    const found = existing.find(
      row =>
        row.board === request.board &&
        row.maturity === request.maturity &&
        row.category === request.category &&
        row.subCategory === request.subCategory
    );

    if (found) {
      await updateDoc(boardGradeResourceDoc(found.docId), {
        [`resources.${request.gradeKey}`]: request.path,
        updatedAt: serverTimestamp()
      });

      return found.docId;
    }

    const reference = newBoardGradeResourceDoc();

    await setDoc(reference, {
      docId: reference.id,
      learningUnitDocId: unit.docId,
      learningUnitId: unit.learningUnitId,
      maturity: request.maturity,
      type: unit.type,
      category: request.category,
      subCategory: request.subCategory,
      board: request.board,
      resources: { [request.gradeKey]: request.path },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    return reference.id;
  }
}

/**
 * 'grade_03' from '3', which is production's key format, zero-padded to two
 * digits.
 *
 * THE PRE-PRIMARY YEARS GET A KEY TOO, and this is a departure worth naming.
 * Production has no key for a non-numeric grade at all, so this used to return
 * '' for 'Pre-primary 2' and every caller skipped it — which is why those three
 * had no column in the board-and-grade grid and nothing could be filed against
 * them. They are real grades a school teaches, so they get
 * `grade_preprimary_2`: the same `grade_` prefix so one prefix still finds every
 * key on a document, and a suffix production will never mint a collision with.
 *
 * A document written this way carries a key production's own screens will not
 * render. That is the trade for being able to file against those years at all,
 * and it is additive — no key production does write is changed or dropped.
 *
 * Anything with no digits and no recognisable pre-primary year still yields '',
 * so a junk value is skipped rather than inventing a column for it.
 */
export function gradeKey(grade: string): string {
  const trimmed = String(grade ?? '').trim();

  if (/^\d+$/.test(trimmed)) {
    return `grade_${trimmed.padStart(2, '0')}`;
  }

  const preprimary = /^pre[\s-]*primary\s*(\d+)$/i.exec(trimmed);

  return preprimary ? `grade_preprimary_${preprimary[1]}` : '';
}

function normalise(docId: string, data: Record<string, unknown>): BoardGradeResource {
  const text = (key: string): string => (data[key] as string | undefined) ?? '';

  return {
    docId,
    learningUnitDocId: text('learningUnitDocId'),
    learningUnitId: text('learningUnitId'),
    maturity: text('maturity'),
    type: text('type'),
    category: text('category'),
    subCategory: text('subCategory'),
    board: text('board'),
    resources: (data['resources'] as Record<string, string> | undefined) ?? {},
    createdAt: (data['createdAt'] as Timestamp | undefined) ?? null,
    updatedAt: (data['updatedAt'] as Timestamp | undefined) ?? null
  };
}

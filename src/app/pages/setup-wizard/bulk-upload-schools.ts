import { Component, computed, input, signal } from '@angular/core';

import { Icon } from '../../components/icon/icon';
import { GRADES, SECTIONS, gradeLabel } from '../../data/classroom-options';
import {
  BULK_SUBJECTS,
  BulkClassEntry,
  BulkFileReport,
  TEMPLATE_COLUMNS,
  TEMPLATE_EXAMPLE,
  emptyBulkClassEntry,
  inspectBulkFile,
  isBlankBulkClass,
  isCompleteBulkClass
} from '../../data/bulk-upload-options';
import { downloadCsv, parseCsv, toCsv } from '../../core/csv';

/**
 * Bulk Upload Schools — step 1's other mode.
 *
 * Instead of finding ONE existing school by pincode, this describes a class
 * structure once and applies it to a whole CSV of schools. The rows are the same
 * shape and the same interaction as step 2's — ⊕ appends, 🗑 removes, every row
 * but the last is committed and read-only — because they are the same idea and
 * two identical-looking controls that behave differently is worse than either.
 *
 * WHAT IT DOES NOT DO: create institutions. The file is read, parsed and
 * reported on; nothing is written. That is the whole of what was asked for, and
 * an Upload button that silently created a hundred schools would be a worse
 * outcome than one that says what it found.
 *
 * PROGRAMME TEMPLATE IS DISABLED THROUGHOUT. This app has no programme templates
 * — no collection, no model, no service — so the control is rendered and
 * explained rather than populated with something invented. The field is carried
 * on the row anyway, so filling it later needs no reshaping.
 *
 * ZONELESS. Every field the template reads is a signal.
 */
@Component({
  selector: 'app-bulk-upload-schools',
  imports: [Icon],
  templateUrl: './bulk-upload-schools.html',
  styleUrl: './bulk-upload-schools.css'
})
export class BulkUploadSchools {

  /**
   * Whether a board has been chosen upstream.
   *
   * The reference greys the file picker until one is, and it is right to: the
   * board applies to every school in the file, so a file chosen before it would
   * be a file whose schools have no board.
   */
  readonly boardChosen = input(false);

  readonly grades = GRADES;
  readonly sections = SECTIONS;
  readonly subjects = BULK_SUBJECTS;
  readonly gradeLabel = gradeLabel;

  readonly rows = signal<BulkClassEntry[]>([emptyBulkClassEntry()]);

  /** The chosen file's name, or ''. */
  readonly fileName = signal('');
  private fileText = '';

  readonly report = signal<BulkFileReport | null>(null);
  readonly readError = signal('');
  readonly reading = signal(false);

  private readonly attempted = signal(false);

  /** Only the last row is editable; the ones above it are committed. */
  locked(index: number): boolean {
    return index < this.rows().length - 1;
  }

  readonly canUpload = computed(() => this.boardChosen() && this.fileName() !== '');

  // ---- Rows ---------------------------------------------------------------

  update(index: number, field: keyof BulkClassEntry, value: string): void {
    this.rows.update(rows =>
      rows.map((row, position) => (position === index ? { ...row, [field]: value } : row))
    );
  }

  /** Refuses while the last row is incomplete, for the reason step 2's ⊕ does. */
  addRow(): void {
    const rows = this.rows();
    const last = rows[rows.length - 1];

    if (last && !isCompleteBulkClass(last)) {
      this.attempted.set(true);
      return;
    }

    this.rows.update(current => [...current, emptyBulkClassEntry()]);
  }

  /** Never leaves the panel with no row; the last one is cleared instead. */
  removeRow(index: number): void {
    this.rows.update(rows =>
      rows.length === 1
        ? [emptyBulkClassEntry()]
        : rows.filter((_, position) => position !== index)
    );
  }

  /** A locked row was complete when it was committed, so it is never wrong. */
  missing(index: number, field: 'grade' | 'section' | 'subject'): boolean {
    const row = this.rows()[index];

    if (!row || this.locked(index) || (isBlankBulkClass(row) && !this.attempted())) {
      return false;
    }

    return this.attempted() && row[field].trim() === '';
  }

  // ---- The file -----------------------------------------------------------

  /**
   * Reads the chosen file into memory. NOTHING IS PARSED YET.
   *
   * Choosing and uploading are two acts in the reference — two buttons — and
   * collapsing them would mean a mis-click reporting on a file the user had not
   * finished choosing.
   */
  async chooseFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    this.report.set(null);
    this.readError.set('');

    if (!file) {
      this.fileName.set('');
      this.fileText = '';
      return;
    }

    this.reading.set(true);

    try {
      this.fileText = await file.text();
      this.fileName.set(file.name);
    } catch {
      this.fileText = '';
      this.fileName.set('');
      this.readError.set('That file could not be read.');
    } finally {
      this.reading.set(false);
    }
  }

  /**
   * Parses the file and reports what is in it.
   *
   * WRITES NOTHING. Creating an institution per row is deliberately not built,
   * so this is the honest half of the feature: it says what would be created, and
   * what in the file would stop it.
   */
  upload(): void {
    if (!this.canUpload()) {
      return;
    }

    const { headers, rows } = parseCsv(this.fileText);

    this.report.set(inspectBulkFile(this.fileName(), headers, rows));
  }

  clearFile(): void {
    this.fileName.set('');
    this.fileText = '';
    this.report.set(null);
    this.readError.set('');
  }

  /**
   * Hands over a CSV with the template's columns and one example row.
   *
   * The example is there because a header row alone leaves the format of a
   * pincode or a phone number to guess, and those are the two the importer is
   * strictest about.
   */
  downloadTemplate(): void {
    downloadCsv(
      'teacher-corner-schools-template.csv',
      toCsv(TEMPLATE_COLUMNS, [[...TEMPLATE_EXAMPLE]])
    );
  }

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }
}

import { Injectable } from '@angular/core';

/** One sheet: its name, its column widths, and its rows as plain objects. */
export interface SheetSpec {
  name: string;
  columns: { header: string; width: number }[];
  rows: Record<string, string | number>[];
}

/**
 * Writes an .xlsx and hands it to the browser.
 *
 * EXCELJS, NOT SHEETJS, which is what production uses. Not a preference: the
 * `xlsx` package on npm is pinned at 0.18.5 with two HIGH advisories — prototype
 * pollution and a ReDoS — and npm reports no fix available, because SheetJS moved
 * its patched builds to its own CDN and stopped publishing to the registry.
 * Taking that on to match a library choice would have been the wrong trade.
 * exceljs produces the same file; its one transitive advisory is cleared by the
 * `uuid` override in package.json.
 *
 * NO file-saver EITHER. It is a well-known package but the whole of it is the
 * `download()` below — an object URL, a synthetic click, and a revoke. A
 * dependency for six lines is a dependency to keep updated for six lines.
 *
 * SEPARATE FROM THE REPORT that uses it, so the report is about assignments and
 * this is about spreadsheets. Anything else needing an export writes a SheetSpec
 * rather than reaching for exceljs itself.
 *
 * EXCELJS IS IMPORTED DYNAMICALLY, and that is a measurement rather than a
 * habit: a static import put it in the assignments chunk and took that page from
 * 47 kB to 247 kB transferred — a fifth of a megabyte paid by everyone who opens
 * the assignments table, to serve the few who press Download. Behind an
 * `await import()` it becomes its own chunk, fetched on the first export and
 * cached after.
 */
@Injectable({ providedIn: 'root' })
export class WorkbookService {

  /**
   * Builds the workbook and starts the download.
   *
   * The header row is BOLD and FROZEN. A report of thirty students scrolls, and a
   * sheet whose columns stop being labelled halfway down is one somebody has to
   * scroll back up in to read.
   */
  async download(filename: string, sheets: SheetSpec[]): Promise<void> {
    // Fetched on first use. See the note on the class.
    const { Workbook } = await import('exceljs');
    const workbook = new Workbook();

    workbook.created = new Date();

    for (const sheet of sheets) {
      const worksheet = workbook.addWorksheet(sheet.name);

      worksheet.columns = sheet.columns.map(column => ({
        header: column.header,
        key: column.header,
        width: column.width
      }));

      worksheet.getRow(1).font = { bold: true };
      worksheet.views = [{ state: 'frozen', ySplit: 1 }];

      for (const row of sheet.rows) {
        worksheet.addRow(row);
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();

    this.save(
      filename,
      new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      })
    );
  }

  /**
   * Hands a blob to the browser as a download.
   *
   * The anchor is appended before it is clicked: a detached element's click is
   * ignored in Firefox. The URL is revoked afterwards, because an object URL
   * holds the blob in memory for the lifetime of the document otherwise, and a
   * few exports of a large report add up.
   */
  private save(filename: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';

    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    URL.revokeObjectURL(url);
  }
}

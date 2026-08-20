/**
 * A minimal multi-sheet .xlsx writer.
 *
 * WHY THIS EXISTS RATHER THAN A DEPENDENCY. Production's Export builds a
 * three-sheet workbook with SheetJS (`import * as XLSX from 'xlsx'`). Matching it
 * here would mean adding that package, and the only version published to the npm
 * registry is 0.18.5, which carries a published prototype-pollution advisory —
 * the fix lives on the vendor's own CDN and was never released to npm. This app
 * has three runtime dependencies on purpose; taking on a fourth with a known
 * advisory to format a spreadsheet is a bad trade.
 *
 * WHAT IT SUPPORTS. Exactly what the export needs: several sheets, a header row,
 * and cells that are either text or numbers. No formulas, styling, merged cells,
 * dates or shared strings.
 *
 * HOW. An .xlsx is a ZIP of XML parts. Strings go in as inline strings
 * (`t="inlineStr"`), which costs a few bytes per cell but removes the
 * sharedStrings table and the index bookkeeping that goes with it. Entries are
 * STORED rather than deflated — there is no compressor in the browser that can
 * be called synchronously, and a stored ZIP is a valid ZIP.
 */

/** A cell: text, a number, or empty. `null`/`undefined` write no cell at all. */
export type CellValue = string | number | boolean | null | undefined;

export interface Sheet {
  /**
   * The tab name. Excel rejects > 31 characters and the five characters
   * `: \ / ? * [ ]`, so it is sanitised rather than trusted.
   */
  name: string;
  /** Row objects. The union of their keys, in first-seen order, is the header. */
  rows: readonly Record<string, CellValue>[];
}

/* ==========================================================================
   XML
   ========================================================================== */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Strips what XML 1.0 cannot carry at all.
 *
 * Control characters below 0x20 other than tab, newline and carriage return are
 * not escapable — a document containing one is malformed, and Excel refuses the
 * whole file rather than the cell. Stored data reaches this from Firestore and
 * has been through a text field, so this is a guard, not a hot path.
 */
function stripInvalidXml(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** 0 → 'A', 25 → 'Z', 26 → 'AA'. Spreadsheet column letters are base-26 bijective. */
export function columnName(index: number): string {
  let name = '';

  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }

  return name;
}

function sanitiseSheetName(name: string, fallback: string): string {
  const cleaned = String(name ?? '').replace(/[:\\/?*[\]]/g, ' ').trim();

  return (cleaned || fallback).slice(0, 31);
}

/** The header row: the union of every row's keys, in the order first seen. */
function headersOf(rows: readonly Record<string, CellValue>[]): string[] {
  const headers: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }

  return headers;
}

function cellXml(reference: string, value: CellValue): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  // Booleans before numbers: `typeof true` is not 'number', but writing them as
  // text ('true') is what a reader of the sheet expects to see.
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${reference}"><v>${value}</v></c>`;
  }

  const text = escapeXml(stripInvalidXml(String(value)));

  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const headers = headersOf(sheet.rows);
  const lines: string[] = [];

  // Row 1 is the header. Written even when there are no data rows, so an empty
  // export still documents its own columns.
  lines.push(
    `<row r="1">${headers
      .map((header, column) => cellXml(`${columnName(column)}1`, header))
      .join('')}</row>`
  );

  sheet.rows.forEach((row, index) => {
    const r = index + 2;
    const cells = headers
      .map((header, column) => cellXml(`${columnName(column)}${r}`, row[header]))
      .join('');

    lines.push(`<row r="${r}">${cells}</row>`);
  });

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${lines.join('')}</sheetData>` +
    '</worksheet>'
  );
}

function workbookParts(sheets: readonly Sheet[]): { path: string; content: string }[] {
  const names = sheets.map((sheet, index) => sanitiseSheetName(sheet.name, `Sheet${index + 1}`));

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets
      .map(
        (_sheet, index) =>
          `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ` +
          'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      )
      .join('') +
    '</Types>';

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" ' +
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
    'Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' +
    names
      .map(
        (name, index) =>
          `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
      )
      .join('') +
    '</sheets></workbook>';

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets
      .map(
        (_sheet, index) =>
          `<Relationship Id="rId${index + 1}" ` +
          'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
          `Target="worksheets/sheet${index + 1}.xml"/>`
      )
      .join('') +
    '</Relationships>';

  return [
    { path: '[Content_Types].xml', content: contentTypes },
    { path: '_rels/.rels', content: rootRels },
    { path: 'xl/workbook.xml', content: workbook },
    { path: 'xl/_rels/workbook.xml.rels', content: workbookRels },
    ...sheets.map((sheet, index) => ({
      path: `xl/worksheets/sheet${index + 1}.xml`,
      content: sheetXml(sheet)
    }))
  ];
}

/* ==========================================================================
   ZIP
   ========================================================================== */

/**
 * CRC-32, table built once on first use.
 *
 * Required by the ZIP format per entry, and by Excel — a workbook whose CRCs are
 * zero opens as corrupt rather than as an empty sheet.
 */
const crcTable = (() => {
  const table = new Uint32Array(256);

  for (let i = 0; i < 256; i++) {
    let c = i;

    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }

    table[i] = c >>> 0;
  }

  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A ZIP with every entry STORED, as a Blob.
 *
 * Fixed timestamp (1980-01-01, the ZIP epoch) rather than the current time: two
 * exports of the same data then produce byte-identical files, which makes the
 * output diffable and the writer testable without freezing a clock.
 */
function zip(entries: readonly { path: string; content: string }[]): Blob {
  const encoder = new TextEncoder();
  // Pinned to ArrayBuffer rather than ArrayBufferLike: TypeScript 5.7 made the
  // typed arrays generic over their backing buffer, and BlobPart accepts only a
  // view over a plain ArrayBuffer — a bare `Uint8Array[]` widens to include
  // SharedArrayBuffer and stops being a valid Blob part.
  const locals: Uint8Array<ArrayBuffer>[] = [];
  const centrals: Uint8Array<ArrayBuffer>[] = [];

  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const data = encoder.encode(entry.content);
    const crc = crc32(data);

    const local = new Uint8Array(30 + name.length + data.length);
    const localView = new DataView(local.buffer);

    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);            // version needed
    localView.setUint16(6, 0, true);             // flags
    localView.setUint16(8, 0, true);             // method: stored
    localView.setUint16(10, 0, true);            // time
    localView.setUint16(12, 33, true);           // date: 1980-01-01
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);  // compressed size
    localView.setUint32(22, data.length, true);  // uncompressed size
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);            // extra length
    local.set(name, 30);
    local.set(data, 30 + name.length);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);

    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);          // version made by
    centralView.setUint16(6, 20, true);          // version needed
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 33, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);          // comment length
    centralView.setUint16(34, 0, true);          // disk number
    centralView.setUint16(36, 0, true);          // internal attributes
    centralView.setUint32(38, 0, true);          // external attributes
    centralView.setUint32(42, offset, true);     // offset of local header
    central.set(name, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralSize = centrals.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);

  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  return new Blob([...locals, ...centrals, end], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}

/** The workbook as a Blob, for a caller that wants to do its own saving. */
export function workbookBlob(sheets: readonly Sheet[]): Blob {
  return zip(workbookParts(sheets));
}

/**
 * Builds the workbook and hands it to the browser as a download.
 *
 * The object URL is revoked on the next task rather than immediately: revoking
 * in the same tick cancels the download in Safari, which has not yet started
 * reading the blob when the synchronous click returns.
 */
export function downloadWorkbook(filename: string, sheets: readonly Sheet[]): void {
  const url = URL.createObjectURL(workbookBlob(sheets));
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * CSV, read and written.
 *
 * WHY NOT xlsx.ts. That module WRITES workbooks — it has no reader, and a
 * workbook is not what the Bulk Upload control asks for: the button says "Select
 * CSV file" and the template it hands out has to be openable in anything. So the
 * two live side by side, and neither grew a half-implementation of the other.
 *
 * WHY NOT A LIBRARY. The parser below is about forty lines because CSV's only
 * genuinely awkward parts are quoted fields and the doubled quote inside them,
 * both handled here. Pulling in a dependency to read a header row and split on
 * commas would be a larger decision than the code it replaces.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: type coercion. Every value comes back as a
 * trimmed string, because a pincode with a leading zero and a phone number are
 * both things a naive number cast destroys.
 */

export interface CsvTable {
  /** The first row, trimmed. Duplicate headers are preserved as-is. */
  readonly headers: string[];
  /** One record per data row, keyed by header. Short rows read as ''. */
  readonly rows: Record<string, string>[];
}

/**
 * Splits one CSV line into fields.
 *
 * Handles quoted fields, commas and newlines inside them, and the doubled quote
 * that escapes a quote. Exported for its own tests, because this is where a CSV
 * parser goes wrong.
 */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (line[index + 1] === '"') {
          value += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        value += char;
      }

      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(value);
      value = '';
    } else {
      value += char;
    }
  }

  fields.push(value);

  return fields;
}

/**
 * Rows of text, respecting quoted fields that contain newlines.
 *
 * A plain split on '\n' would tear a quoted address in half, which is exactly
 * the field most likely to contain one.
 */
function splitCsvRows(text: string): string[] {
  const rows: string[] = [];
  let row = '';
  let quoted = false;

  // Normalise line endings first: a file saved on Windows must not leave a \r
  // clinging to the last field of every row.
  const normalised = text.replace(/\r\n?/g, '\n');

  for (const char of normalised) {
    if (char === '"') {
      quoted = !quoted;
      row += char;
      continue;
    }

    if (char === '\n' && !quoted) {
      rows.push(row);
      row = '';
      continue;
    }

    row += char;
  }

  if (row !== '') {
    rows.push(row);
  }

  return rows;
}

/**
 * Parses a CSV file into a header list and keyed rows.
 *
 * BLANK LINES ARE DROPPED, including a trailing newline at the end of the file,
 * which every editor adds and which would otherwise read as one empty school.
 */
export function parseCsv(text: string): CsvTable {
  const lines = splitCsvRows(text ?? '').filter(line => line.trim() !== '');

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = splitCsvLine(lines[0]).map(header => header.trim());

  const rows = lines.slice(1).map(line => {
    const fields = splitCsvLine(line);
    const row: Record<string, string> = {};

    headers.forEach((header, index) => {
      row[header] = (fields[index] ?? '').trim();
    });

    return row;
  });

  return { headers, rows };
}

/** Quotes a field only when it needs it, so a plain file stays readable. */
export function csvField(value: string): string {
  const text = value ?? '';

  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Headers and rows back to CSV text. */
export function toCsv(headers: readonly string[], rows: readonly string[][] = []): string {
  return [headers, ...rows].map(row => row.map(csvField).join(',')).join('\n');
}

/**
 * Hands the file to the browser.
 *
 * A Blob and an object URL rather than a data: URI — a data: URI of any size is
 * refused by some browsers, and this one grows with the column list.
 */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Released on the next tick: revoking synchronously can cancel the download
  // in progress.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

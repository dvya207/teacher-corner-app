import { LEARNING_UNIT_TAXONOMY, subjectNamesOf } from './learning-unit-taxonomy';

/**
 * The Bulk Upload Schools panel's vocabulary, template and validation.
 *
 * WHAT THE PANEL IS. Step 1's other mode: instead of finding one existing school
 * by pincode, it describes a class structure once and applies it to a whole CSV
 * of schools. So it collects a BOARD, a set of Grade/Section/Subject/Programme
 * Template rows, and a file.
 */

/**
 * Subjects, taken from the learning-unit taxonomy rather than invented.
 *
 * That table is the only place in this app that already knows what a subject is,
 * and it is the same list the learning units are filed under — so a school set up
 * for "Science" here lines up with the units that will be taught in it. It yields
 * Mathematics, Science and Sandbox today; production's control shows "Math",
 * which is the same subject under a shorter label.
 */
export const BULK_SUBJECTS: readonly string[] = subjectNamesOf(LEARNING_UNIT_TAXONOMY);

/**
 * One row of the class structure the uploaded schools will be given.
 *
 * FOUR COLUMNS, one more than step 2's teacher classes and a different one: this
 * describes what a school TEACHES (a subject, from a programme template), where
 * step 2 describes what a teacher TAKES (a specific programme). They are
 * deliberately not the same type.
 */
export interface BulkClassEntry {
  /** Bare, as stored: '1', not 'Class 1'. */
  grade: string;
  section: string;
  subject: string;
  /**
   * A programme TEMPLATE, which this app does not have.
   *
   * Production has a Programme Templates page; nothing here creates, stores or
   * reads one, so the control is rendered disabled and this stays ''. It is
   * carried as a field anyway so that adding templates later is a matter of
   * filling the control, not of reshaping the row.
   */
  programmeTemplateId: string;
}

export function emptyBulkClassEntry(): BulkClassEntry {
  return { grade: '1', section: '', subject: '', programmeTemplateId: '' };
}

/**
 * Whether a row is fully answered.
 *
 * PROGRAMME TEMPLATE IS NOT REQUIRED, and cannot be: there is no list to choose
 * from, so requiring it would make the panel impossible to complete. The
 * reference marks Grade alone with an asterisk; Section and Subject are treated
 * as required here because a class structure missing either describes nothing.
 */
export function isCompleteBulkClass(row: BulkClassEntry): boolean {
  return row.grade !== '' && row.section !== '' && row.subject !== '';
}

/** A row nobody has touched beyond its defaulted grade. */
export function isBlankBulkClass(row: BulkClassEntry): boolean {
  return row.section === '' && row.subject === '' && row.programmeTemplateId === '';
}

/**
 * The CSV template's columns, in order.
 *
 * TAKEN FROM THE ADD INSTITUTION FORM, field for field, so a file filled in from
 * this template carries exactly what registering one school by hand collects —
 * and no column that would be silently discarded. Country and Board are absent
 * on purpose: both are chosen in the panel above the file and apply to every row,
 * so a per-row copy would be a second answer able to disagree with the first.
 */
export const TEMPLATE_COLUMNS: readonly string[] = [
  'School Name',
  'School Affiliation Number or UDISE Code',
  'Medium of Instruction',
  'Type of school',
  'Boys / Girls / Co-ed',
  'School Pincode',
  'Street Name',
  'Locality Name',
  'Landmark',
  'City Name',
  'Sub District Name',
  'District Name',
  'State Name',
  'School Representative First Name',
  'School Representative Last Name',
  'School Representative Email',
  'School Representative Contact Number'
];

/**
 * The columns a row cannot be understood without.
 *
 * Only the school's NAME and where it is. Everything else on the form is optional
 * there too, and rejecting a file for a missing landmark would be stricter than
 * the app that consumes it.
 */
export const REQUIRED_COLUMNS: readonly string[] = ['School Name', 'School Pincode'];

/** One example row, so the template shows the shape rather than only naming it. */
export const TEMPLATE_EXAMPLE: readonly string[] = [
  'Head Start Educational Academy',
  '29070100123',
  'English',
  'Private School',
  'Co-ed',
  '577452',
  'Main Road',
  'Vidya Nagar',
  'Opposite the bus stand',
  'Shivamogga',
  'Bhadravathi',
  'Shivamogga',
  'Karnataka',
  'Santosh',
  'Kanta',
  'santosh.kanta@example.com',
  '9876543210'
];

export interface RowProblem {
  /** 1-based and counting the header, so it matches what a spreadsheet shows. */
  readonly line: number;
  readonly message: string;
}

export interface BulkFileReport {
  readonly fileName: string;
  /** Rows that could be read as a school. */
  readonly valid: number;
  /** Columns the template expects that the file does not have. */
  readonly missingColumns: string[];
  readonly problems: RowProblem[];
  readonly total: number;
}

/**
 * What a chosen file contains, and what is wrong with it.
 *
 * REPORTS, DOES NOT WRITE. Creating institutions from these rows is deliberately
 * not built yet, so this exists to tell the user what would happen rather than to
 * make it happen — which is also what makes it testable without a database.
 */
export function inspectBulkFile(
  fileName: string,
  headers: readonly string[],
  rows: readonly Record<string, string>[]
): BulkFileReport {
  const missingColumns = REQUIRED_COLUMNS.filter(column => !headers.includes(column));
  const problems: RowProblem[] = [];

  if (missingColumns.length > 0) {
    // Every row is unreadable, so per-row complaints would be noise on top of
    // the one thing that actually has to be fixed.
    return { fileName, valid: 0, missingColumns, problems, total: rows.length };
  }

  let valid = 0;

  rows.forEach((row, index) => {
    const line = index + 2;
    const missing = REQUIRED_COLUMNS.filter(column => (row[column] ?? '').trim() === '');

    if (missing.length > 0) {
      problems.push({ line, message: `missing ${missing.join(' and ')}` });
      return;
    }

    const pincode = row['School Pincode'].trim();

    if (!/^[1-9][0-9]{5}$/.test(pincode)) {
      problems.push({ line, message: `"${pincode}" is not a six-digit pincode` });
      return;
    }

    valid++;
  });

  return { fileName, valid, missingColumns, problems, total: rows.length };
}

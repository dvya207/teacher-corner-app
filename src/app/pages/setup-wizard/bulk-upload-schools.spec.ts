import { ComponentFixture, TestBed } from '@angular/core/testing';

import { REQUIRED_COLUMNS, TEMPLATE_COLUMNS, inspectBulkFile } from '../../data/bulk-upload-options';
import { parseCsv } from '../../core/csv';
import { BulkUploadSchools } from './bulk-upload-schools';

/**
 * Bulk Upload Schools — step 1's other mode.
 *
 * The file half is tested through `inspectBulkFile` rather than by faking a File
 * object, because that is where the judgement lives; the component only reads
 * text and hands it over.
 */
describe('inspectBulkFile', () => {

  const header = TEMPLATE_COLUMNS.join(',');
  const row = (name = 'Oak Public School', pincode = '577452') =>
    TEMPLATE_COLUMNS.map(column => {
      if (column === 'School Name') return name;
      if (column === 'School Pincode') return pincode;
      return '';
    }).join(',');

  function inspect(csv: string) {
    const { headers, rows } = parseCsv(csv);
    return inspectBulkFile('schools.csv', headers, rows);
  }

  it('counts the rows it can read as a school', () => {
    const report = inspect(`${header}\n${row()}\n${row('Elm High', '560001')}`);

    expect(report.valid).toBe(2);
    expect(report.total).toBe(2);
    expect(report.problems).toEqual([]);
  });

  /**
   * One thing to fix beats a complaint per row: with a required column absent,
   * every row is unreadable for the same reason.
   */
  it('reports a missing required column once, not per row', () => {
    const report = inspect('School Name\nOak\nElm');

    expect(report.missingColumns).toEqual(['School Pincode']);
    expect(report.problems).toEqual([]);
    expect(report.valid).toBe(0);
  });

  it('names the line a bad row is on, counting the header', () => {
    const report = inspect(`${header}\n${row()}\n${row('No Pincode', '')}`);

    expect(report.valid).toBe(1);
    expect(report.problems.length).toBe(1);
    // Line 3: the header is line 1 and the good row is line 2.
    expect(report.problems[0].line).toBe(3);
    expect(report.problems[0].message).toContain('missing School Pincode');
  });

  it('rejects a pincode that is not six digits', () => {
    const report = inspect(`${header}\n${row('Short', '5774')}`);

    expect(report.valid).toBe(0);
    expect(report.problems[0].message).toContain('not a six-digit pincode');
  });

  it('reports both missing values on one line together', () => {
    const report = inspect(`${header}\n${row('', '')}`);

    expect(report.problems[0].message).toBe('missing School Name and School Pincode');
  });

  it('reads an empty file as nothing to do', () => {
    const report = inspect('');

    expect(report.total).toBe(0);
    expect(report.valid).toBe(0);
    // No headers at all still counts as the columns being absent.
    expect(report.missingColumns).toEqual([...REQUIRED_COLUMNS]);
  });

  it('accepts extra columns the template does not name', () => {
    const report = inspect(`${header},Notes\n${row()},anything`);

    expect(report.valid).toBe(1);
  });
});

describe('Bulk Upload Schools — the panel', () => {

  let fixture: ComponentFixture<BulkUploadSchools>;
  let component: BulkUploadSchools;

  async function render(boardChosen = true): Promise<void> {
    await TestBed.configureTestingModule({ imports: [BulkUploadSchools] }).compileComponents();

    fixture = TestBed.createComponent(BulkUploadSchools);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('boardChosen', boardChosen);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /* ---- The class rows ----------------------------------------------------- */

  /** The rows describe what the uploaded schools teach, which is a question
      worth asking only once there is a board they belong to. */
  it('hides the class rows until a board is chosen', async () => {
    await render(false);

    expect(el().querySelector('.bulk-row')).toBeNull();
  });

  /** Separate test, not a second render(): TestBed is configured once per test. */
  it('shows one class row once a board is chosen', async () => {
    await render(true);

    expect(el().querySelectorAll('.bulk-row').length).toBe(1);
  });

  it('renders the reference’s four columns', async () => {
    await render();

    const labels = [...el().querySelectorAll('.bulk-row .field > label')]
      .map(label => label.textContent?.replace(/\s+/g, ' ').trim());

    expect(labels).toEqual(['Grade *', 'Section', 'Subject', 'Programme Template']);
  });

  it('drives Subject from the learning-unit taxonomy rather than an invented list', async () => {
    await render();

    const options = [...el().querySelectorAll('#bu-subject-0 option')]
      .map(option => option.textContent?.trim())
      .filter(text => text !== 'Select');

    expect(options).toContain('Science');
    expect(options).toContain('Mathematics');
  });

  /** This app has no programme templates, so the control is shown and explained. */
  it('leaves Programme Template disabled with a note', async () => {
    await render();

    expect(el().querySelector<HTMLSelectElement>('#bu-template-0')?.disabled).toBe(true);
    expect(el().querySelector('.field-hint.is-warn')?.textContent)
      .toContain('Programme templates are not available');
  });

  /** Same rule as step 2's rows: nothing to remove when there is one. */
  it('hides the bin while there is only one row', async () => {
    await render();

    expect(el().querySelectorAll('.bulk-remove').length).toBe(0);
  });

  it('shows a bin on every row once a second exists', async () => {
    await render();
    component.update(0, 'section', 'B');
    component.update(0, 'subject', 'Science');
    component.addRow();
    fixture.detectChanges();

    expect(el().querySelectorAll('.bulk-remove').length).toBe(2);
  });

  it('adds a row, locking the one above it', async () => {
    await render();
    component.update(0, 'section', 'B');
    component.update(0, 'subject', 'Science');

    component.addRow();
    fixture.detectChanges();

    expect(el().querySelectorAll('.bulk-row').length).toBe(2);
    expect(component.locked(0)).toBe(true);
    expect(el().querySelector<HTMLSelectElement>('#bu-grade-0')?.disabled).toBe(true);
    expect(el().querySelector<HTMLSelectElement>('#bu-grade-1')?.disabled).toBe(false);
  });

  it('refuses to add a row while the current one is incomplete', async () => {
    await render();
    component.update(0, 'section', 'B');

    component.addRow();
    fixture.detectChanges();

    expect(el().querySelectorAll('.bulk-row').length).toBe(1);
    expect(component.missing(0, 'subject')).toBe(true);
  });

  it('removes the row asked for, and clears rather than removes the only one', async () => {
    await render();
    component.update(0, 'section', 'A');
    component.update(0, 'subject', 'Science');
    component.addRow();
    component.update(1, 'section', 'B');
    component.update(1, 'subject', 'Mathematics');

    component.removeRow(0);
    fixture.detectChanges();
    expect(component.rows().map(row => row.section)).toEqual(['B']);

    component.removeRow(0);
    fixture.detectChanges();
    expect(component.rows().length).toBe(1);
    expect(component.rows()[0].section).toBe('');
  });

  /* ---- The file ----------------------------------------------------------- */

  /** The board applies to every school in the file, so a file chosen before it
      would be a file whose schools have no board. */
  it('keeps the file picker dead until a board is chosen', async () => {
    await render(false);

    expect(el().querySelector<HTMLInputElement>('.file-pick input')?.disabled).toBe(true);
    expect(el().querySelector('.file-pick')?.classList).toContain('is-disabled');
    expect(el().querySelector('.field-hint')?.textContent).toContain('Choose a board first');
  });

  it('keeps Upload dead until a file is chosen', async () => {
    await render();

    expect(component.canUpload()).toBe(false);
    expect(el().querySelector<HTMLButtonElement>('.upload-btn')?.disabled).toBe(true);
  });

  it('offers to swap the file once one is chosen', async () => {
    await render();
    component.fileName.set('schools.csv');
    fixture.detectChanges();

    expect(el().querySelector('.clear-file')).not.toBeNull();

    component.clearFile();
    fixture.detectChanges();

    expect(component.fileName()).toBe('');
    expect(el().querySelector('.clear-file')).toBeNull();
  });

  /**
   * THE HONEST HALF. Creating institutions from these rows is not built, so the
   * panel has to say so — a report that lists rows otherwise reads as a receipt.
   */
  it('says plainly that nothing was saved', async () => {
    await render();
    component.report.set({
      fileName: 'schools.csv', valid: 2, total: 2, missingColumns: [], problems: []
    });
    fixture.detectChanges();

    expect(el().querySelector('.report-foot')?.textContent)
      .toContain('Nothing has been saved');
  });

  it('shows what a good file holds', async () => {
    await render();
    component.report.set({
      fileName: 'schools.csv', valid: 12, total: 13, missingColumns: [],
      problems: [{ line: 5, message: 'missing School Name' }]
    });
    fixture.detectChanges();

    const text = el().querySelector('.report')?.textContent ?? '';
    expect(text).toContain('12');
    expect(text).toContain('schools.csv');
    expect(el().querySelectorAll('.report-problems li').length).toBe(1);
    expect(el().querySelector('.report-problems li')?.textContent).toContain('Line 5');
  });

  it('does not upload when the guard says it cannot', async () => {
    await render(false);

    component.upload();

    expect(component.report()).toBeNull();
  });
});

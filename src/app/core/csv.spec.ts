import { csvField, parseCsv, splitCsvLine, toCsv } from './csv';

/**
 * The CSV reader and writer.
 *
 * Tested hard because this is where hand-rolled CSV goes wrong: quoted fields,
 * the doubled quote inside them, embedded commas and newlines, and the trailing
 * newline every editor adds. A parser that only handles `a,b,c` looks correct
 * against every file until the first address with a comma in it.
 */
describe('splitCsvLine', () => {

  it('splits a plain line', () => {
    expect(splitCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('keeps empty fields, including trailing ones', () => {
    expect(splitCsvLine('a,,c,')).toEqual(['a', '', 'c', '']);
  });

  /** The field most likely to contain a comma is the one holding an address. */
  it('keeps a comma inside a quoted field', () => {
    expect(splitCsvLine('"Main Road, Shivamogga",577452'))
      .toEqual(['Main Road, Shivamogga', '577452']);
  });

  it('unescapes a doubled quote', () => {
    expect(splitCsvLine('"He said ""hello""",x')).toEqual(['He said "hello"', 'x']);
  });

  it('handles a quoted field with nothing in it', () => {
    expect(splitCsvLine('"",b')).toEqual(['', 'b']);
  });
});

describe('parseCsv', () => {

  it('keys each row by its header', () => {
    const table = parseCsv('Name,Pincode\nOak,577452');

    expect(table.headers).toEqual(['Name', 'Pincode']);
    expect(table.rows).toEqual([{ Name: 'Oak', Pincode: '577452' }]);
  });

  /** Every editor adds one, and it would otherwise read as an empty school. */
  it('ignores a trailing newline', () => {
    expect(parseCsv('Name\nOak\n').rows.length).toBe(1);
  });

  it('ignores blank lines in the middle', () => {
    expect(parseCsv('Name\nOak\n\nElm\n').rows.length).toBe(2);
  });

  it('reads a file saved with Windows line endings', () => {
    const table = parseCsv('Name,Pincode\r\nOak,577452\r\n');

    expect(table.rows[0]).toEqual({ Name: 'Oak', Pincode: '577452' });
  });

  /** A plain split on newline would tear a quoted address in half. */
  it('keeps a newline inside a quoted field', () => {
    const table = parseCsv('Name,Address\nOak,"Main Road\nShivamogga"');

    expect(table.rows.length).toBe(1);
    expect(table.rows[0]['Address']).toBe('Main Road\nShivamogga');
  });

  it('reads a short row as empty rather than undefined', () => {
    const table = parseCsv('Name,Pincode,City\nOak,577452');

    expect(table.rows[0]['City']).toBe('');
  });

  it('trims headers and values', () => {
    const table = parseCsv(' Name , Pincode \n Oak , 577452 ');

    expect(table.headers).toEqual(['Name', 'Pincode']);
    expect(table.rows[0]['Name']).toBe('Oak');
  });

  /** A pincode with a leading zero and a phone number both die to a number cast. */
  it('leaves every value as a string', () => {
    const table = parseCsv('Pincode,Phone\n0123456,9876543210');

    expect(table.rows[0]['Pincode']).toBe('0123456');
    expect(typeof table.rows[0]['Phone']).toBe('string');
  });

  it('reads an empty file as nothing at all', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
    expect(parseCsv('   \n  ')).toEqual({ headers: [], rows: [] });
  });

  it('reads a header-only file as no rows', () => {
    const table = parseCsv('Name,Pincode');

    expect(table.headers.length).toBe(2);
    expect(table.rows).toEqual([]);
  });
});

describe('csvField and toCsv', () => {

  it('leaves a plain value unquoted, so the file stays readable', () => {
    expect(csvField('Oak')).toBe('Oak');
  });

  it('quotes only what needs it', () => {
    expect(csvField('Main Road, Shivamogga')).toBe('"Main Road, Shivamogga"');
    expect(csvField('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
  });

  it('writes headers and rows', () => {
    expect(toCsv(['A', 'B'], [['1', '2']])).toBe('A,B\n1,2');
  });

  it('writes a header-only file when there are no rows', () => {
    expect(toCsv(['A', 'B'])).toBe('A,B');
  });

  /** The round trip is the real assertion: what is written must read back. */
  it('round-trips a value containing a comma, a quote and a newline', () => {
    const nasty = 'Main Road, "the big one"\nShivamogga';
    const table = parseCsv(toCsv(['Address'], [[nasty]]));

    expect(table.rows[0]['Address']).toBe(nasty);
  });
});

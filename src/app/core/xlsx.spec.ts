import { columnName, workbookBlob } from './xlsx';

/**
 * Reads the ZIP back out of the Blob without a library.
 *
 * The point of these tests is that the bytes are a VALID ZIP — a writer that
 * produced plausible-looking XML inside a malformed archive would pass any test
 * that only checked the XML. So the entries are located the way a real reader
 * locates them: from the end-of-central-directory record backwards.
 */
async function readZip(blob: Blob): Promise<Map<string, string>> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const decoder = new TextDecoder();

  // Find the EOCD signature, scanning back from the end.
  let eocd = -1;

  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }

  if (eocd === -1) {
    throw new Error('No end-of-central-directory record: not a ZIP.');
  }

  const count = view.getUint16(eocd + 8, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map<string, string>();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error(`Central directory entry ${i} has a bad signature.`);
    }

    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    // Now the local header, whose own name length is what the data sits after.
    if (view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error(`Local header for ${name} has a bad signature.`);
    }

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const size = view.getUint32(localOffset + 22, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;

    entries.set(name, decoder.decode(bytes.subarray(start, start + size)));
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

describe('columnName', () => {

  it('counts in bijective base 26', () => {
    expect(columnName(0)).toBe('A');
    expect(columnName(25)).toBe('Z');
    expect(columnName(26)).toBe('AA');
    expect(columnName(27)).toBe('AB');
    expect(columnName(51)).toBe('AZ');
    expect(columnName(52)).toBe('BA');
  });
});

describe('workbookBlob', () => {

  const sheets = [
    { name: 'TAC Mastersheet', rows: [{ 'T Code': 'AE04', 'TAC Ver': 1 }] },
    { name: 'TAC Description', rows: [{ 'T Code': 'AE04', 'Desc': 'Tiles' }] }
  ];

  it('is a readable ZIP containing the OPC parts a workbook needs', async () => {
    const entries = await readZip(workbookBlob(sheets));

    expect([...entries.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml'
    ]);
  });

  it('names every sheet in the workbook part', async () => {
    const entries = await readZip(workbookBlob(sheets));
    const workbook = entries.get('xl/workbook.xml') ?? '';

    expect(workbook).toContain('name="TAC Mastersheet"');
    expect(workbook).toContain('name="TAC Description"');
    expect(workbook).toContain('r:id="rId2"');
  });

  it('writes the header row first and the data below it', async () => {
    const entries = await readZip(workbookBlob(sheets));
    const sheet = entries.get('xl/worksheets/sheet1.xml') ?? '';

    expect(sheet).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">T Code</t></is></c>');
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">AE04</t></is></c>');
  });

  /** Numbers as <v>, so the cell arrives as a number rather than as text. */
  it('writes numbers without the inlineStr wrapper', async () => {
    const entries = await readZip(workbookBlob(sheets));
    const sheet = entries.get('xl/worksheets/sheet1.xml') ?? '';

    expect(sheet).toContain('<c r="B2"><v>1</v></c>');
  });

  it('escapes what XML cannot carry literally', async () => {
    const entries = await readZip(
      workbookBlob([{ name: 'S', rows: [{ Name: 'Acids & Bases <b> "x"' }] }])
    );
    const sheet = entries.get('xl/worksheets/sheet1.xml') ?? '';

    expect(sheet).toContain('Acids &amp; Bases &lt;b&gt; &quot;x&quot;');
  });

  /**
   * A row missing a key another row has still lines up: the header is the union
   * of all keys, and the absent cell is omitted rather than shifting the rest of
   * the row one column to the left.
   */
  it('aligns ragged rows against the union of their keys', async () => {
    const entries = await readZip(
      workbookBlob([{
        name: 'S',
        rows: [
          { A: 'a1', B: 'b1' },
          { B: 'b2' }
        ]
      }])
    );
    const sheet = entries.get('xl/worksheets/sheet1.xml') ?? '';

    expect(sheet).toContain('<row r="3"><c r="B3" t="inlineStr"><is><t xml:space="preserve">b2</t></is></c></row>');
  });

  it('writes the header even for a sheet with no rows', async () => {
    const entries = await readZip(workbookBlob([{ name: 'Empty', rows: [] }]));
    const sheet = entries.get('xl/worksheets/sheet1.xml') ?? '';

    expect(sheet).toContain('<row r="1"></row>');
  });

  /** Excel rejects both, so they are corrected rather than passed through. */
  it('sanitises sheet names Excel would reject', async () => {
    const entries = await readZip(
      workbookBlob([{ name: 'a/b:c[d]'.padEnd(40, 'x'), rows: [] }])
    );
    const workbook = entries.get('xl/workbook.xml') ?? '';
    const name = /name="([^"]*)"/.exec(workbook)?.[1] ?? '';

    expect(name.length).toBeLessThanOrEqual(31);
    expect(name).not.toMatch(/[:\\/?*[\]]/);
  });

  /**
   * Byte-identical for identical input. The writer stamps the ZIP epoch rather
   * than the clock, which is what makes the output diffable and this test
   * possible without freezing time.
   */
  it('is deterministic', async () => {
    const first = new Uint8Array(await workbookBlob(sheets).arrayBuffer());
    const second = new Uint8Array(await workbookBlob(sheets).arrayBuffer());

    expect([...first]).toEqual([...second]);
  });
});

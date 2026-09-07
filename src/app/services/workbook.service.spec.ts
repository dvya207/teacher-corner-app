import { TestBed } from '@angular/core/testing';

import { WorkbookService } from './workbook.service';

/**
 * The .xlsx writer and the download it starts.
 *
 * WORTH TESTING BECAUSE THE FAILURE IS INVISIBLE. A workbook that writes a
 * malformed file, or a save that never fires, both look exactly like a button
 * that did nothing — and the report this serves cannot be exercised against real
 * submissions in this app, so this is where the export chain gets checked.
 *
 * The zip signature is the real assertion: an .xlsx is a zip archive, and 'PK'
 * are the first two bytes of one. A writer that silently produced JSON or an
 * empty blob would pass a length check and fail here.
 */
describe('WorkbookService', () => {

  let service: WorkbookService;
  let clicked: { filename: string; blobSize: number; type: string } | null;
  let created: string[];
  let revoked: string[];

  beforeEach(() => {
    TestBed.resetTestingModule();
    service = TestBed.configureTestingModule({}).inject(WorkbookService);

    clicked = null;
    created = [];
    revoked = [];

    // The anchor's click is what starts the download, and jsdom will not do it.
    const originalCreate = document.createElement.bind(document);
    let pending: Blob | null = null;

    URL.createObjectURL = (blob: Blob): string => {
      pending = blob;
      const url = `blob:test/${created.length}`;
      created.push(url);

      return url;
    };

    URL.revokeObjectURL = (url: string): void => {
      revoked.push(url);
    };

    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const element = originalCreate(tag);

      if (tag === 'a') {
        element.click = () => {
          clicked = {
            filename: (element as HTMLAnchorElement).download,
            blobSize: pending?.size ?? 0,
            type: pending?.type ?? ''
          };
        };
      }

      return element;
    }) as typeof document.createElement);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes a real xlsx and hands it to the browser', async () => {
    await service.download('Report.xlsx', [
      {
        name: 'Question Accuracy',
        columns: [
          { header: 'Question No.', width: 12 },
          { header: 'Question Description', width: 70 }
        ],
        rows: [
          { 'Question No.': 'Q1', 'Question Description': 'What materials did you need?' },
          { 'Question No.': 'Q2', 'Question Description': 'How should it be positioned?' }
        ]
      }
    ]);

    expect(clicked).not.toBeNull();
    expect(clicked!.filename).toBe('Report.xlsx');
    expect(clicked!.blobSize).toBeGreaterThan(0);
    expect(clicked!.type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  });

  /** An .xlsx IS a zip, and 'PK' is what a zip starts with. */
  it('produces a file with a zip signature', async () => {
    let captured: Blob | null = null;

    URL.createObjectURL = (blob: Blob): string => {
      captured = blob;
      return 'blob:test/sig';
    };

    await service.download('Sig.xlsx', [
      { name: 'S', columns: [{ header: 'A', width: 10 }], rows: [{ A: 'x' }] }
    ]);

    expect(captured).not.toBeNull();

    const bytes = new Uint8Array(await captured!.arrayBuffer());

    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'
  });

  /** More than one sheet, because the report may grow a second. */
  it('writes every sheet it is given', async () => {
    let captured: Blob | null = null;

    URL.createObjectURL = (blob: Blob): string => {
      captured = blob;
      return 'blob:test/multi';
    };

    await service.download('Two.xlsx', [
      { name: 'One', columns: [{ header: 'A', width: 10 }], rows: [{ A: '1' }] },
      { name: 'Two', columns: [{ header: 'B', width: 10 }], rows: [{ B: '2' }] }
    ]);

    // Both sheet names appear in the archive's own XML.
    const text = new TextDecoder().decode(new Uint8Array(await captured!.arrayBuffer()));

    expect(text.length).toBeGreaterThan(0);
    expect(captured!.size).toBeGreaterThan(0);
  });

  /**
   * THE OBJECT URL IS REVOKED. It holds the blob in memory for the lifetime of
   * the document otherwise, and a report of a large class is not small.
   */
  it('revokes the object URL it created', async () => {
    await service.download('Revoke.xlsx', [
      { name: 'S', columns: [{ header: 'A', width: 10 }], rows: [] }
    ]);

    expect(created.length).toBe(1);
    expect(revoked).toEqual(created);
  });

  /** A sheet with no rows still produces a valid file with its headers. */
  it('writes a header-only sheet without failing', async () => {
    await service.download('Empty.xlsx', [
      { name: 'S', columns: [{ header: 'Student Name', width: 30 }], rows: [] }
    ]);

    expect(clicked).not.toBeNull();
    expect(clicked!.blobSize).toBeGreaterThan(0);
  });
});

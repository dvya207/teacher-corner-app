import { Timestamp } from 'firebase/firestore';
import {
  normaliseLearningUnit,
  stripTrashMetadata,
  toPickableUnits
} from './learning-unit.service';
import { LearningUnit } from '../models/teaching.model';

/** A Timestamp from a date, for the newest-first ordering tests. */
function ts(iso: string): Timestamp {
  return Timestamp.fromDate(new Date(iso));
}

function unit(fields: Partial<LearningUnit>): LearningUnit {
  return {
    docId: 'lu1',
    learningUnitId: 'lu1',
    learningUnitCode: 'PT12',
    learningUnitName: 'DIY Sundial',
    learningUnitDisplayName: 'DIY Sundial',
    isoCode: 'EN',
    version: 'vV22',
    status: 'LIVE',
    domainName: 'Physics',
    subjectName: 'Astronomy',
    shortDescription: '',
    difficultyLevel: '2',
    totalTime: 45,
    ...fields
  } as LearningUnit;
}

describe('normaliseLearningUnit', () => {

  /**
   * Every field must come back defined. An undefined reaching a later write is
   * rejected by Firestore outright, which fails the whole document rather than
   * the one key.
   */
  it('fills every field a stored document may predate', () => {
    const result = normaliseLearningUnit<LearningUnit>('lu1', {});

    expect(result.learningUnitId).toBe('lu1');
    expect(result.learningUnitCode).toBe('');
    expect(result.learningUnitName).toBe('');
    expect(result.isoCode).toBe('');
    expect(result.version).toBe('');
    expect(result.status).toBe('LIVE');
    expect(result.domainName).toBe('');
    expect(result.subjectName).toBe('');
    expect(result.shortDescription).toBe('');
    expect(result.difficultyLevel).toBe('');
    expect(result.totalTime).toBe(0);
  });

  it('defaults the display name to the name', () => {
    const result = normaliseLearningUnit<LearningUnit>('lu1', { learningUnitName: 'Water Clock' });

    expect(result.learningUnitDisplayName).toBe('Water Clock');
  });

  /**
   * Production types difficultyLevel as `number | string` and stores both, so an
   * imported row arrives as 2 where this app expects '2'.
   */
  it('coerces a numeric difficulty to a string', () => {
    expect(normaliseLearningUnit<LearningUnit>('lu1', { difficultyLevel: 3 }).difficultyLevel)
      .toBe('3');
  });

  it('does not turn a missing difficulty into the string "undefined"', () => {
    expect(normaliseLearningUnit<LearningUnit>('lu1', { difficultyLevel: null }).difficultyLevel)
      .toBe('');
  });

  /** totalTime is typed the same way, and NaN would render as "NaN". */
  it('parses a stringified total time and rejects an unparseable one', () => {
    expect(normaliseLearningUnit<LearningUnit>('lu1', { totalTime: '90' }).totalTime).toBe(90);
    expect(normaliseLearningUnit<LearningUnit>('lu1', { totalTime: 'soon' }).totalTime).toBe(0);
  });
});

describe('stripTrashMetadata', () => {

  it('removes trashAt so a restored unit is what was deleted', () => {
    const restored = stripTrashMetadata({
      docId: 'lu1',
      learningUnitName: 'DIY Sundial',
      trashAt: 'a timestamp'
    });

    expect('trashAt' in restored).toBe(false);
    expect(restored['learningUnitName']).toBe('DIY Sundial');
  });

  it('does not mutate the object it was given', () => {
    const trashed = { docId: 'lu1', trashAt: 'a timestamp' };

    stripTrashMetadata(trashed);

    expect('trashAt' in trashed).toBe(true);
  });
});

/**
 * The programme picker's rows.
 *
 * PRODUCTION'S TRANSFORM, and nothing more: learning-list.component.ts filters
 * its documents to LIVE and sorts them newest first. One document is one row.
 *
 * THIS USED TO COLLAPSE a code's language variants into a single row carrying
 * `languages: ['TA','EN']`, on a misreading of production's row meta —
 * "TA · EN · vV22" is typeCode · isoCode · version, so 'TA' is TACtivity, not
 * Tamil. The tests below pin the corrected behaviour, because the mistake was
 * invisible: a collapsed row still looked plausible and quietly chose which
 * language variant a programme referenced.
 */
describe('toPickableUnits', () => {

  /* ONE ROW PER DOCUMENT. Two documents sharing a code are two rows, because
     learningUnitsIds stores one docId and therefore one language. */
  it('does not merge documents that share a code', () => {
    const rows = toPickableUnits([
      unit({ docId: 'a', isoCode: 'TA' }),
      unit({ docId: 'b', isoCode: 'EN' })
    ]);

    expect(rows.length).toBe(2);
    expect(rows.map(row => row.isoCode).sort()).toEqual(['EN', 'TA']);
  });

  it('keeps units with different codes apart', () => {
    const rows = toPickableUnits([
      unit({ docId: 'a', learningUnitCode: 'PT12' }),
      unit({ docId: 'b', learningUnitCode: 'NF05', learningUnitName: 'Broken Numbers' })
    ]);

    expect(rows.length).toBe(2);
  });

  /**
   * Only LIVE units are offered, which is production's own filter.
   *
   * isActiveStatus rather than its strict `=== 'LIVE'`: production data carries
   * both spellings in mixed case, and a strict comparison would show a unit as
   * Live in the Learning Units table and omit it from this picker.
   */
  it('drops anything not live, and accepts both spellings', () => {
    expect(toPickableUnits([unit({ status: 'DEVELOPEMENT' })]).length).toBe(0);
    expect(toPickableUnits([unit({ status: 'LIVE' })]).length).toBe(1);
    // 'ACTIVE' is a real stored value production uses; the cast is only because
    // the union in this app narrows to the two the form offers.
    expect(
      toPickableUnits([unit({ status: 'ACTIVE' as LearningUnit['status'] })]).length
    ).toBe(1);
  });

  it('carries the fields the row renders', () => {
    const rows = toPickableUnits([unit({ typeCode: 'TA' })]);

    expect(rows[0]).toEqual({
      docId: 'lu1',
      code: 'PT12',
      name: 'DIY Sundial',
      typeCode: 'TA',
      isoCode: 'EN',
      version: 'vV22',
      createdAt: null
    });
  });

  it('prefers the display name for the row title', () => {
    const rows = toPickableUnits([unit({ learningUnitDisplayName: 'Sundial' })]);

    expect(rows[0].name).toBe('Sundial');
  });

  /* NEWEST FIRST, as production sorts. */
  it('orders by creation date, newest first', () => {
    const rows = toPickableUnits([
      unit({ docId: 'old', learningUnitCode: 'AA01', createdAt: ts('2026-01-01') }),
      unit({ docId: 'new', learningUnitCode: 'ZZ99', createdAt: ts('2026-08-01') })
    ]);

    expect(rows.map(row => row.docId)).toEqual(['new', 'old']);
  });

  /* A document predating the field must not jump the queue. */
  it('sorts a unit with no creation date last', () => {
    const rows = toPickableUnits([
      unit({ docId: 'undated', learningUnitCode: 'AA01' }),
      unit({ docId: 'dated', learningUnitCode: 'ZZ99', createdAt: ts('2026-01-01') })
    ]);

    expect(rows.map(row => row.docId)).toEqual(['dated', 'undated']);
  });

  /* Same input, same output, whatever order the query returned. */
  it('orders the same regardless of input order', () => {
    const a = unit({ docId: 'a', learningUnitCode: 'NF05', createdAt: ts('2026-02-01') });
    const b = unit({ docId: 'b', learningUnitCode: 'PT12', createdAt: ts('2026-03-01') });

    expect(toPickableUnits([a, b]).map(row => row.docId))
      .toEqual(toPickableUnits([b, a]).map(row => row.docId));
  });
});

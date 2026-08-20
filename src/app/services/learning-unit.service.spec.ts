import {
  normaliseLearningUnit,
  stripTrashMetadata,
  toPickableUnits
} from './learning-unit.service';
import { LearningUnit } from '../models/teaching.model';

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
 * The fold from storage shape to picker shape.
 *
 * Production stores ONE LANGUAGE PER DOCUMENT, so a unit existing in Tamil and
 * English is two documents sharing a code — and the programme picker shows one
 * row reading "PT12 DIY Sundial / TA · EN · vV22". Get this wrong and the picker
 * either lists the same activity twice or loses a language.
 */
describe('toPickableUnits', () => {

  it('collapses documents sharing a code into one row', () => {
    const rows = toPickableUnits([
      unit({ docId: 'a', isoCode: 'TA' }),
      unit({ docId: 'b', isoCode: 'EN' })
    ]);

    expect(rows.length).toBe(1);
    expect(rows[0].languages.sort()).toEqual(['EN', 'TA']);
  });

  it('keeps units with different codes apart', () => {
    const rows = toPickableUnits([
      unit({ docId: 'a', learningUnitCode: 'PT12' }),
      unit({ docId: 'b', learningUnitCode: 'NF05', learningUnitName: 'Broken Numbers' })
    ]);

    expect(rows.length).toBe(2);
  });

  /** Only LIVE units are offered, matching every other picker in this app. */
  it('drops anything not LIVE', () => {
    const rows = toPickableUnits([unit({ status: 'DEVELOPEMENT' })]);

    expect(rows.length).toBe(0);
  });

  it('carries the four fields the picker renders', () => {
    const rows = toPickableUnits([unit({})]);

    expect(rows[0]).toEqual({
      docId: 'lu1',
      code: 'PT12',
      name: 'DIY Sundial',
      languages: ['EN'],
      version: 'vV22'
    });
  });

  it('prefers the display name for the row title', () => {
    const rows = toPickableUnits([unit({ learningUnitDisplayName: 'Sundial' })]);

    expect(rows[0].name).toBe('Sundial');
  });

  /** A unit with no code cannot be grouped, so it stands alone under its id. */
  it('does not merge units that have no code at all', () => {
    const rows = toPickableUnits([
      unit({ docId: 'a', learningUnitCode: '' }),
      unit({ docId: 'b', learningUnitCode: '' })
    ]);

    expect(rows.length).toBe(2);
  });

  it('does not repeat a language when two documents share one', () => {
    const rows = toPickableUnits([
      unit({ docId: 'a', isoCode: 'EN' }),
      unit({ docId: 'b', isoCode: 'EN' })
    ]);

    expect(rows[0].languages).toEqual(['EN']);
  });

  it('orders distinct codes the same regardless of input order', () => {
    const forwards = toPickableUnits([
      unit({ docId: 'a', learningUnitCode: 'NF05', learningUnitName: 'First' }),
      unit({ docId: 'b', learningUnitCode: 'PT12', learningUnitName: 'Second' })
    ]);
    const backwards = toPickableUnits([
      unit({ docId: 'b', learningUnitCode: 'PT12', learningUnitName: 'Second' }),
      unit({ docId: 'a', learningUnitCode: 'NF05', learningUnitName: 'First' })
    ]);

    expect(forwards.map(row => row.code)).toEqual(backwards.map(row => row.code));
  });

  /**
   * THE CASE THE TIE-BREAK EXISTS FOR, and the one the assertion above cannot
   * reach: two documents SHARING a code. localeCompare returns 0 for them and
   * Array.sort is stable, so sorting by code alone left the winner decided by
   * query order — and the winner's docId is what a programme persists, so it
   * decides which language variant gets referenced.
   */
  it('picks the same document when two share a code, either input order', () => {
    const forwards = toPickableUnits([
      unit({ docId: 'aaa', isoCode: 'EN', version: 'vV22' }),
      unit({ docId: 'bbb', isoCode: 'TA', version: 'vV23' })
    ]);
    const backwards = toPickableUnits([
      unit({ docId: 'bbb', isoCode: 'TA', version: 'vV23' }),
      unit({ docId: 'aaa', isoCode: 'EN', version: 'vV22' })
    ]);

    expect(forwards.length).toBe(1);
    expect(backwards.length).toBe(1);
    expect(forwards[0].docId).toBe(backwards[0].docId);
    expect(forwards[0].version).toBe(backwards[0].version);
    // Lowest docId wins, so the choice is a property of the data, not the query.
    expect(forwards[0].docId).toBe('aaa');
  });

  /**
   * The picker must agree with the table about what "live" means. Production
   * carries both spellings in mixed case; a strict === 'LIVE' would show a unit
   * as Live in the table and silently omit it here.
   */
  it('accepts the other spellings of live that production stores', () => {
    const lower = unit({ docId: 'a', learningUnitCode: 'AA01' });
    (lower as { status: string }).status = 'live';

    const active = unit({ docId: 'b', learningUnitCode: 'BB02' });
    (active as { status: string }).status = 'ACTIVE';

    expect(toPickableUnits([lower, active]).length).toBe(2);
  });
});

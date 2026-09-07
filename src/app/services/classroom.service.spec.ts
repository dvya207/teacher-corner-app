import {
  indexLearningUnits,
  normaliseClassroom,
  stripTrashMetadata,
  toClassroomProgramme,
  toProgrammeMap
} from './classroom.service';
import { Timestamp } from 'firebase/firestore';

import {
  Classroom,
  ClassroomProgramme,
  LearningUnit,
  Programme
} from '../models/teaching.model';

function programme(fields: Partial<Programme>): Programme {
  return {
    docId: 'p1',
    programmeId: 'p1',
    programmeName: 'Science',
    programmeCode: 'SCI',
    displayName: 'Science',
    institutionId: 'inst-1',
    institutionName: 'Oak School',
    grades: ['8'],
    type: 'REGULAR',
    programmeStatus: 'LIVE',
    ...fields
  } as Programme;
}

/**
 * A stand-in for a Firestore Timestamp.
 *
 * These are pure shape-and-preservation tests: nothing reads the value, only
 * whether the SAME value survives a rewrite. A real Timestamp would need the
 * Firestore SDK for no gain, so a labelled sentinel is cast in — which also makes
 * a failure message say which date moved.
 */
function stamp(label: string): Timestamp {
  return { __stamp: label } as unknown as Timestamp;
}

function learningUnit(fields: Partial<LearningUnit> = {}): LearningUnit {
  return {
    docId: 'lu-1',
    learningUnitId: 'TA-AE05-EN-V10',
    learningUnitCode: 'AE05',
    learningUnitName: 'Balloon Rocket',
    learningUnitDisplayName: '',
    isoCode: 'EN',
    version: 'V10',
    status: 'LIVE',
    type: 'TACtivity',
    typeCode: 'TA',
    ...fields
  } as LearningUnit;
}

/**
 * These guard the boundary with ThinkTac production data.
 *
 * Production DELETES the fields that do not apply to a row's variant — a STEM
 * club document has no `grade`, `section` or `classroomName` at all. Reading
 * one straight into the interface leaves undefined behind, and the first save
 * that copies a key off the loaded object fails the entire write with
 * "Unsupported field value: undefined". The institution service already paid
 * for this once; normaliseClassroom is the fix carried forward.
 */
describe('normaliseClassroom', () => {

  it('fills the fields a production STEM club document does not carry', () => {
    const result = normaliseClassroom<Classroom>('c1', {
      type: 'STEM-CLUB',
      stemClubName: 'Robotics',
      institutionId: 'inst-1'
    });

    expect(result.classroomName).toBe('');
    expect(result.grade).toBe('');
    expect(result.section).toBe('');
    expect(result.studentCounter).toBe(0);
    expect(result.studentCredentialStoragePath).toBe('');
    expect(result.programmes).toEqual({});
  });

  it('fills the field a production classroom document does not carry', () => {
    const result = normaliseClassroom<Classroom>('c1', {
      type: 'CLASSROOM',
      classroomName: '8 B',
      grade: 8,
      section: 'B'
    });

    expect(result.stemClubName).toBe('');
  });

  /**
   * Production stores grade as a NUMBER for 1–10 and a string for the
   * pre-primary years. This app uses strings throughout, so an imported row
   * has to be coerced or every grade comparison quietly fails.
   */
  it('coerces a numeric grade to a string', () => {
    expect(normaliseClassroom<Classroom>('c1', { grade: 8 }).grade).toBe('8');
  });

  it('leaves a pre-primary grade as it is', () => {
    expect(normaliseClassroom<Classroom>('c1', { grade: 'Pre-primary 2' }).grade)
      .toBe('Pre-primary 2');
  });

  it('does not turn a missing grade into the string "undefined"', () => {
    expect(normaliseClassroom<Classroom>('c1', {}).grade).toBe('');
    expect(normaliseClassroom<Classroom>('c1', { grade: null }).grade).toBe('');
  });

  it('defaults classroomId to the document id', () => {
    expect(normaliseClassroom<Classroom>('c1', {}).classroomId).toBe('c1');
  });

  it('keeps a classroomId that disagrees with the path, rather than rewriting it', () => {
    // Rewriting would hide a real inconsistency in the data behind a value that
    // looks correct. Surfacing it is more useful than papering over it.
    expect(normaliseClassroom<Classroom>('c1', { classroomId: 'other' }).classroomId)
      .toBe('other');
  });

  /** Anything not the club sentinel is a classroom, so an unknown type is safe. */
  it('treats an unrecognised type as a classroom', () => {
    expect(normaliseClassroom<Classroom>('c1', { type: 'SOMETHING-ELSE' }).type)
      .toBe('CLASSROOM');
    expect(normaliseClassroom<Classroom>('c1', { type: 'STEM-CLUB' }).type)
      .toBe('STEM-CLUB');
  });
});

describe('stripTrashMetadata', () => {

  /**
   * A restore that carried trashAt back into the live collection would leave a
   * row that looks deleted but is not, and nothing in the UI would show it.
   */
  it('removes trashAt so a restored row is byte-identical to what was deleted', () => {
    const restored = stripTrashMetadata({
      docId: 'c1',
      classroomName: '8 B',
      trashAt: 'a timestamp'
    });

    expect('trashAt' in restored).toBe(false);
    expect(restored['classroomName']).toBe('8 B');
    expect(restored['docId']).toBe('c1');
  });

  it('does not mutate the object it was given', () => {
    const trashed = { docId: 'c1', trashAt: 'a timestamp' };

    stripTrashMetadata(trashed);

    expect('trashAt' in trashed).toBe(true);
  });
});

describe('toClassroomProgramme', () => {

  /**
   * PRODUCTION'S STRUCTURE, verbatim from Classrooms/{id}.programmes.{id}:
   * the four descriptive fields, `sequentiallyLocked`, and a `workflowIds` entry
   * per allotted learning unit.
   *
   * These assertions replaced two that pinned the OPPOSITE — "carries nothing
   * beyond those four fields" — written when this app had no locking flow. The
   * consequence of that decision was that a classroom stored no record of which
   * units it had been allotted, so nothing could answer what a class was working
   * on. Kept as a note rather than deleted, because the reversal is the point.
   */
  it('records the allotted learning units, in production\'s shape', () => {
    expect(toClassroomProgramme(programme({ learningUnitsIds: ['lu-1', 'lu-2'] }))).toEqual({
      programmeId: 'p1',
      programmeName: 'Science',
      programmeCode: 'SCI',
      displayName: 'Science',
      sequentiallyLocked: false,
      workflowIds: [
        {
          learningUnitId: 'lu-1', workflowId: '', openAt: '', closeAt: '',
          workflowLocked: false,
          // Empty because no catalogue was supplied — the id is what must survive.
          learningUnitCode: '', learningUnitName: '', learningUnitType: '',
          learningUnitVersion: '', learningUnitIsoCode: ''
        },
        {
          learningUnitId: 'lu-2', workflowId: '', openAt: '', closeAt: '',
          workflowLocked: false,
          learningUnitCode: '', learningUnitName: '', learningUnitType: '',
          learningUnitVersion: '', learningUnitIsoCode: ''
        }
      ]
    });
  });

  it('falls back to the programme name for a blank displayName', () => {
    expect(toClassroomProgramme(programme({ displayName: '  ' })).displayName).toBe('Science');
  });

  /** An empty array, never absent: the locking editor reads it unconditionally. */
  it('writes an empty workflowIds for a programme with no units', () => {
    expect(toClassroomProgramme(programme({ learningUnitsIds: [] })).workflowIds).toEqual([]);
    expect(toClassroomProgramme(programme({})).workflowIds).toEqual([]);
  });

  it('carries nothing beyond production\'s six keys', () => {
    const extra = programme({ grades: ['8'], institutionName: 'Oak School' });

    expect(Object.keys(toClassroomProgramme(extra)).sort()).toEqual([
      'displayName', 'programmeCode', 'programmeId', 'programmeName',
      'sequentiallyLocked', 'workflowIds'
    ]);
  });

  /**
   * NO WORKFLOW IS ORIGINATED. Skipped on instruction: `workflowId` is carried
   * through when a document already has one and is '' otherwise, which is
   * production's own default too — so nothing here creates a workflow document.
   */
  it('never invents a workflowId, but carries an existing one through', () => {
    const fresh = toClassroomProgramme(programme({ learningUnitsIds: ['lu-1'] }));
    expect(fresh.workflowIds?.[0].workflowId).toBe('');

    const carried = toClassroomProgramme(programme({ learningUnitsIds: ['lu-1'] }), {
      programmeId: 'p1',
      programmeName: 'Science',
      programmeCode: 'SCI',
      displayName: 'Science',
      workflowIds: [
        { learningUnitId: 'lu-1', workflowId: 'wf-9', openAt: '', closeAt: '', workflowLocked: true }
      ]
    });

    expect(carried.workflowIds?.[0].workflowId).toBe('wf-9');
    expect(carried.workflowIds?.[0].workflowLocked).toBe(true);
  });

  /**
   * THE SILENT FAILURE THIS PREVENTS. Rewriting the map without the existing
   * entry resets every date and lock on that class to empty, and nothing on
   * screen would say so.
   */
  it('preserves per-unit locking across a re-save', () => {
    const existing: ClassroomProgramme = {
      programmeId: 'p1',
      programmeName: 'Science',
      programmeCode: 'SCI',
      displayName: 'Science',
      sequentiallyLocked: true,
      workflowIds: [
        { learningUnitId: 'lu-1', workflowId: '', openAt: stamp('jan'), closeAt: stamp('feb'), workflowLocked: true }
      ]
    };

    const result = toClassroomProgramme(programme({ learningUnitsIds: ['lu-1'] }), existing);

    expect(result.sequentiallyLocked).toBe(true);
    expect(result.workflowIds?.[0].openAt).toEqual(stamp('jan'));
    expect(result.workflowIds?.[0].closeAt).toEqual(stamp('feb'));
  });

  /**
   * POSITIONAL, BUT THE ID IS CHECKED — production's rule. When the programme's
   * unit list changes, adopting a stored entry by index alone would move one
   * unit's dates onto whichever unit now sits at that index.
   */
  it('drops a stored entry whose unit no longer sits at that index', () => {
    const existing: ClassroomProgramme = {
      programmeId: 'p1',
      programmeName: 'Science',
      programmeCode: 'SCI',
      displayName: 'Science',
      workflowIds: [
        { learningUnitId: 'lu-1', workflowId: '', openAt: stamp('jan'), closeAt: '', workflowLocked: true }
      ]
    };

    // The programme now leads with a DIFFERENT unit, so index 0 must not inherit.
    const result = toClassroomProgramme(programme({ learningUnitsIds: ['lu-9', 'lu-1'] }), existing);

    expect(result.workflowIds?.[0]).toEqual({
      learningUnitId: 'lu-9', workflowId: '', openAt: '', closeAt: '', workflowLocked: false,
      learningUnitCode: '', learningUnitName: '', learningUnitType: '',
      learningUnitVersion: '', learningUnitIsoCode: ''
    });
  });
});

describe('toProgrammeMap', () => {

  /** Firestore stores this as a MAP keyed by id, matching production. */
  it('keys each programme by its id', () => {
    const map = toProgrammeMap([
      programme({ programmeId: 'p1' }),
      programme({ programmeId: 'p2', programmeName: 'Maths', displayName: 'Maths' })
    ]);

    expect(Object.keys(map).sort()).toEqual(['p1', 'p2']);
    expect(map['p2'].programmeName).toBe('Maths');
  });

  it('is an empty object for no programmes, never undefined', () => {
    expect(toProgrammeMap([])).toEqual({});
  });

  /** Each entry keeps its OWN locking, matched by programmeId not by position. */
  it('threads the existing map through per programme', () => {
    const map = toProgrammeMap(
      [
        programme({ programmeId: 'p1', learningUnitsIds: ['lu-1'] }),
        programme({ programmeId: 'p2', learningUnitsIds: ['lu-2'] })
      ],
      {
        p2: {
          programmeId: 'p2',
          programmeName: 'Maths',
          programmeCode: 'MAT',
          displayName: 'Maths',
          workflowIds: [
            { learningUnitId: 'lu-2', workflowId: '', openAt: stamp('mar'), closeAt: '', workflowLocked: false }
          ]
        }
      }
    );

    expect(map['p1'].workflowIds?.[0].openAt).toBe('');
    expect(map['p2'].workflowIds?.[0].openAt).toEqual(stamp('mar'));
  });
});

/* ==========================================================================
   The allotted units' DETAIL
   ========================================================================== */

/**
 * WHY THE DETAIL IS STORED AT ALL, since it is a departure from production.
 *
 * Production's `workflowIds` entries carry an id and locking fields, so reading a
 * classroom tells you it is allotted 'pb76Suhm2xIp3HZIY67g' and nothing about
 * what that is — every reader has to join against learningUnits to render a row.
 * The classroom already denormalises `programmeName` and `programmeCode` for the
 * same reason, and this is the same trade with the same mitigation: the detail is
 * RE-DERIVED on every write, so an edit refreshes a renamed unit.
 */
describe('the allotted units\' detail', () => {

  const CATALOGUE = indexLearningUnits([
    learningUnit({ docId: 'lu-1', learningUnitCode: 'AE05', learningUnitName: 'Balloon Rocket' }),
    learningUnit({
      docId: 'lu-2',
      learningUnitId: 'TA-BE15-TA-V22',
      learningUnitCode: 'BE15',
      learningUnitName: 'Siphon',
      isoCode: 'TA',
      version: 'V22'
    })
  ]);

  it('records what each unit is, not only its id', () => {
    const result = toClassroomProgramme(
      programme({ learningUnitsIds: ['lu-1', 'lu-2'] }),
      undefined,
      CATALOGUE
    );

    expect(result.workflowIds?.[0]).toMatchObject({
      learningUnitId: 'lu-1',
      learningUnitCode: 'AE05',
      learningUnitName: 'Balloon Rocket',
      learningUnitType: 'TACtivity',
      learningUnitVersion: 'V10',
      learningUnitIsoCode: 'EN'
    });

    expect(result.workflowIds?.[1]).toMatchObject({
      learningUnitCode: 'BE15',
      learningUnitIsoCode: 'TA',
      learningUnitVersion: 'V22'
    });
  });

  /** The display name is what a card renders, so it wins where it is set. */
  it('prefers the display name over the plain name', () => {
    const catalogue = indexLearningUnits([
      learningUnit({ docId: 'lu-1', learningUnitDisplayName: '  Rocket Balloon  ' })
    ]);

    const result = toClassroomProgramme(
      programme({ learningUnitsIds: ['lu-1'] }), undefined, catalogue
    );

    expect(result.workflowIds?.[0].learningUnitName).toBe('Rocket Balloon');
  });

  /**
   * THE ALLOTMENT SURVIVES A MISSING UNIT. A unit can be trashed while a
   * classroom still references it; dropping the entry would delete the allotment,
   * which is far worse than an entry that names an id and no title.
   */
  it('keeps the id and empties the detail for a unit not in the catalogue', () => {
    const result = toClassroomProgramme(
      programme({ learningUnitsIds: ['lu-gone'] }), undefined, CATALOGUE
    );

    expect(result.workflowIds?.[0]).toMatchObject({
      learningUnitId: 'lu-gone',
      learningUnitCode: '',
      learningUnitName: ''
    });
    expect(result.workflowIds?.length).toBe(1);
  });

  /**
   * LOCKING IS PRESERVED, DESCRIPTION IS RE-DERIVED — the split that makes the
   * denormalisation safe. Dates exist nowhere else, so losing them is
   * unrecoverable; a name is a copy, so a stale one should be refreshed.
   */
  it('refreshes a renamed unit while keeping its dates', () => {
    const existing: ClassroomProgramme = {
      programmeId: 'p1',
      programmeName: 'Science',
      programmeCode: 'SCI',
      displayName: 'Science',
      workflowIds: [
        {
          learningUnitId: 'lu-1',
          workflowId: 'wf-3',
          openAt: stamp('jan'),
          closeAt: '',
          workflowLocked: true,
          learningUnitCode: 'AE05',
          learningUnitName: 'The OLD name'
        }
      ]
    };

    const result = toClassroomProgramme(
      programme({ learningUnitsIds: ['lu-1'] }), existing, CATALOGUE
    );

    expect(result.workflowIds?.[0].learningUnitName).toBe('Balloon Rocket');
    expect(result.workflowIds?.[0].openAt).toEqual(stamp('jan'));
    expect(result.workflowIds?.[0].workflowId).toBe('wf-3');
    expect(result.workflowIds?.[0].workflowLocked).toBe(true);
  });

  /** A re-save with no catalogue must not blank detail that was already there. */
  it('keeps existing detail when no catalogue is supplied', () => {
    const existing: ClassroomProgramme = {
      programmeId: 'p1',
      programmeName: 'Science',
      programmeCode: 'SCI',
      displayName: 'Science',
      workflowIds: [
        {
          learningUnitId: 'lu-1',
          workflowId: '',
          openAt: '',
          closeAt: '',
          workflowLocked: false,
          learningUnitCode: 'AE05',
          learningUnitName: 'Balloon Rocket'
        }
      ]
    };

    const result = toClassroomProgramme(programme({ learningUnitsIds: ['lu-1'] }), existing);

    expect(result.workflowIds?.[0].learningUnitCode).toBe('AE05');
    expect(result.workflowIds?.[0].learningUnitName).toBe('Balloon Rocket');
  });
});

describe('indexLearningUnits', () => {

  /**
   * KEYED BOTH WAYS. This app stores docIds, but production reads its own
   * entries either way — `wfs['learningUnitId'].includes('-') ? … : …` — because
   * the composite form appears in some documents. A classroom imported from there
   * would otherwise resolve to no unit and be rewritten with empty detail.
   */
  it('finds a unit by docId and by composite learningUnitId', () => {
    const index = indexLearningUnits([learningUnit({ docId: 'lu-1' })]);

    expect(index.get('lu-1')?.learningUnitCode).toBe('AE05');
    expect(index.get('TA-AE05-EN-V10')?.learningUnitCode).toBe('AE05');
  });

  /** A docId must never be shadowed by another unit's composite id. */
  it('lets a docId win over a colliding composite id', () => {
    const index = indexLearningUnits([
      learningUnit({ docId: 'shared', learningUnitId: 'other', learningUnitCode: 'FIRST' }),
      learningUnit({ docId: 'second', learningUnitId: 'shared', learningUnitCode: 'SECOND' })
    ]);

    expect(index.get('shared')?.learningUnitCode).toBe('FIRST');
  });

  it('is empty for an empty catalogue', () => {
    expect(indexLearningUnits([]).size).toBe(0);
  });
});

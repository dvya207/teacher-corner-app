import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { convertToParamMap } from '@angular/router';

import {
  Classroom,
  ClassroomProgramme,
  LearningUnit,
  Programme
} from '../../models/teaching.model';
import { ClassroomService } from '../../services/classroom.service';
import { LearningUnitService } from '../../services/learning-unit.service';
import { ProgrammeService } from '../../services/programme.service';
import { ClassroomUnits } from './classroom-units';

/**
 * A classroom's learning units.
 *
 * WHAT THIS EXISTS TO PIN. Angular REUSES this component when only the route
 * parameters change, so reading the URL once in ngOnInit left the first
 * classroom's units on screen under the second classroom's address — data that
 * looks correct and is not. The first test below is that bug.
 *
 * The rest cover the join, which is the other thing that can silently mislead:
 * the unit list belongs to the PROGRAMME, the schedule dates belong to the
 * CLASSROOM's copy of that programme, and the order is the programme's.
 */

function programme(overrides: Partial<ClassroomProgramme> = {}): ClassroomProgramme {
  return {
    programmeId: 'p1',
    programmeName: 'Science Grade 6',
    displayName: 'Science Grade 6 Spark',
    programmeCode: 'P100',
    sequentiallyLocked: false,
    workflowIds: [],
    ...overrides
  } as unknown as ClassroomProgramme;
}

function classroom(docId: string, overrides: Partial<Classroom> = {}): Classroom {
  return {
    docId,
    name: 'Grade 6 A',
    grade: '6',
    section: 'A',
    institutionId: 'inst-1',
    studentCounter: 0,
    programmes: { p1: programme() },
    ...overrides
  } as unknown as Classroom;
}

function unit(docId: string, overrides: Partial<LearningUnit> = {}): LearningUnit {
  return {
    docId,
    learningUnitCode: docId.toUpperCase(),
    learningUnitName: `Unit ${docId}`,
    learningUnitDisplayName: '',
    isoCode: 'EN',
    totalTime: 45,
    status: 'LIVE',
    learningUnitPreviewImage: '',
    learningUnitImage: '',
    ...overrides
  } as unknown as LearningUnit;
}

describe('ClassroomUnits', () => {

  let fixture: ComponentFixture<ClassroomUnits>;
  let component: ClassroomUnits;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let query: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let classroomsById: Record<string, Classroom | null>;
  let programmesById: Record<string, Programme | null>;
  let catalogue: LearningUnit[];
  let classroomReads: string[];
  let unitReads: string[];

  class StubClassroomService {
    async get(docId: string): Promise<Classroom | null> {
      classroomReads.push(docId);

      return classroomsById[docId] ?? null;
    }

    describeError(_error: unknown, fallback: string): string {
      return fallback;
    }
  }

  class StubProgrammeService {
    async get(docId: string): Promise<Programme | null> {
      return programmesById[docId] ?? null;
    }
  }

  /** Reads by id, as the page now does — and records what it was asked for. */
  class StubLearningUnitService {
    async get(docId: string): Promise<LearningUnit | null> {
      unitReads.push(docId);

      return catalogue.find(unit => unit.docId === docId) ?? null;
    }
  }

  /**
   * Lets the component's own async work finish.
   *
   * `load()` is started from a subscription, not from ngOnInit, so it is a
   * floating promise that whenStable() does not track — two macrotask turns is
   * what the read-then-read chain needs.
   */
  async function settle(): Promise<void> {
    for (let turn = 0; turn < 3; turn++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    fixture.detectChanges();
  }

  async function mount(): Promise<void> {
    classroomReads = [];
    unitReads = [];
    params = new BehaviorSubject(convertToParamMap({ classroomId: 'c1' }));
    query = new BehaviorSubject(convertToParamMap({ programmeId: 'p1' }));

    await TestBed.configureTestingModule({
      imports: [ClassroomUnits],
      providers: [
        provideRouter([]),
        { provide: ClassroomService, useClass: StubClassroomService },
        { provide: ProgrammeService, useClass: StubProgrammeService },
        { provide: LearningUnitService, useClass: StubLearningUnitService },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: params, queryParamMap: query }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ClassroomUnits);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await settle();
  }

  beforeEach(() => {
    classroomsById = {
      c1: classroom('c1'),
      c2: classroom('c2', {
        name: 'Grade 7 A',
        programmes: { p2: programme({ programmeId: 'p2', displayName: 'Maths Grade 7' }) }
      } as Partial<Classroom>)
    };
    programmesById = {
      p1: { learningUnitsIds: ['b', 'a'] } as unknown as Programme,
      p2: { learningUnitsIds: ['c'] } as unknown as Programme
    };
    catalogue = [unit('a'), unit('b'), unit('c')];
  });

  /* ----------------------------------------------------------------------
     THE BUG: a reused component must still reload
     ---------------------------------------------------------------------- */

  it('loads the classroom named in the URL', async () => {
    await mount();

    expect(classroomReads).toEqual(['c1']);
    expect(component.units().map(row => row.docId)).toEqual(['b', 'a']);
  });

  /*
   * Navigating /classrooms/c1 -> /classrooms/c2 is the SAME route, so Angular
   * reuses the component and ngOnInit never fires again. Reading the snapshot
   * once left c1's units under c2's URL.
   */
  it('reloads when the classroom in the URL changes', async () => {
    await mount();

    params.next(convertToParamMap({ classroomId: 'c2' }));
    query.next(convertToParamMap({ programmeId: 'p2' }));
    await settle();

    // Two navigations arrive as two combineLatest emissions, so c2 is read
    // twice — harmless, and the assertion is about the LAST state.
    expect(classroomReads.at(-1)).toBe('c2');
    expect(component.classroom()?.docId).toBe('c2');
    expect(component.units().map(row => row.docId)).toEqual(['c']);
    expect(component.programmeTitle()).toBe('Maths Grade 7');
  });

  /* A programme switch within one classroom is a query-only navigation, and
     must still reload the units. */
  it('reloads when only the programme changes', async () => {
    await mount();

    query.next(convertToParamMap({ programmeId: 'p1' }));
    await settle();

    expect(classroomReads.length).toBeGreaterThan(1);
  });

  /* ----------------------------------------------------------------------
     The join
     ---------------------------------------------------------------------- */

  /* THE PROGRAMME'S ORDER, not the catalogue's: learningUnitsIds is positional
     against the classroom's per-unit locking. */
  it('lists the units in the order the programme stores them', async () => {
    await mount();

    expect(component.units().map(row => row.docId)).toEqual(['b', 'a']);
  });

  it('drops an id the catalogue no longer has', async () => {
    programmesById['p1'] = { learningUnitsIds: ['a', 'gone', 'b'] } as unknown as Programme;
    await mount();

    expect(component.units().map(row => row.docId)).toEqual(['a', 'b']);
  });

  /*
   * PRODUCTION'S OWN `filter(res => res?.trim())` AND `get(res.trim())`.
   *
   * An id stored with stray whitespace matched nothing when this looked units up
   * in a catalogue keyed by exact docId, so a unit silently vanished from the
   * class — indistinguishable from one that was never attached.
   */
  it('trims the stored ids before reading them', async () => {
    programmesById['p1'] = {
      learningUnitsIds: [' a ', 'b\n']
    } as unknown as Programme;
    await mount();

    expect(unitReads).toEqual(['a', 'b']);
    expect(component.units().map(row => row.docId)).toEqual(['a', 'b']);
  });

  it('skips a blank id rather than reading it', async () => {
    programmesById['p1'] = {
      learningUnitsIds: ['a', '', '   ', 'b']
    } as unknown as Programme;
    await mount();

    expect(unitReads).toEqual(['a', 'b']);
  });

  /* ONE READ PER ID, not a scan of the whole collection. */
  it('reads each unit by id, in the programme order', async () => {
    await mount();

    expect(unitReads).toEqual(['b', 'a']);
  });

  /*
   * NO STATUS FILTER on the way out. A unit already attached to a programme must
   * still render after someone moves it back to development — the class is
   * running it either way.
   */
  it('shows an attached unit that is no longer live', async () => {
    catalogue = [
      unit('a', { status: 'DEVELOPEMENT' as LearningUnit['status'] }),
      unit('b')
    ];
    await mount();

    expect(component.units().map(row => row.docId)).toEqual(['b', 'a']);
  });

  it('reports a classroom that no longer exists', async () => {
    classroomsById = {};
    await mount();

    expect(component.error()).toBe('That classroom no longer exists.');
    expect(component.units()).toEqual([]);
  });

  /* Falls back to the first attached programme, so a link that lost its query
     string still opens something. */
  it('falls back to the first programme when the URL names none', async () => {
    await mount();

    query.next(convertToParamMap({}));
    await settle();

    expect(component.programmeTitle()).toBe('Science Grade 6 Spark');
  });

  /* ----------------------------------------------------------------------
     Scheduling and filters
     ---------------------------------------------------------------------- */

  /* 'Not scheduled' is the usual state: the dates live on the CLASSROOM's copy
     of the programme, in workflowIds, and most units have neither. */
  it('leaves the schedule empty when the classroom has no dates', async () => {
    await mount();

    expect(component.units().every(row => row.scheduled === '')).toBe(true);
  });

  it('filters by search over code and name', async () => {
    await mount();

    component.search.set('unit a');
    expect(component.visibleUnits().map(row => row.docId)).toEqual(['a']);

    component.search.set('B');
    expect(component.visibleUnits().map(row => row.docId)).toEqual(['b']);
  });

  it('filters by language', async () => {
    catalogue = [unit('a', { isoCode: 'EN' }), unit('b', { isoCode: 'HI' })];
    await mount();

    component.language.set('HI');

    expect(component.visibleUnits().map(row => row.docId)).toEqual(['b']);
  });

  it('offers only the languages the listed units are in', async () => {
    catalogue = [unit('a', { isoCode: 'EN' }), unit('b', { isoCode: 'HI' })];
    await mount();

    expect(component.languageOptions()).toEqual(['EN', 'HI']);
  });

  it('reads the student count off the classroom', async () => {
    classroomsById['c1'] = classroom('c1', { studentCounter: 24 } as Partial<Classroom>);
    await mount();

    expect(component.studentCount()).toBe(24);
  });

  /* ----------------------------------------------------------------------
     The programme tabs
     ----------------------------------------------------------------------
     Production's page is a mat-tab-group with one tab per programme; the blue
     pill is the SELECTED tab. A classroom running two programmes must offer
     both, or the second is unreachable. */

  it('offers a tab per programme the classroom runs', async () => {
    classroomsById['c1'] = classroom('c1', {
      programmes: {
        p1: programme(),
        p2: programme({ programmeId: 'p2', displayName: 'Maths Grade 6' })
      }
    } as Partial<Classroom>);
    await mount();

    expect(component.programmeTabs()).toEqual([
      { programmeId: 'p1', label: 'Science Grade 6 Spark' },
      { programmeId: 'p2', label: 'Maths Grade 6' }
    ]);
  });

  it('marks only the programme in the URL as selected', async () => {
    classroomsById['c1'] = classroom('c1', {
      programmes: {
        p1: programme(),
        p2: programme({ programmeId: 'p2', displayName: 'Maths Grade 6' })
      }
    } as Partial<Classroom>);
    await mount();

    expect(component.isSelectedProgramme('p1')).toBe(true);
    expect(component.isSelectedProgramme('p2')).toBe(false);
  });

  /* displayName over programmeName, as production's tab label does. */
  it('labels a tab by displayName, falling back to the name', async () => {
    await mount();

    expect(component.programmeLabel(programme({ displayName: 'Shown' }))).toBe('Shown');
    expect(
      component.programmeLabel(programme({ displayName: '', programmeName: 'Fallback' }))
    ).toBe('Fallback');
    expect(component.programmeLabel(null)).toBe('');
  });

  it('offers no tabs when the classroom runs no programme', async () => {
    classroomsById['c1'] = classroom('c1', { programmes: {} } as Partial<Classroom>);
    await mount();

    expect(component.programmeTabs()).toEqual([]);
    expect(component.units()).toEqual([]);
  });
});

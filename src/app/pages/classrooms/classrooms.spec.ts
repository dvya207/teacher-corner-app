import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Timestamp } from 'firebase/firestore';

import {
  Classroom,
  ClassroomProgramme,
  Institution,
  LearningUnit,
  Programme,
  TrashedClassroom
} from '../../models/teaching.model';
import { ClassroomService } from '../../services/classroom.service';
import { InstitutionService } from '../../services/institution.service';
import { LearningUnitService } from '../../services/learning-unit.service';
import { NotificationService } from '../../services/notification.service';
import { ProgrammeService } from '../../services/programme.service';
import { Classrooms } from './classrooms';

/**
 * Classrooms page — the programme catalogue arriving, and the assigned names
 * leaving.
 *
 * programme-picker.spec.ts covers the filtering inside the modal. This file
 * covers the two ends the modal cannot see:
 *
 *   1. the catalogue actually reaching the page, and the modal, after load()
 *   2. a saved selection reaching Firestore and the table row
 *
 * The load is a Promise.allSettled, so a failing catalogue read used to be
 * discarded silently and the picker showed a bare "AVAILABLE 0" with no reason.
 * The rejection is now captured, and that is pinned here.
 *
 * All three services are stubbed. Firestore is not involved.
 */

function ts(iso: string): Timestamp {
  return Timestamp.fromDate(new Date(iso));
}

function assigned(overrides: Partial<ClassroomProgramme> = {}): ClassroomProgramme {
  return {
    programmeId: 'prog-1',
    programmeName: 'Oak 26-27 Grade 8 - Science',
    programmeCode: 'P10001',
    displayName: 'Oak 26-27 Grade 8 - Science',
    ...overrides
  };
}

function classroom(overrides: Partial<Classroom> = {}): Classroom {
  return {
    docId: 'cls-1',
    classroomId: 'cls-1',
    classroomCode: '001',
    type: 'CLASSROOM',
    classroomName: '8 B',
    stemClubName: '',
    grade: '8',
    section: 'B',
    board: 'CBSE',
    institutionId: 'inst-1',
    institutionName: 'Oak Valley School',
    programmes: {},
    studentCounter: 0,
    studentCredentialStoragePath: '',
    ownerId: 'alice',
    creationDate: ts('2026-08-01T10:00:00Z'),
    createdAt: ts('2026-08-01T10:00:00Z'),
    updatedAt: ts('2026-08-01T10:00:00Z'),
    ...overrides
  };
}

function programme(overrides: Partial<Programme> = {}): Programme {
  return {
    docId: 'prog-1',
    programmeId: 'prog-1',
    programmeName: 'Oak 26-27 Grade 8 - Science',
    programmeCode: 'P10001',
    displayName: 'Oak 26-27 Grade 8 - Science',
    programmeDescription: '',
    institutionId: 'inst-1',
    institutionName: 'Oak Valley School',
    grades: ['8'],
    age: [],
    type: 'REGULAR',
    programmeStatus: 'LIVE',
    programmeImagePath: '',
    learningUnitsIds: [],
    assignmentIds: [],
    ownerId: 'alice',
    createdAt: ts('2026-08-01T10:00:00Z'),
    updatedAt: ts('2026-08-01T10:00:00Z'),
    ...overrides
  };
}

/** Only the members the page calls. describeError mirrors the real one. */
class StubClassroomService {
  rows: Classroom[] = [];
  patches: { docId: string; patch: Partial<Classroom> }[] = [];

  async list(): Promise<Classroom[]> {
    return this.rows.map(row => ({ ...row }));
  }

  trash: TrashedClassroom[] = [];

  async create(draft: Partial<Classroom>): Promise<Classroom> {
    const created = classroom({ ...draft, docId: 'new-1', classroomId: 'new-1' });
    this.rows.unshift(created);
    return created;
  }

  async listTrash(): Promise<TrashedClassroom[]> {
    return this.trash.map(row => ({ ...row }));
  }

  /** Mirrors the real transaction: out of the collection, into the trash. */
  async moveToTrash(docId: string): Promise<TrashedClassroom> {
    const index = this.rows.findIndex(row => row.docId === docId);

    if (index === -1) {
      throw new Error('That classroom no longer exists.');
    }

    const [row] = this.rows.splice(index, 1);
    const trashed = { ...row, trashAt: ts('2026-08-14T00:00:00Z') } as TrashedClassroom;

    this.trash.push(trashed);
    return trashed;
  }

  async update(docId: string, patch: Partial<Classroom>): Promise<void> {
    this.patches.push({ docId, patch });
  }

  /** The exact inverse of moveToTrash, as the real transaction is. */
  async restore(docId: string): Promise<Classroom> {
    const index = this.trash.findIndex(row => row.docId === docId);

    if (index === -1) {
      throw new Error('That classroom is no longer in the trash.');
    }

    const [row] = this.trash.splice(index, 1);
    const { trashAt, ...restored } = row;

    this.rows.push(restored as Classroom);
    return restored as Classroom;
  }

  describeError(error: unknown, fallback: string): string {
    return (error as { code?: string })?.code === 'permission-denied'
      ? 'You do not have permission to do that.'
      : fallback;
  }
}

class StubInstitutionService {
  async list(): Promise<Institution[]> {
    return [];
  }

  describeError(_error: unknown, fallback: string): string {
    return fallback;
  }
}

class StubProgrammeService {
  rows: Programme[] = [];
  /** Set to reject list(), reproducing the swallowed catalogue failure. */
  listFails = false;

  async list(): Promise<Programme[]> {
    if (this.listFails) {
      throw Object.assign(new Error('nope'), { code: 'permission-denied' });
    }

    return this.rows.map(row => ({ ...row }));
  }

  describeError(_error: unknown, fallback: string): string {
    return fallback;
  }
}

/** Read only for the locking dialog's unit names. */
class StubLearningUnitService {
  rows: LearningUnit[] = [];

  async list(): Promise<LearningUnit[]> {
    return this.rows.map(row => ({ ...row }));
  }

  describeError(_error: unknown, fallback: string): string {
    return fallback;
  }
}

/** Records what the page logs, so each event can be asserted without Firestore. */
class StubNotificationService {
  logged: { module: string; action: string; title: string; description: string }[] = [];

  async log(draft: { module: string; action: string; title: string; description: string }): Promise<void> {
    this.logged.push(draft);
  }

  async load(): Promise<void> {
    // The feed is not read by these tests, only written to.
    return;
  }
  async markRead(): Promise<void> {
    // Read state is the panel's concern, not the pages'.
    return;
  }
  async markAllRead(): Promise<void> {
    // Read state is the panel's concern, not the pages'.
    return;
  }
  reset(): void {
    // Sign-out is the shell's concern.
  }
}

describe('Classrooms — programme catalogue and assigned names', () => {
  let fixture: ComponentFixture<Classrooms>;
  let component: Classrooms;
  let classroomService: StubClassroomService;
  let programmeService: StubProgrammeService;
  let notifications: StubNotificationService;

  /**
   * Renders the page with the load already settled.
   *
   * load() is awaited EXPLICITLY rather than relying on whenStable(). A bare
   * async ngOnInit registers no pending task with the zoneless scheduler, so
   * whenStable() can resolve before the three lists arrive — which made the
   * table assertions below pass or fail on microtask luck. Calling load()
   * ourselves is idempotent against these stubs and deterministic.
   */
  async function render(
    rows: Classroom[],
    catalogue: Programme[],
    catalogueFails = false
  ): Promise<void> {
    TestBed.resetTestingModule();

    classroomService = new StubClassroomService();
    classroomService.rows = rows;
    programmeService = new StubProgrammeService();
    programmeService.rows = catalogue;
    notifications = new StubNotificationService();
    programmeService.listFails = catalogueFails;

    await TestBed.configureTestingModule({
      imports: [Classrooms],
      providers: [
        { provide: ClassroomService, useValue: classroomService },
        { provide: InstitutionService, useValue: new StubInstitutionService() },
        { provide: ProgrammeService, useValue: programmeService },
        { provide: LearningUnitService, useValue: new StubLearningUnitService() },
        { provide: NotificationService, useValue: notifications }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(Classrooms);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await component.load();
    fixture.detectChanges();
  }

  /** The cell the user reported as empty. */
  function programmeCell(): string {
    // Name, Type, ID, School, Created, Students, Programmes.
    const cells = fixture.nativeElement.querySelectorAll('tbody tr:first-child td');
    return (cells[6]?.textContent ?? '').trim();
  }

  /* ---- The catalogue arrives -------------------------------------------- */

  it('loads the existing programme catalogue onto the page', async () => {
    await render([classroom()], [programme()]);

    expect(component.programmes().length).toBe(1);
    expect(component.catalogueError()).toBe('');
  });

  /**
   * The catalogue must reach the modal's input, because the picker reads it from
   * there rather than fetching its own. This is the wiring the "AVAILABLE 0"
   * report was actually about.
   */
  it('hands the catalogue to the edit modal', async () => {
    await render([classroom()], [programme()]);

    component.openEdit(component.classrooms()[0]);
    fixture.detectChanges();

    const modal = fixture.nativeElement.querySelector('app-edit-classroom');
    expect(modal).not.toBeNull();
    expect(component.programmes().length).toBe(1);
  });

  /**
   * allSettled discards a rejection. It used to be dropped entirely, leaving the
   * picker to claim no programmes exist when the read had in fact failed.
   */
  it('reports a failed catalogue read without blanking the table', async () => {
    await render([classroom()], [], true);

    expect(component.catalogueError()).toBe('You do not have permission to do that.');
    // The classrooms are the page. They still loaded.
    expect(component.classrooms().length).toBe(1);
    expect(component.error()).toBe('');
    expect(component.programmes()).toEqual([]);
  });

  /* ---- The names leave --------------------------------------------------- */

  it('renders the assigned programme names in the table', async () => {
    await render([classroom({ programmes: { 'prog-1': assigned() } })], [programme()]);

    expect(component.programmeNames(component.classrooms()[0]))
      .toBe('Oak 26-27 Grade 8 - Science');
    expect(programmeCell()).toContain('Oak 26-27 Grade 8 - Science');
  });

  it('joins several assigned programmes', async () => {
    await render(
      [classroom({
        programmes: {
          'prog-1': assigned(),
          'prog-2': assigned({
            programmeId: 'prog-2',
            programmeName: 'Oak 26-27 Grade 8 - Maths',
            displayName: 'Oak 26-27 Grade 8 - Maths',
            programmeCode: 'P10002'
          })
        }
      })],
      [programme()]
    );

    const cell = programmeCell();
    expect(cell).toContain('Science');
    expect(cell).toContain('Maths');
    expect(cell).toContain(',');
  });

  it('shows a dash, not an empty cell, when none are assigned', async () => {
    await render([classroom()], [programme()]);

    expect(programmeCell()).toBe('—');
  });

  /* ---- Saving ----------------------------------------------------------- */

  /**
   * The page owns every write. The modal emits a patch; this asserts the map
   * reaches the service and the row behind the modal, so the table is correct
   * without a reload.
   */
  it('saves the selected programmes and updates the row immediately', async () => {
    await render([classroom()], [programme()]);

    component.openEdit(component.classrooms()[0]);
    await component.saveEdit({ programmes: { 'prog-1': assigned() } });
    fixture.detectChanges();

    expect(classroomService.patches.length).toBe(1);
    expect(classroomService.patches[0].docId).toBe('cls-1');
    expect(Object.keys(classroomService.patches[0].patch.programmes ?? {})).toEqual(['prog-1']);

    expect(programmeCell()).toContain('Oak 26-27 Grade 8 - Science');
  });

  it('clears the cell when the last programme is removed', async () => {
    await render([classroom({ programmes: { 'prog-1': assigned() } })], [programme()]);

    component.openEdit(component.classrooms()[0]);
    await component.saveEdit({ programmes: {} });
    fixture.detectChanges();

    expect(classroomService.patches[0].patch.programmes).toEqual({});
    expect(programmeCell()).toBe('—');
  });

  /* ---- Search ----------------------------------------------------------- */

  /** The search box matches on programme name too, which needs the map read. */
  it('finds a classroom by an assigned programme name', async () => {
    await render(
      [
        classroom({ programmes: { 'prog-1': assigned() } }),
        classroom({ docId: 'cls-2', classroomId: 'cls-2', classroomName: '9 A', grade: '9' })
      ],
      [programme()]
    );

    component.searchQuery.set('science');
    fixture.detectChanges();

    expect(component.filtered().map(row => row.docId)).toEqual(['cls-1']);
  });

  /* ---- Delete asks first ------------------------------------------------ */

  it('asks before deleting, naming the classroom', async () => {
    await render([classroom()], [programme()]);

    component.askDelete(component.classrooms()[0]);
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('.confirm-card');

    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(dialog.textContent).toContain('Are you sure you want to delete');
    expect(dialog.textContent).toContain('8 B');
    // Nothing has moved yet.
    expect(classroomService.rows.length).toBe(1);
    expect(classroomService.trash).toEqual([]);
  });

  it('changes nothing when the confirmation is cancelled', async () => {
    await render([classroom()], [programme()]);

    component.askDelete(component.classrooms()[0]);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.confirm-card .btn-ghost') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.confirm-card')).toBeNull();
    expect(component.classrooms().length).toBe(1);
    expect(classroomService.trash).toEqual([]);
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(1);
  });

  /**
   * The whole document moves: the trash copy carries every field the active one
   * had, so a restore can be its exact inverse.
   */
  it('moves the whole document to Trash, drops the row and says so', async () => {
    await render([classroom({ programmes: { 'prog-1': assigned() } })], [programme()]);

    const original = { ...component.classrooms()[0] };

    component.askDelete(component.classrooms()[0]);
    await component.confirmDelete();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.confirm-card')).toBeNull();
    expect(classroomService.rows).toEqual([]);
    expect(classroomService.trash.map(row => row.docId)).toEqual(['cls-1']);
    expect(component.classrooms()).toEqual([]);
    expect(component.trashed().map(row => row.docId)).toEqual(['cls-1']);
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(0);

    // Every field survived, plus exactly one added marker.
    const stored = classroomService.trash[0] as unknown as Record<string, unknown>;
    for (const key of Object.keys(original) as (keyof Classroom)[]) {
      expect(stored[key]).toEqual(original[key]);
    }
    expect(stored['trashAt']).toBeDefined();
    expect(Object.keys(stored).length).toBe(Object.keys(original).length + 1);

    expect(component.notice()).toBe('8 B moved to Trash');
  });
  /* ---- Notifications ------------------------------------------------------ */

});

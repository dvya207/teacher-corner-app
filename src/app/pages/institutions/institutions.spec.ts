import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Timestamp } from 'firebase/firestore';

import { Institution, InstitutionDraft, TrashedInstitution } from '../../models/teaching.model';
import { InstitutionService } from '../../services/institution.service';
import { NotificationService } from '../../services/notification.service';
import { Institutions } from './institutions';

/**
 * Institutions — list, filters and Trash.
 *
 * InstitutionService is stubbed, so these run without Firebase. That matters
 * beyond speed: the real service currently fails with permission-denied because
 * this app's Firestore rules are not deployed yet, so a test that hit it would
 * be asserting against an error rather than against the component.
 */

function ts(iso: string): Timestamp {
  return Timestamp.fromDate(new Date(iso));
}

function institution(overrides: Partial<Institution> = {}): Institution {
  return {
    docId: 'inst-1',
    ownerId: 'alice',
    institutionName: 'Oak Valley School',
    board: 'CBSE',
    classroomCounter: 0,
    genderType: 'Co-ed',
    institutionAddress: {
      city: 'Bengaluru',
      country: 'India',
      district: '',
      landmark: '',
      pincode: '560001',
      state: '',
      street: '',
      subDistrict: '',
      village: ''
    },
    institutionCode: '',
    medium: 'EN',
    registrationNumber: 'UDISE-1',
    representativeCountryCode: '+91',
    representativePhoneNumber: '9000000000',
    representativeEmail: 'asha@example.com',
    representativeFirstName: 'Asha',
    representativeLastName: 'Rao',
    representativeName: 'Asha Rao',
    teachersRegistered: 0,
    typeofSchool: 'Private School',
    customerSchool: false,
    createdAt: ts('2026-08-01T10:00:00.000Z'),
    creationDate: ts('2026-08-01T10:00:00.000Z'),
    updatedAt: ts('2026-08-01T10:00:00.000Z'),
    active: true,
    verified: false,
    ...overrides
  };
}

class StubInstitutionService {
  /** Two subcollections, exactly like Firestore: schema and trash. */
  live: Institution[] = [];
  trash: TrashedInstitution[] = [];
  purged: string[] = [];
  patches: Partial<Institution>[] = [];

  async list(): Promise<Institution[]> {
    return this.live.map(row => ({ ...row }));
  }

  async listTrash(): Promise<TrashedInstitution[]> {
    return this.trash.map(row => ({ ...row }));
  }

  async create(draft: InstitutionDraft): Promise<Institution> {
    return institution({ ...draft, docId: 'new-1' } as Partial<Institution>);
  }

  /** Set to make the next update() reject, for the failure-path tests. */
  updateFails = false;

  async update(_docId: string, patch: Partial<Institution>): Promise<void> {
    if (this.updateFails) {
      throw Object.assign(new Error('nope'), { code: 'permission-denied' });
    }

    this.patches.push(patch);
  }

  /** Every setVerified call, so a test can assert what reached Firestore. */
  verifiedWrites: { docId: string; verified: boolean }[] = [];
  setVerifiedFails = false;

  async setVerified(docId: string, verified: boolean): Promise<void> {
    if (this.setVerifiedFails) {
      throw Object.assign(new Error('nope'), { code: 'permission-denied' });
    }

    this.verifiedWrites.push({ docId, verified });
  }

  /** Kept separate from verification. Recorded so a test can prove it is NOT called. */
  activeWrites: { docId: string; active: boolean }[] = [];

  async setActive(docId: string, active: boolean): Promise<void> {
    this.activeWrites.push({ docId, active });
  }

  /** Set to make the next moveToTrash reject, for the failure-path test. */
  moveFails = false;

  /** Mirrors the real transaction: remove from live, add to trash. */
  async moveToTrash(docId: string): Promise<TrashedInstitution> {
    if (this.moveFails) {
      throw Object.assign(new Error('nope'), { code: 'permission-denied' });
    }

    const index = this.live.findIndex(row => row.docId === docId);

    if (index === -1) {
      throw new Error('That institution no longer exists.');
    }

    const [row] = this.live.splice(index, 1);
    const trashed = {
      ...row,
      trashAt: ts('2026-08-14T00:00:00.000Z')
    } as TrashedInstitution;

    this.trash.push(trashed);
    return trashed;
  }

  /** The exact mirror: remove from trash, add back to live, metadata stripped. */
  async restore(docId: string): Promise<Institution> {
    const index = this.trash.findIndex(row => row.docId === docId);

    if (index === -1) {
      throw new Error('That institution is no longer in the trash.');
    }

    const [row] = this.trash.splice(index, 1);
    const { trashAt, ...restored } = row;

    this.live.push(restored as Institution);
    return restored as Institution;
  }

  async purge(docId: string): Promise<void> {
    this.purged.push(docId);
    this.trash = this.trash.filter(row => row.docId !== docId);
  }

  async purgeAll(docIds: string[]): Promise<void> {
    for (const docId of docIds) {
      await this.purge(docId);
    }
  }

  describeError(_error: unknown, fallback: string): string {
    return fallback;
  }
}

function trashed(overrides: Partial<TrashedInstitution> = {}): TrashedInstitution {
  return {
    ...institution(),
    trashAt: ts('2026-08-10T00:00:00.000Z'),
    ...overrides
  };
}

/**
 * The notification feed, stubbed.
 *
 * Records what the page logs so each event can be asserted by module and action,
 * without a Firestore write. The real service swallows its own failures, so a
 * test against it would pass whether or not the call was made.
 */
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

describe('Institutions', () => {
  let fixture: ComponentFixture<Institutions>;
  let component: Institutions;
  let service: StubInstitutionService;
  let notifications: StubNotificationService;

  async function setup(
    rows: Institution[],
    trashRows: TrashedInstitution[] = []
  ): Promise<void> {
    service = new StubInstitutionService();
    service.live = rows;
    service.trash = trashRows;

    notifications = new StubNotificationService();

    await TestBed.configureTestingModule({
      imports: [Institutions],
      providers: [
        { provide: InstitutionService, useValue: service },
        { provide: NotificationService, useValue: notifications }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(Institutions);
    component = fixture.componentInstance;

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const text = () => fixture.nativeElement.textContent as string;

  it('shows schema rows and never shows trashed ones', async () => {
    await setup(
      [institution({ docId: 'a', institutionName: 'Live School' })],
      [trashed({ docId: 'b', institutionName: 'Binned School' })]
    );

    expect(component.live().map(r => r.docId)).toEqual(['a']);
    expect(text()).toContain('Live School');
    // The trashed row is in a different collection, so it cannot leak into the
    // table even if a filter were forgotten.
    expect(text()).not.toContain('Binned School');
  });

  it('excludes trashed rows from the stat cards', async () => {
    await setup(
      [
        institution({ docId: 'a', typeofSchool: 'Private School' }),
        institution({ docId: 'b', typeofSchool: 'Government School' })
      ],
      [trashed({ docId: 'c', typeofSchool: 'Government School' })]
    );

    expect(component.totalCount()).toBe(2);
    expect(component.governmentCount()).toBe(1);
    expect(component.privateCount()).toBe(1);
  });

  it('loads the Trash from its own collection when opened', async () => {
    await setup([], [trashed({ docId: 'b', institutionName: 'Binned School' })]);

    expect(component.trashed()).toEqual([]);   // not loaded until opened

    await component.openTrash();
    fixture.detectChanges();

    expect(component.trashed().map(r => r.docId)).toEqual(['b']);
    expect(fixture.nativeElement.querySelector('.trash-overlay').textContent)
      .toContain('Binned School');
  });

  it('renders the trashed row with its details and deleted date', async () => {
    await setup([], [trashed({
      docId: 'b',
      institutionName: 'Binned School',
      registrationNumber: 'REG-99',
      representativeName: 'Dev Kumar',
      trashAt: ts('2026-08-10T00:00:00.000Z')
    })]);

    await component.openTrash();
    fixture.detectChanges();

    const overlay = fixture.nativeElement.querySelector('.trash-overlay');
    expect(overlay.textContent).toContain('Binned School');
    expect(overlay.textContent).toContain('REG-99');
    expect(overlay.textContent).toContain('Dev Kumar');
    expect(overlay.textContent).toContain('10/08/2026');
  });

  /** The trash icon asks first, so every delete here goes through the dialog. */
  async function deleteFirstRow(): Promise<void> {
    component.askDelete(component.live()[0]);
    fixture.detectChanges();
    await component.confirmDelete();
  }

  it('DELETE moves the row from schema to trash rather than flagging it', async () => {
    await setup([institution({ docId: 'a', institutionName: 'Doomed School' })]);

    await deleteFirstRow();
    fixture.detectChanges();

    // Gone from live, present in trash, and nothing was permanently deleted.
    expect(service.live).toEqual([]);
    expect(service.trash.map(r => r.docId)).toEqual(['a']);
    expect(service.purged).toEqual([]);
    expect(component.live()).toEqual([]);
    expect(component.trashed().map(r => r.docId)).toEqual(['a']);
  });

  it('DELETE preserves the complete document, not a summary of it', async () => {
    const original = institution({ docId: 'a', institutionCode: '1000789' });
    await setup([original]);

    await deleteFirstRow();

    const stored = service.trash[0];
    for (const key of Object.keys(original) as (keyof typeof original)[]) {
      expect(stored[key]).toEqual(original[key]);
    }
    // Exactly one field is added, matching production.
    expect(stored.trashAt).toBeDefined();
    expect(Object.keys(stored).length).toBe(Object.keys(original).length + 1);
  });

  /* ---- The confirmation ------------------------------------------------- */

  it('asks before deleting, naming the institution', async () => {
    await setup([institution({ docId: 'a', institutionName: 'Doomed School' })]);

    component.askDelete(component.live()[0]);
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('.confirm-card');

    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(dialog.textContent).toContain('Are you sure you want to delete');
    expect(dialog.textContent).toContain('Doomed School');
    // Just the question and the two buttons: the explanatory paragraphs were
    // removed on instruction, so nothing here restates what the Trash is.
    expect(dialog.querySelectorAll('p').length).toBe(0);
    // Nothing has happened yet.
    expect(service.live.length).toBe(1);
    expect(service.trash).toEqual([]);
  });

  it('changes nothing when the confirmation is cancelled', async () => {
    await setup([institution({ docId: 'a', institutionName: 'Spared School' })]);

    component.askDelete(component.live()[0]);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.confirm-card .btn-ghost') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.confirm-card')).toBeNull();
    expect(service.live.map(r => r.docId)).toEqual(['a']);
    expect(service.trash).toEqual([]);
    expect(component.live().length).toBe(1);
  });

  it('deletes, closes and says so when the confirmation is accepted', async () => {
    await setup([institution({ docId: 'a', institutionName: 'Doomed School' })]);

    component.askDelete(component.live()[0]);
    fixture.detectChanges();
    await component.confirmDelete();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.confirm-card')).toBeNull();
    expect(service.trash.map(r => r.docId)).toEqual(['a']);
    expect(component.notice()).toBe('Doomed School moved to Trash');
    expect(fixture.nativeElement.querySelector('.toast')!.textContent)
      .toContain('moved to Trash');
  });

  /** A failed move must not look like a successful one. */
  it('closes the dialog and reports the failure without moving anything', async () => {
    await setup([institution({ docId: 'a' })]);
    service.moveFails = true;

    component.askDelete(component.live()[0]);
    await component.confirmDelete();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.confirm-card')).toBeNull();
    expect(component.error()).not.toBe('');
    expect(component.notice()).toBe('');
    expect(component.live().length).toBe(1);
    expect(service.trash).toEqual([]);
  });

  it('RESTORE moves it back and strips the trash metadata', async () => {
    await setup([], [trashed({ docId: 'b', institutionName: 'Back Again' })]);
    await component.openTrash();

    await component.restore(component.trashed()[0]);
    fixture.detectChanges();

    expect(service.trash).toEqual([]);
    expect(service.live.map(r => r.docId)).toEqual(['b']);
    expect(component.trashed()).toEqual([]);
    expect(component.live().map(r => r.docId)).toEqual(['b']);

    const back = service.live[0] as unknown as Record<string, unknown>;
    expect(back['trashAt']).toBeUndefined();
    expect(back['institutionName']).toBe('Back Again');
  });

  it('a row is never in both schema and trash at once', async () => {
    await setup([institution({ docId: 'a' })]);

    await deleteFirstRow();
    expect(service.live.length + service.trash.length).toBe(1);

    await component.restore(component.trashed()[0]);
    expect(service.live.length + service.trash.length).toBe(1);
  });

  it('permanent delete only removes from trash, never from schema', async () => {
    await setup([institution({ docId: 'a' })], [trashed({ docId: 'b' })]);
    await component.openTrash();

    await component.purge(component.trashed()[0]);

    expect(service.purged).toEqual(['b']);
    expect(service.trash).toEqual([]);
    expect(service.live.map(r => r.docId)).toEqual(['a']);
  });

  it('requires two clicks to empty the Trash', async () => {
    await setup([], [trashed({ docId: 'b' })]);
    await component.openTrash();

    await component.emptyTrash();
    expect(component.confirmingEmpty()).toBe(true);
    expect(service.purged).toEqual([]);

    await component.emptyTrash();
    expect(service.purged).toEqual(['b']);
    expect(component.trashed()).toEqual([]);
    expect(component.confirmingEmpty()).toBe(false);
  });

  it('disarms the confirm when the Trash is closed', async () => {
    await setup([], [trashed({ docId: 'b' })]);
    await component.openTrash();

    await component.emptyTrash();
    expect(component.confirmingEmpty()).toBe(true);

    component.closeTrash();
    expect(component.confirmingEmpty()).toBe(false);
    expect(service.purged).toEqual([]);
  });

  it('saves only the fields of the tab that was submitted', async () => {
    await setup([institution({ docId: 'a', institutionName: 'Before' })]);

    component.openEdit(component.live()[0]);
    await component.saveEdit({
      institutionAddress: { ...component.live()[0].institutionAddress, city: 'Mysuru' }
    });

    expect(Object.keys(service.patches[0])).toEqual(['institutionAddress']);
    expect(component.live()[0].institutionAddress.city).toBe('Mysuru');
    expect(component.live()[0].institutionName).toBe('Before');
  });

  /**
   * A successful save closes the modal and says so.
   *
   * This replaces an earlier test asserting the modal stayed open for editing
   * another tab. Confirming the save and clearing the form is what was asked for,
   * and a save that left the modal sitting there read as having done nothing.
   */
  it('closes the edit modal after a successful save and confirms it', async () => {
    await setup([institution({ docId: 'a' })]);

    component.openEdit(component.live()[0]);
    await component.saveEdit({
      institutionAddress: { ...component.live()[0].institutionAddress, city: 'Mysuru' }
    });

    expect(component.editing()).toBeNull();
    expect(component.notice()).toBe('Updated successfully');
    expect(component.editError()).toBe('');
    // The row behind the modal carries the change, so the revealed table is right.
    expect(component.live()[0].institutionAddress.city).toBe('Mysuru');
  });

  it('lets the confirmation be dismissed', async () => {
    await setup([institution({ docId: 'a' })]);

    component.openEdit(component.live()[0]);
    await component.saveEdit({ institutionName: 'Renamed' });
    expect(component.notice()).toBe('Updated successfully');

    component.dismissNotice();

    expect(component.notice()).toBe('');
  });

  /**
   * The failure path is the reason this work happened: the message used to be set
   * on the page BEHIND the overlay, so a failed save looked like a dead button.
   */
  it('keeps the modal open and reports the failure inside it when a save fails', async () => {
    await setup([institution({ docId: 'a', institutionName: 'Before' })]);
    service.updateFails = true;

    component.openEdit(component.live()[0]);
    await component.saveEdit({ institutionName: 'Renamed' });

    expect(component.editing()).not.toBeNull();
    expect(component.editError()).not.toBe('');
    // No false confirmation, and the table is untouched.
    expect(component.notice()).toBe('');
    expect(component.live()[0].institutionName).toBe('Before');
  });

  it('clears a previous failure when the modal is closed', async () => {
    await setup([institution({ docId: 'a' })]);
    service.updateFails = true;

    component.openEdit(component.live()[0]);
    await component.saveEdit({ institutionName: 'Renamed' });
    expect(component.editError()).not.toBe('');

    component.closeEdit();

    expect(component.editError()).toBe('');
  });

  /**
   * The table's toggle is the VERIFICATION toggle, not the active one.
   *
   * These pin the whole contract: which field is written, which is not, what the
   * user is told, and how the filters follow. None of it was covered before — the
   * toggle had no test at all, which is why repointing it broke nothing visible.
   */
  describe('the verification toggle', () => {

    it('turns verification ON, writing only `verified`', async () => {
      await setup([institution({ docId: 'a', verified: false, active: true })]);

      await component.toggleVerified(component.live()[0]);

      expect(service.verifiedWrites).toEqual([{ docId: 'a', verified: true }]);
      expect(component.live()[0].verified).toBe(true);
      expect(component.notice()).toBe('Verification status updated successfully');
    });

    it('turns verification OFF again', async () => {
      await setup([institution({ docId: 'a', verified: true })]);

      await component.toggleVerified(component.live()[0]);

      expect(service.verifiedWrites).toEqual([{ docId: 'a', verified: false }]);
      expect(component.live()[0].verified).toBe(false);
      expect(component.notice()).toBe('Moved back to Unverified');
    });

    /** `active` is a different concern and must not move with the toggle. */
    it('never touches `active`', async () => {
      await setup([institution({ docId: 'a', verified: false, active: true })]);

      await component.toggleVerified(component.live()[0]);

      expect(service.activeWrites).toEqual([]);
      expect(component.live()[0].active).toBe(true);
    });

    it('leaves every other field on the row alone', async () => {
      const original = institution({ docId: 'a', verified: false });
      await setup([original]);

      await component.toggleVerified(component.live()[0]);

      const row = component.live()[0] as unknown as Record<string, unknown>;
      for (const key of Object.keys(original)) {
        if (key !== 'verified') {
          expect(row[key]).toEqual((original as unknown as Record<string, unknown>)[key]);
        }
      }
    });

    it('reports a failure and leaves the row unchanged', async () => {
      await setup([institution({ docId: 'a', verified: false })]);
      service.setVerifiedFails = true;

      await component.toggleVerified(component.live()[0]);

      expect(component.live()[0].verified).toBe(false);
      expect(component.error()).not.toBe('');
      expect(component.notice()).toBe('');
    });
  });

  describe('the Verified and Unverified filters', () => {

    /** Driven by `verified`, never by `active`. */
    it('splits the list on `verified`', async () => {
      await setup([
        institution({ docId: 'yes', institutionName: 'Verified One', verified: true }),
        institution({ docId: 'no', institutionName: 'Unverified One', verified: false })
      ]);

      component.setFilter('Verified');
      expect(component.filtered().map((r: Institution) => r.docId)).toEqual(['yes']);

      component.setFilter('Unverified');
      expect(component.filtered().map((r: Institution) => r.docId)).toEqual(['no']);
    });

    /** An inactive but verified row still counts as Verified. */
    it('ignores `active` when filtering', async () => {
      await setup([institution({ docId: 'a', verified: true, active: false })]);

      component.setFilter('Verified');

      expect(component.filtered().map((r: Institution) => r.docId)).toEqual(['a']);
    });

    it('follows the toggle immediately', async () => {
      await setup([institution({ docId: 'a', verified: false })]);
      component.setFilter('Verified');
      expect(component.filtered()).toEqual([]);

      await component.toggleVerified(component.live()[0]);

      expect(component.filtered().map((r: Institution) => r.docId)).toEqual(['a']);
    });
  });

  it('filters by type and by search', async () => {
    await setup([
      institution({ docId: 'a', institutionName: 'Alpha Public', typeofSchool: 'Private School' }),
      institution({ docId: 'b', institutionName: 'Beta Govt High', typeofSchool: 'Government School' })
    ]);

    component.setFilter('Government');
    expect(component.filtered().map(r => r.docId)).toEqual(['b']);

    component.setFilter('All');
    component.searchQuery.set('alpha');
    expect(component.filtered().map(r => r.docId)).toEqual(['a']);
  });
  /* ---- Notifications ------------------------------------------------------ */

});

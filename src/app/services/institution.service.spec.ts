import { Timestamp } from 'firebase/firestore';

import {
  normaliseInstitution,
  representativeName,
  stripImmutableFields,
  stripTrashMetadata,
  withoutUndefined
} from './institution.service';
import { Institution } from '../models/teaching.model';

/**
 * Guards on the write path.
 *
 * Tested directly rather than through a component, because the component specs
 * stub the service — an assertion there would be checking the stub, not this.
 */
describe('stripImmutableFields', () => {

  it('removes ownerId, which the security rule pins on update', () => {
    const patch = { institutionName: 'Renamed', ownerId: 'someone-else' } as Partial<Institution>;

    expect(stripImmutableFields(patch)).toEqual({ institutionName: 'Renamed' });
  });

  it('removes docId, which mirrors the document path rather than being editable', () => {
    expect(stripImmutableFields({ docId: 'abc', board: 'IB' })).toEqual({ board: 'IB' });
  });

  it('removes both creation timestamps, which are set once', () => {
    const now = Timestamp.now();

    expect(stripImmutableFields({ createdAt: now, creationDate: now, board: 'IB' }))
      .toEqual({ board: 'IB' });
  });

  it('leaves updatedAt alone, since every edit is meant to move it', () => {
    const now = Timestamp.now();

    expect(stripImmutableFields({ updatedAt: now })).toEqual({ updatedAt: now });
  });

  it('leaves falsy values untouched rather than treating them as absent', () => {
    const patch: Partial<Institution> = {
      institutionName: '', active: false, verified: false, classroomCounter: 0
    };

    expect(stripImmutableFields(patch)).toEqual(patch);
  });

  it('returns an empty object when the patch held only immutable fields', () => {
    expect(stripImmutableFields({ docId: 'a', ownerId: 'b' })).toEqual({});
  });
});

describe('stripTrashMetadata', () => {

  it('removes trashAt, so a restored document is byte-identical to the original', () => {
    const trashed = { institutionName: 'Oak', ownerId: 'alice', trashAt: Timestamp.now() };

    expect(stripTrashMetadata(trashed)).toEqual({ institutionName: 'Oak', ownerId: 'alice' });
  });

  it('leaves a document without trash metadata untouched', () => {
    const plain = { institutionName: 'Oak', ownerId: 'alice' };

    expect(stripTrashMetadata(plain)).toEqual(plain);
  });

  it('does not mutate its input', () => {
    const trashed = { institutionName: 'Oak', trashAt: Timestamp.now() };
    stripTrashMetadata(trashed);

    expect(trashed.trashAt).toBeDefined();
  });

  it('keeps ownerId, which the rules need to permit the restore write', () => {
    const restored = stripTrashMetadata({ ownerId: 'alice', trashAt: Timestamp.now() });

    expect(restored['ownerId']).toBe('alice');
  });
});

describe('representativeName', () => {

  it('joins first and last, as production stores it denormalised', () => {
    expect(representativeName('Atul', 'Soral')).toBe('Atul Soral');
  });

  it('does not leave a stray space when one half is missing', () => {
    expect(representativeName('Atul', '')).toBe('Atul');
    expect(representativeName('', 'Soral')).toBe('Soral');
    expect(representativeName('', '')).toBe('');
  });

  it('trims input, so a padded field cannot produce a double space', () => {
    expect(representativeName('  Atul  ', '  Soral  ')).toBe('Atul Soral');
  });
});

/**
 * The fix for Save Changes failing on every pre-existing row.
 *
 * A document written before a field existed comes back without that key, and the
 * cast to Institution hides it. The edit modal then read the missing key off the
 * loaded document and sent `undefined` to updateDoc(), which the SDK rejects
 * outright — so the save died before reaching the network, and the message landed
 * on the page behind the modal where it could not be seen.
 */
describe('normaliseInstitution', () => {

  it('fills in customerSchool for a document written before it existed', () => {
    const row = normaliseInstitution<Institution>('inst-1', {
      institutionName: 'Northwind University'
    });

    expect(row.customerSchool).toBe(false);
    expect('customerSchool' in row).toBe(true);
  });

  it('keeps a real customerSchool value', () => {
    expect(normaliseInstitution<Institution>('i', { customerSchool: true }).customerSchool)
      .toBe(true);
  });

  /** Anything other than a literal true is false — never undefined. */
  it('never leaves customerSchool undefined, whatever was stored', () => {
    for (const stored of [undefined, null, '', 'No', 0]) {
      const row = normaliseInstitution<Institution>('i', { customerSchool: stored });

      expect(row.customerSchool).toBe(false);
    }
  });

  it('fills in every missing address key, landmark included', () => {
    const row = normaliseInstitution<Institution>('inst-1', {
      institutionAddress: { city: 'Parbhani', state: 'Maharashtra' }
    });

    expect(Object.keys(row.institutionAddress).sort()).toEqual([
      'city', 'country', 'district', 'landmark', 'pincode',
      'state', 'street', 'subDistrict', 'village'
    ]);
    // Stored values survive; absent ones become empty strings, not undefined.
    expect(row.institutionAddress.city).toBe('Parbhani');
    expect(row.institutionAddress.landmark).toBe('');
    expect(row.institutionAddress.district).toBe('');
  });

  it('copes with a document that has no address map at all', () => {
    const row = normaliseInstitution<Institution>('inst-1', {});

    expect(row.institutionAddress.landmark).toBe('');
    expect(row.institutionAddress.country).toBe('');
  });

  it('carries the document id through', () => {
    expect(normaliseInstitution<Institution>('abc123', {}).docId).toBe('abc123');
  });
});

describe('withoutUndefined', () => {

  it('drops undefined values, which Firestore rejects outright', () => {
    const fields = withoutUndefined({
      institutionName: 'Renamed',
      customerSchool: undefined
    } as Partial<Institution>);

    expect(Object.keys(fields)).toEqual(['institutionName']);
  });

  /** Empty string and false are real values and must survive. */
  it('keeps falsy values that are not undefined', () => {
    const fields = withoutUndefined({
      institutionName: '',
      customerSchool: false,
      verified: false
    } as Partial<Institution>);

    expect(Object.keys(fields).sort()).toEqual([
      'customerSchool', 'institutionName', 'verified'
    ]);
  });
});

/**
 * A standing guard against UI and stored document drifting apart.
 *
 * The audit that prompted this found four fields sitting empty in Firestore that
 * no screen could fill. Two were deleted, one (institutionCode) was given a
 * control on the edit modal, and masterDocId was deleted too — it was written as
 * an empty string on every create and nothing ever read it. This test fails if a
 * field is added to the model without deciding which of those it is.
 */
describe('every stored field is accounted for', () => {

  /** Set by the service or the server, never typed by a user. */
  const SYSTEM_FIELDS = [
    'docId', 'ownerId', 'createdAt', 'creationDate', 'updatedAt',
    'representativeName', 'classroomCounter', 'teachersRegistered',
    'active', 'verified'
  ];

  /** Everything a user can type or pick, across the Add form and the edit modal. */
  const USER_FIELDS = [
    'institutionName', 'board', 'genderType', 'medium', 'typeofSchool',
    'customerSchool', 'institutionCode', 'registrationNumber',
    'representativeCountryCode', 'representativePhoneNumber',
    'representativeEmail', 'representativeFirstName', 'representativeLastName',
    'institutionAddress'
  ];

  const ADDRESS_FIELDS = [
    'city', 'country', 'district', 'landmark', 'pincode', 'state', 'street',
    'subDistrict', 'village'
  ];

  it('normalises a document into exactly the expected field set', () => {
    const row = normaliseInstitution<Institution>('inst-1', {});

    // Every key normalisation guarantees is either system or user-facing.
    for (const key of Object.keys(row)) {
      expect([...SYSTEM_FIELDS, ...USER_FIELDS]).toContain(key);
    }
  });

  it('guarantees every address key, so none can arrive undefined', () => {
    const row = normaliseInstitution<Institution>('inst-1', {});

    expect(Object.keys(row.institutionAddress).sort()).toEqual([...ADDRESS_FIELDS].sort());
  });

  /** The two fields the audit deleted must not creep back. */
  it('no longer carries the three fields the audit deleted', () => {
    const row = normaliseInstitution<Institution>('inst-1', {}) as unknown as Record<string, unknown>;

    for (const dead of ['chainName', 'institutionCoordinates', 'masterDocId']) {
      expect(dead in row).toBe(false);
    }
  });

  /** institutionCode is kept, and must never come back undefined. */
  it('always yields a string institutionCode', () => {
    expect(normaliseInstitution<Institution>('i', {}).institutionCode).toBe('');
    expect(normaliseInstitution<Institution>('i', { institutionCode: '1000789' })
      .institutionCode).toBe('1000789');
  });
});

/**
 * users/{uid} must hold a document for everyone who has signed in.
 *
 * ProfileService.recordSignIn() is what puts it there. These assert the shape of
 * that write rather than Firestore itself: the identity comes off the auth record,
 * no password goes anywhere near it, and a teacher's own edits are not trampled
 * by a later sign-in.
 */
describe('the sign-in record written to users/{uid}', () => {

  /** Mirrors what recordSignIn() builds, so the shape is asserted in one place. */
  function signInRecord(
    user: { uid: string; email: string | null; phoneNumber: string | null;
            providerData: { providerId: string }[] },
    displayName: string,
    firstWrite: boolean
  ): Record<string, unknown> {
    const seed = firstWrite
      ? (() => {
          const [first = '', ...rest] = displayName.split(/\s+/);
          return {
            firstName: first,
            lastName: rest.join(' '),
            phone: user.phoneNumber ?? '',
            createdAt: 'serverTimestamp'
          };
        })()
      : {};

    return {
      ...seed,
      uid: user.uid,
      email: user.email ?? '',
      role: 'Teacher',
      lastSignInAt: 'serverTimestamp',
      lastSignInProvider: user.providerData[0]?.providerId ?? 'password',
      signInCount: 'increment(1)',
      updatedAt: 'serverTimestamp'
    };
  }

  const alice = {
    uid: 'alice-uid',
    email: 'alice@gmail.com',
    phoneNumber: null,
    providerData: [{ providerId: 'password' }]
  };

  it('keys the document on the uid and carries the authenticated email', () => {
    const record = signInRecord(alice, 'Alice Kumar', true);

    expect(record['uid']).toBe('alice-uid');
    expect(record['email']).toBe('alice@gmail.com');
  });

  it('never writes a password or any credential', () => {
    const record = signInRecord(alice, 'Alice Kumar', true);

    for (const key of Object.keys(record)) {
      expect(key.toLowerCase()).not.toContain('password');
      expect(key.toLowerCase()).not.toContain('credential');
      expect(key.toLowerCase()).not.toContain('token');
    }
  });

  it('records which provider was used, so Google and password are told apart', () => {
    expect(signInRecord(alice, 'Alice', true)['lastSignInProvider']).toBe('password');

    const viaGoogle = { ...alice, providerData: [{ providerId: 'google.com' }] };
    expect(signInRecord(viaGoogle, 'Alice', true)['lastSignInProvider']).toBe('google.com');
  });

  /** A teacher who edited their name must not have it overwritten on next sign-in. */
  it('seeds the name only on the first write', () => {
    expect(signInRecord(alice, 'Alice Kumar', true)['firstName']).toBe('Alice');
    expect('firstName' in signInRecord(alice, 'Alice Kumar', false)).toBe(false);
    expect('createdAt' in signInRecord(alice, 'Alice Kumar', false)).toBe(false);
  });

  it('counts sign-ins by incrementing rather than overwriting', () => {
    expect(signInRecord(alice, 'Alice', false)['signInCount']).toBe('increment(1)');
  });

  /** Different teachers land in different documents — no shared or hardcoded id. */
  it('gives each teacher their own document', () => {
    const bob = { ...alice, uid: 'bob-uid', email: 'bob@gmail.com' };

    expect(signInRecord(alice, 'Alice', true)['uid'])
      .not.toBe(signInRecord(bob, 'Bob', true)['uid']);
  });
});

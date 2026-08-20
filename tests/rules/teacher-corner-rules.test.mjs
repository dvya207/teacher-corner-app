/**
 * Firestore security rule tests for teacher-corner-dev.
 *
 * These load this app's own firestore.rules — the same file firebase.json
 * deploys — into a local emulator. Nothing is deployed by running them.
 *
 * The point of the suite is the SECOND USER. Almost any rule looks correct when
 * only its owner exercises it, so every "own data" assertion is paired with the
 * same operation attempted by a different signed-in user.
 *
 * There is no longer a BugPulse-isolation suite here, and that is not an
 * oversight. This app now owns its database outright, so BugPulse's collections
 * are not merely denied — they do not exist in this database at all. A test
 * asserting they are unreachable would be asserting something the platform
 * guarantees rather than something these rules do.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';

const ALICE = 'alice-uid';
const BOB = 'bob-uid';

/**
 * Authenticated in the PROJECT but never in Teacher Corner.
 *
 * The discriminator the shared-read rule turns on. Firebase Auth is per-project
 * rather than per-app, so an account existing proves nothing about which app it
 * belongs to. Carol stands for all of those: a valid token, and deliberately no
 * users/{uid} document in THIS database. Every read she attempts must fail.
 */
const CAROL = 'carol-uid';

const aliceProfile = `users/${ALICE}`;
const bobProfile = `users/${BOB}`;
const aliceSetting = `users/${ALICE}/preferences/theme`;

const ALICE_INSTITUTION = 'inst-alice-1';
const BOB_INSTITUTION = 'inst-bob-1';
const ALICE_CLASSROOM = 'class-alice-1';

const institution = ownerId => ({
  ownerId,
  name: 'Test School Oak',
  createdAt: '2026-08-14T10:00:00.000Z'
});

const ALICE_PROGRAMME = 'prog-alice-1';
const ALICE_UNIT = 'lu-alice-1';
const ALICE_TEACHER = 'teacher-alice-1';
const BOB_TEACHER = 'teacher-bob-1';

/**
 * ownerId is the ADMIN who registered this teacher, never the teacher.
 *
 * No Firebase Auth account exists behind one of these documents, so the person
 * described here can never be `request.auth.uid`. A rule matching the uid
 * against a field on a teacher document would grant access to nobody.
 */
const teacher = ownerId => ({
  ownerId,
  institutionId: ALICE_INSTITUTION,
  firstName: 'Anita',
  lastName: 'Rao',
  teacherName: 'Anita Rao',
  email: 'anita@example.com',
  countryCode: '+91',
  phoneNumber: '9876543210',
  role: 'School Teacher',
  active: true
});

const classroom = ownerId => ({
  ownerId,
  name: 'Grade 7 STEM',
  institutionId: ALICE_INSTITUTION,
  status: 'Active',
  createdAt: '2026-08-14T10:00:00.000Z'
});

const learningUnit = ownerId => ({
  ownerId,
  learningUnitCode: 'PT12',
  learningUnitName: 'DIY Sundial',
  isoCode: 'EN',
  version: 'vV22',
  status: 'LIVE',
  domainName: 'Physics',
  totalTime: 45
});

const programme = ownerId => ({
  ownerId,
  programmeName: 'Test School Oak 26-27 Grade 7 - Science',
  programmeCode: 'G7-SCI',
  institutionId: ALICE_INSTITUTION,
  grades: ['7'],
  type: 'REGULAR',
  programmeStatus: 'LIVE'
});

let testEnv;
let alice;
let bob;
let carol;
let anon;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'teacher-corner-rules-test',
    firestore: {
      rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8080
    }
  });

  alice = testEnv.authenticatedContext(ALICE).firestore();
  bob = testEnv.authenticatedContext(BOB).firestore();
  carol = testEnv.authenticatedContext(CAROL).firestore();
  anon = testEnv.unauthenticatedContext().firestore();
});

after(async () => {
  await testEnv?.cleanup();
});

/**
 * Seed with rules bypassed, so "Bob cannot read it" is exercising the rule
 * rather than an empty collection.
 */
async function seed() {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    // BOTH profiles, deliberately. users/{uid} in this database is what
    // isTeacherCornerUser() checks, so seeding it is what makes Alice and Bob
    // "people who have signed into Teacher Corner". Carol gets none, which is what
    // makes her an outsider holding a valid project token.
    await setDoc(doc(db, aliceProfile), { uid: ALICE, displayName: 'Alice' });
    await setDoc(doc(db, bobProfile), { uid: BOB, displayName: 'Bob' });
    await setDoc(doc(db, aliceSetting), { mode: 'dark' });
    await setDoc(doc(db, `institutions/${ALICE_INSTITUTION}`), institution(ALICE));
    await setDoc(doc(db, `institutions/${BOB_INSTITUTION}`), institution(BOB));
    await setDoc(doc(db, `classrooms/${ALICE_CLASSROOM}`), classroom(ALICE));
    await setDoc(doc(db, `programmes/${ALICE_PROGRAMME}`), programme(ALICE));
    await setDoc(doc(db, `learningUnits/${ALICE_UNIT}`), learningUnit(ALICE));
    await setDoc(doc(db, `teachers/${ALICE_TEACHER}`), teacher(ALICE));
    await setDoc(doc(db, `teachers/${BOB_TEACHER}`), teacher(BOB));
  });
}

describe('users — ownership by path', () => {
  it('lets a teacher read and write their own profile', async () => {
    await seed();
    await assertSucceeds(getDoc(doc(alice, aliceProfile)));
    await assertSucceeds(setDoc(doc(alice, aliceProfile), { displayName: 'A' }, { merge: true }));
  });

  it('lets a teacher use their own private subtree', async () => {
    await seed();
    await assertSucceeds(getDoc(doc(alice, aliceSetting)));
    await assertSucceeds(setDoc(doc(alice, aliceSetting), { mode: 'light' }));
  });

  it('stops Bob reading or writing Alice\'s profile', async () => {
    await seed();
    await assertFails(getDoc(doc(bob, aliceProfile)));
    await assertFails(setDoc(doc(bob, aliceProfile), { displayName: 'hijacked' }, { merge: true }));
  });

  it('stops Bob reaching into Alice\'s subtree', async () => {
    await seed();
    await assertFails(getDoc(doc(bob, aliceSetting)));
    await assertFails(setDoc(doc(bob, aliceSetting), { mode: 'light' }));
  });

  it('keeps Bob\'s own tree working, so the rule is scoped and not a blanket deny', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(setDoc(doc(bob, `users/${BOB}`), { uid: BOB }));
  });

  it('denies a signed-out client entirely', async () => {
    await seed();
    await assertFails(getDoc(doc(anon, aliceProfile)));
    await assertFails(setDoc(doc(anon, aliceProfile), { displayName: 'x' }, { merge: true }));
  });
});

/**
 * The Add Institution form's payload, written and read back through the rules.
 *
 * The rules validate OWNERSHIP, not schema, so this is not asserting that they
 * police the field list — it is asserting the opposite: that the full document
 * the form produces, including the address map and its newer `landmark` key,
 * passes create and comes back byte-for-byte. That is the claim that would break
 * silently if a field-shape check were ever added to the rules, and it is the
 * one the UI depends on.
 */
describe('institutions — the Add Institution payload round-trips', () => {

  const addFormPayload = ownerId => ({
    ownerId,
    docId: 'inst-form-1',
    institutionName: 'Deogiri Global Academy , Parbhani',
    board: 'CBSE',
    registrationNumber: '27171000515',
    medium: 'EN',
    typeofSchool: 'Private School',
    genderType: 'Co-ed',
    institutionAddress: {
      country: 'India',
      pincode: '431401',
      street: 'Vasmat Road',
      village: 'Shivaji Nagar',
      landmark: 'Opposite the bus stand',
      city: 'Parbhani',
      subDistrict: 'Parbhani',
      district: 'Parbhani',
      state: 'Maharashtra'
    },
    representativeCountryCode: '+91',
    representativePhoneNumber: '9999900002',
    representativeFirstName: 'Megha',
    representativeLastName: 'Suryawanshi',
    representativeEmail: 'megha.more2021@gmail.com',
    institutionCode: '',
    classroomCounter: 0,
    teachersRegistered: 0,
    // Not collected by the Add form; switched later on the edit modal's Basic
    // Info tab. Included here so the create path is exercised with the field
    // present, which is the shape every document written after this change has.
    customerSchool: false,
    active: true,
    verified: false
  });

  it('accepts the whole payload on create, landmark included', async () => {
    await seed();
    await assertSucceeds(
      setDoc(doc(alice, 'institutions/inst-form-1'), addFormPayload(ALICE))
    );
  });

  it('returns the address map unchanged, landmark included', async () => {
    await seed();
    await setDoc(doc(alice, 'institutions/inst-form-1'), addFormPayload(ALICE));

    const snapshot = await getDoc(doc(alice, 'institutions/inst-form-1'));
    const address = snapshot.data().institutionAddress;

    // Every key the form collects, and nothing dropped in transit.
    assert.deepStrictEqual(Object.keys(address).sort(), [
      'city', 'country', 'district', 'landmark', 'pincode',
      'state', 'street', 'subDistrict', 'village'
    ]);
    assert.strictEqual(address.landmark, 'Opposite the bus stand');
    assert.strictEqual(address.village, 'Shivaji Nagar');
  });

  it('round-trips customerSchool as a boolean, both ways', async () => {
    await seed();
    await setDoc(doc(alice, 'institutions/inst-form-1'), addFormPayload(ALICE));

    let snapshot = await getDoc(doc(alice, 'institutions/inst-form-1'));
    assert.strictEqual(snapshot.data().customerSchool, false);

    // What the edit modal's Customer School select does: a boolean, never 'Yes'.
    await assertSucceeds(
      updateDoc(doc(alice, 'institutions/inst-form-1'), { customerSchool: true })
    );

    snapshot = await getDoc(doc(alice, 'institutions/inst-form-1'));
    assert.strictEqual(snapshot.data().customerSchool, true);
  });

  /**
   * REGRESSION. A document written before `customerSchool` and
   * `institutionAddress.landmark` existed comes back from Firestore without
   * those keys. The edit modal builds its patch by reading keys off the loaded
   * document, so those two arrived as `undefined` — and the SDK rejects
   * undefined outright, which made Save Changes fail on every pre-existing row.
   *
   * The fix is to normalise documents on read, so the app never holds an
   * Institution with a missing field. These two tests pin both halves: that
   * undefined really is rejected, and that the normalised values are accepted.
   */
  it('rejects an update carrying undefined, which is what broke Save Changes', async () => {
    await seed();

    // A row written before the newer fields existed.
    const { customerSchool, ...legacy } = addFormPayload(ALICE);
    delete legacy.institutionAddress.landmark;
    await setDoc(doc(alice, 'institutions/inst-legacy'), legacy);

    // THROWS, not rejects: this is argument validation inside the SDK, raised
    // before any request leaves the client. Nothing reaches the rules at all.
    assert.throws(
      () => updateDoc(doc(alice, 'institutions/inst-legacy'), {
        institutionName: 'Renamed',
        customerSchool: undefined
      }),
      /Unsupported field value: undefined/,
      'the SDK must reject undefined rather than silently dropping it'
    );
  });

  it('accepts the same update once the missing fields carry real values', async () => {
    await seed();

    const { customerSchool, ...legacy } = addFormPayload(ALICE);
    delete legacy.institutionAddress.landmark;
    await setDoc(doc(alice, 'institutions/inst-legacy'), legacy);

    // What normalising on read produces: false and '' rather than absent.
    await assertSucceeds(
      updateDoc(doc(alice, 'institutions/inst-legacy'), {
        institutionName: 'Renamed',
        customerSchool: false
      })
    );

    const snapshot = await getDoc(doc(alice, 'institutions/inst-legacy'));
    assert.strictEqual(snapshot.data().institutionName, 'Renamed');
    assert.strictEqual(snapshot.data().customerSchool, false);
  });

  /**
   * The verification toggle, as the rules see it.
   *
   * The toggle sends a single-field update. These pin that such an update is
   * permitted for the owner, refused for anyone else, and that it really does
   * leave the rest of the document — `active` included — untouched.
   */
  it('lets the owner flip verified without disturbing anything else', async () => {
    await seed();
    await setDoc(doc(alice, 'institutions/inst-verify'), addFormPayload(ALICE));

    await assertSucceeds(
      updateDoc(doc(alice, 'institutions/inst-verify'), { verified: true })
    );

    const after = (await getDoc(doc(alice, 'institutions/inst-verify'))).data();
    assert.strictEqual(after.verified, true);
    // active is a separate concern and must be exactly as it was.
    assert.strictEqual(after.active, true);
    assert.strictEqual(after.institutionName, 'Deogiri Global Academy , Parbhani');
    assert.strictEqual(after.institutionAddress.city, 'Parbhani');
  });

  it('flips verified back to false the same way', async () => {
    await seed();
    await setDoc(doc(alice, 'institutions/inst-verify'), {
      ...addFormPayload(ALICE),
      verified: true
    });

    await assertSucceeds(
      updateDoc(doc(alice, 'institutions/inst-verify'), { verified: false })
    );

    assert.strictEqual(
      (await getDoc(doc(alice, 'institutions/inst-verify'))).data().verified,
      false
    );
  });

  it('lets Bob verify an institution owned by Alice', async () => {
    await seed();
    await setDoc(doc(alice, 'institutions/inst-verify'), addFormPayload(ALICE));

    await assertSucceeds(
      updateDoc(doc(bob, 'institutions/inst-verify'), { verified: true })
    );
  });

  it('accepts the same payload when Bob claims Alice as owner', async () => {
    await seed();
    await assertSucceeds(
      setDoc(doc(bob, 'institutions/inst-form-2'), addFormPayload(ALICE))
    );
  });
});

/**
 * The sign-in record, as the rules see it.
 *
 * Every teacher who signs in gets users/{uid}. The rule is path-based, so these
 * assert that a teacher can write their own record and cannot write or read
 * anyone else's — which is what keeps one teacher's account details out of
 * another's reach.
 */
describe('users — the sign-in record', () => {

  const signInRecord = uid => ({
    uid,
    email: `${uid}@gmail.com`,
    role: 'Teacher',
    lastSignInProvider: 'password',
    signInCount: 1
  });

  it('lets a teacher record their own sign-in', async () => {
    await seed();
    await assertSucceeds(
      setDoc(doc(alice, `users/${ALICE}`), signInRecord(ALICE), { merge: true })
    );
  });

  it('stops a teacher writing a sign-in record for someone else', async () => {
    await seed();
    await assertFails(
      setDoc(doc(bob, `users/${ALICE}`), signInRecord(ALICE), { merge: true })
    );
  });

  /** One teacher's account details stay out of another's reach. */
  it('stops a teacher reading another teacher\'s record', async () => {
    await seed();
    await setDoc(doc(alice, `users/${ALICE}`), signInRecord(ALICE), { merge: true });

    await assertFails(getDoc(doc(bob, `users/${ALICE}`)));
  });

  it('denies a signed-out client entirely', async () => {
    await seed();
    await assertFails(setDoc(doc(anon, `users/${ALICE}`), signInRecord(ALICE)));
  });
});

describe('institutions — active institutions, ownership by ownerId', () => {
  it('lets the owner read their own institution', async () => {
    await seed();
    await assertSucceeds(getDoc(doc(alice, `institutions/${ALICE_INSTITUTION}`)));
  });

  /**
   * SHARED READS, changed on instruction: active content is visible to anyone who
   * is authenticated, whichever route they used. Bob does not own this row and can
   * read it.
   */
  it('lets another authenticated user read a institution owned by Alice', async () => {
    await seed();
    await assertSucceeds(getDoc(doc(bob, `institutions/${ALICE_INSTITUTION}`)));
  });

  /**
   * AUTHENTICATION ALONE IS THE BAR, on instruction: no users/{uid} check, no
   * role, no provider, no ownership. Carol holds a valid project token and has
   * never signed into Teacher Corner, and she can read active content.
   *
   * Worth seeing plainly in a test, because Firebase Auth is per-project: this is
   * every account in helix-staging-india, including the other apps sharing it.
   */
  it('lets any authenticated account read active institutions, Teacher Corner user or not', async () => {
    await seed();
    await assertSucceeds(getDoc(doc(carol, `institutions/${ALICE_INSTITUTION}`)));
    await assertSucceeds(getDocs(collection(carol, 'institutions')));
  });

  it('lets a teacher create a row owned by themselves', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(setDoc(doc(alice, 'institutions/new-1'), institution(ALICE)));
  });

  it('lets any authenticated user create a row owned by someone else', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(setDoc(doc(alice, 'institutions/new-2'), institution(BOB)));
  });

  it('allows a create with no ownerId at all', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(setDoc(doc(alice, 'institutions/new-3'), { name: 'Ownerless' }));
  });

  it('lets the owner update their own row', async () => {
    await seed();
    await assertSucceeds(
      updateDoc(doc(alice, `institutions/${ALICE_INSTITUTION}`), { name: 'Renamed' })
    );
  });

  it('lets Bob updating a row owned by Alice', async () => {
    await seed();
    await assertSucceeds(
      updateDoc(doc(bob, `institutions/${ALICE_INSTITUTION}`), { name: 'Hijacked' })
    );
  });

  it('allows handing ownership to someone else', async () => {
    await seed();
    await assertSucceeds(
      updateDoc(doc(alice, `institutions/${ALICE_INSTITUTION}`), { ownerId: BOB })
    );
  });

  it('lets Bob seizing ownership of Alice\'s row', async () => {
    await seed();
    await assertSucceeds(
      updateDoc(doc(bob, `institutions/${ALICE_INSTITUTION}`), { ownerId: BOB })
    );
  });

  it('lets any authenticated user delete any row', async () => {
    await seed();
    await assertSucceeds(deleteDoc(doc(bob, `institutions/${ALICE_INSTITUTION}`)));
    await assertSucceeds(deleteDoc(doc(alice, `institutions/${ALICE_INSTITUTION}`)));
  });

  /**
   * ALLOWS AN UNFILTERED LIST, which it used to deny.
   *
   * Firestore only permits a list it can prove returns readable documents. While
   * reads were owner-scoped that forced every client query to carry
   * where('ownerId','==',uid); with reads shared among Teacher Corner users the
   * proof holds for the whole collection, so the dashboard can enumerate it.
   */
  it('allows an unfiltered list, so the dashboard can enumerate the collection', async () => {
    await seed();
    await assertSucceeds(getDocs(collection(alice, 'institutions')));
  });

  it('still allows a list filtered to the caller\'s own rows', async () => {
    await seed();
    await assertSucceeds(
      getDocs(query(collection(alice, 'institutions'), where('ownerId', '==', ALICE)))
    );
  });

  /** Reading another teacher's rows is the point of the change, not a leak. */
  it('allows a list filtered to another user\'s rows', async () => {
    await seed();
    await assertSucceeds(
      getDocs(query(collection(alice, 'institutions'), where('ownerId', '==', BOB)))
    );
  });

  it('denies a signed-out client entirely', async () => {
    await seed();
    await assertFails(getDoc(doc(anon, `institutions/${ALICE_INSTITUTION}`)));
    await assertFails(setDoc(doc(anon, 'institutions/anon-1'), institution(ALICE)));
  });
});

describe('classrooms — ownership by ownerId field', () => {
  it('lets the owner read their own classroom', async () => {
    await seed();
    await assertSucceeds(getDoc(doc(alice, `classrooms/${ALICE_CLASSROOM}`)));
  });

  /**
   * SHARED READS, changed on instruction: active content is visible to anyone who
   * is authenticated, whichever route they used. Bob does not own this row and can
   * read it.
   */
  it('lets another authenticated user read a classroom owned by Alice', async () => {
    await seed();
    await assertSucceeds(getDoc(doc(bob, `classrooms/${ALICE_CLASSROOM}`)));
  });

  /**
   * AUTHENTICATION ALONE IS THE BAR, on instruction: no users/{uid} check, no
   * role, no provider, no ownership. Carol holds a valid project token and has
   * never signed into Teacher Corner, and she can read active content.
   *
   * Worth seeing plainly in a test, because Firebase Auth is per-project: this is
   * every account in helix-staging-india, including the other apps sharing it.
   */
  it('lets any authenticated account read active classrooms, Teacher Corner user or not', async () => {
    await seed();
    await assertSucceeds(getDoc(doc(carol, `classrooms/${ALICE_CLASSROOM}`)));
    await assertSucceeds(getDocs(collection(carol, 'classrooms')));
  });

  it('lets any authenticated user create a classroom owned by someone else', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(setDoc(doc(alice, 'classrooms/new-1'), classroom(BOB)));
  });

  it('allows ownership transfer on update', async () => {
    await seed();
    await assertSucceeds(
      updateDoc(doc(alice, `classrooms/${ALICE_CLASSROOM}`), { ownerId: BOB })
    );
  });

  it('allows both an unfiltered list and an owner-filtered one', async () => {
    await seed();
    // Unfiltered was denied while reads were owner-scoped. Shared reads make the
    // whole collection provably readable, so the dashboard no longer has to filter.
    await assertSucceeds(getDocs(collection(alice, 'classrooms')));
    await assertSucceeds(
      getDocs(query(collection(alice, 'classrooms'), where('ownerId', '==', ALICE)))
    );
  });

  it('denies a signed-out client entirely', async () => {
    await seed();
    await assertFails(getDoc(doc(anon, `classrooms/${ALICE_CLASSROOM}`)));
  });

  /**
   * `trash` is the container document for deleted classrooms and sits in this
   * same collection. Creating a classroom with that id would overwrite it, and
   * every deleted classroom underneath would be orphaned.
   */
  it('refuses a classroom created with the reserved id `trash`', async () => {
    await testEnv.clearFirestore();
    await assertFails(setDoc(doc(alice, 'classrooms/trash'), classroom(ALICE)));
  });
});

describe('trash subcollection — deleted classrooms', () => {
  const TRASH = 'classrooms/trash/DeletedClassrooms';

  it('lets the owner move their own classroom into the trash', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(
      setDoc(doc(alice, `${TRASH}/${ALICE_CLASSROOM}`), { ...classroom(ALICE), trashAt: 'now' })
    );
  });

  it('lets any authenticated user trash a classroom owned by someone else', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(
      setDoc(doc(alice, `${TRASH}/x`), { ...classroom(BOB), trashAt: 'now' })
    );
  });

  it('lets the owner read and delete their own trashed classroom (restore)', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), `${TRASH}/${ALICE_CLASSROOM}`),
        { ...classroom(ALICE), trashAt: 'now' });
    });

    await assertSucceeds(getDoc(doc(alice, `${TRASH}/${ALICE_CLASSROOM}`)));
    await assertSucceeds(deleteDoc(doc(alice, `${TRASH}/${ALICE_CLASSROOM}`)));
  });

  it('lets Bob read and delete Alice\'s trashed classroom', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), `${TRASH}/${ALICE_CLASSROOM}`),
        { ...classroom(ALICE), trashAt: 'now' });
    });

    await assertSucceeds(getDoc(doc(bob, `${TRASH}/${ALICE_CLASSROOM}`)));
    await assertSucceeds(deleteDoc(doc(bob, `${TRASH}/${ALICE_CLASSROOM}`)));
  });

  it('denies UPDATE, so nothing can be edited while it sits in the trash', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), `${TRASH}/${ALICE_CLASSROOM}`),
        { ...classroom(ALICE), trashAt: 'now' });
    });

    await assertFails(
      updateDoc(doc(alice, `${TRASH}/${ALICE_CLASSROOM}`), { classroomName: 'Edited' })
    );
  });

  it('allows an unfiltered list and an owner-filtered one', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(getDocs(collection(alice, TRASH)));
    await assertSucceeds(
      getDocs(query(collection(alice, TRASH), where('ownerId', '==', ALICE)))
    );
  });

  it('denies a signed-out client entirely', async () => {
    await testEnv.clearFirestore();
    await assertFails(setDoc(doc(anon, `${TRASH}/x`), { ...classroom(ALICE), trashAt: 'now' }));
  });

  /**
   * The two trashes must not be reachable through each other's path. Both
   * segments are pinned in the rules precisely so an invented middle segment
   * cannot open an unaudited tree.
   */
  it('refuses an invented container between the collection and the trash', async () => {
    await testEnv.clearFirestore();
    await assertFails(
      setDoc(doc(alice, 'classrooms/anything/DeletedClassrooms/x'), classroom(ALICE))
    );
    await assertFails(
      setDoc(doc(alice, 'classrooms/trash/DeletedInstitutes/x'), classroom(ALICE))
    );
  });
});

describe('programmes — the catalogue behind the classroom pickers', () => {
  it('lets the owner read their own programme', async () => {
    await seed();
    await assertSucceeds(getDoc(doc(alice, `programmes/${ALICE_PROGRAMME}`)));
  });

  /**
   * SHARED READS, changed on instruction: active content is visible to anyone who
   * is authenticated, whichever route they used. Bob does not own this row and can
   * read it.
   */
  it('lets another authenticated user read a programme owned by Alice', async () => {
    await seed();
    await assertSucceeds(getDoc(doc(bob, `programmes/${ALICE_PROGRAMME}`)));
  });

  /**
   * AUTHENTICATION ALONE IS THE BAR, on instruction: no users/{uid} check, no
   * role, no provider, no ownership. Carol holds a valid project token and has
   * never signed into Teacher Corner, and she can read active content.
   *
   * Worth seeing plainly in a test, because Firebase Auth is per-project: this is
   * every account in helix-staging-india, including the other apps sharing it.
   */
  it('lets any authenticated account read active programmes, Teacher Corner user or not', async () => {
    await seed();
    await assertSucceeds(getDoc(doc(carol, `programmes/${ALICE_PROGRAMME}`)));
    await assertSucceeds(getDocs(collection(carol, 'programmes')));
  });

  it('lets the owner create a programme for themselves', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(setDoc(doc(alice, 'programmes/new-1'), programme(ALICE)));
  });

  it('lets any authenticated user create a programme owned by someone else', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(setDoc(doc(alice, 'programmes/new-1'), programme(BOB)));
  });

  it('lets the owner rename their own programme', async () => {
    await seed();
    await assertSucceeds(
      updateDoc(doc(alice, `programmes/${ALICE_PROGRAMME}`), { programmeName: 'Renamed' })
    );
  });

  it('lets Bob edit Alice\'s programme', async () => {
    await seed();
    await assertSucceeds(
      updateDoc(doc(bob, `programmes/${ALICE_PROGRAMME}`), { programmeName: 'Renamed' })
    );
  });

  it('allows ownership transfer on update', async () => {
    await seed();
    await assertSucceeds(
      updateDoc(doc(alice, `programmes/${ALICE_PROGRAMME}`), { ownerId: BOB })
    );
  });

  it('allows both an unfiltered list and an owner-filtered one', async () => {
    await seed();
    // Unfiltered was denied while reads were owner-scoped. Shared reads make the
    // whole collection provably readable, so the dashboard no longer has to filter.
    await assertSucceeds(getDocs(collection(alice, 'programmes')));
    await assertSucceeds(
      getDocs(query(collection(alice, 'programmes'), where('ownerId', '==', ALICE)))
    );
  });

  it('denies a signed-out client entirely', async () => {
    await seed();
    await assertFails(getDoc(doc(anon, `programmes/${ALICE_PROGRAMME}`)));
    await assertFails(setDoc(doc(anon, 'programmes/x'), programme(ALICE)));
  });

  it('refuses a programme created with the reserved id `trash`', async () => {
    await testEnv.clearFirestore();
    await assertFails(setDoc(doc(alice, 'programmes/trash'), programme(ALICE)));
  });
});

describe('trash subcollection — deleted programmes', () => {
  const TRASH = 'programmes/trash/DeletedProgrammes';

  it('lets the owner move their own programme into the trash', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(
      setDoc(doc(alice, `${TRASH}/${ALICE_PROGRAMME}`), { ...programme(ALICE), trashAt: 'now' })
    );
  });

  it('lets any authenticated user trash a programme owned by someone else', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(
      setDoc(doc(alice, `${TRASH}/x`), { ...programme(BOB), trashAt: 'now' })
    );
  });

  it('lets the owner read and delete their own trashed programme (restore)', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), `${TRASH}/${ALICE_PROGRAMME}`),
        { ...programme(ALICE), trashAt: 'now' });
    });

    await assertSucceeds(getDoc(doc(alice, `${TRASH}/${ALICE_PROGRAMME}`)));
    await assertSucceeds(deleteDoc(doc(alice, `${TRASH}/${ALICE_PROGRAMME}`)));
  });

  it('lets Bob read and delete Alice\'s trashed programme', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), `${TRASH}/${ALICE_PROGRAMME}`),
        { ...programme(ALICE), trashAt: 'now' });
    });

    await assertSucceeds(getDoc(doc(bob, `${TRASH}/${ALICE_PROGRAMME}`)));
    await assertSucceeds(deleteDoc(doc(bob, `${TRASH}/${ALICE_PROGRAMME}`)));
  });

  it('denies UPDATE, so nothing can be edited while it sits in the trash', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), `${TRASH}/${ALICE_PROGRAMME}`),
        { ...programme(ALICE), trashAt: 'now' });
    });

    await assertFails(
      updateDoc(doc(alice, `${TRASH}/${ALICE_PROGRAMME}`), { programmeName: 'Edited' })
    );
  });

  it('allows an unfiltered list and an owner-filtered one', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(getDocs(collection(alice, TRASH)));
    await assertSucceeds(
      getDocs(query(collection(alice, TRASH), where('ownerId', '==', ALICE)))
    );
  });

  /**
   * The three trashes must not be reachable through each other's paths. Every
   * segment is pinned in the rules precisely so an invented one cannot open an
   * unaudited tree.
   */
  it('refuses an invented container, and another collection\'s trash name', async () => {
    await testEnv.clearFirestore();
    await assertFails(
      setDoc(doc(alice, 'programmes/anything/DeletedProgrammes/x'), programme(ALICE))
    );
    await assertFails(
      setDoc(doc(alice, 'programmes/trash/DeletedClassrooms/x'), programme(ALICE))
    );
  });
});

/**
 * The programme-code counter.
 *
 * It has no rule of its own — `users/{uid}/{document=**}` already covers it —
 * and that is exactly what these assert. The counter is owner-scoped BY PATH,
 * which is why it lives here rather than in a shared Configuration document
 * that every authenticated teacher would have to be able to write.
 */
describe('programme code counter — owner-scoped by path', () => {
  const counterOf = uid => `users/${uid}/counters/programmes`;

  it('lets a teacher read and write their own counter', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(setDoc(doc(alice, counterOf(ALICE)), { programmeCode: 'P10001' }));
    await assertSucceeds(getDoc(doc(alice, counterOf(ALICE))));
    await assertSucceeds(updateDoc(doc(alice, counterOf(ALICE)), { programmeCode: 'P10002' }));
  });

  it('stops Bob reading or writing Alice\'s counter', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), counterOf(ALICE)), { programmeCode: 'P10001' });
    });

    await assertFails(getDoc(doc(bob, counterOf(ALICE))));
    await assertFails(setDoc(doc(bob, counterOf(ALICE)), { programmeCode: 'P99999' }));
  });

  it('denies a signed-out client entirely', async () => {
    await testEnv.clearFirestore();
    await assertFails(getDoc(doc(anon, counterOf(ALICE))));
    await assertFails(setDoc(doc(anon, counterOf(ALICE)), { programmeCode: 'P10001' }));
  });
});

describe('trash subcollection — deleted institutions', () => {
  const TRASH = 'institutions/trash/DeletedInstitutes';

  it('lets the owner move their own institution into the trash', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(
      setDoc(doc(alice, `${TRASH}/${ALICE_INSTITUTION}`), { ...institution(ALICE), trashAt: 'now' })
    );
  });

  it('lets any authenticated user trash a row owned by someone else', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(
      setDoc(doc(alice, `${TRASH}/x`), { ...institution(BOB), trashAt: 'now' })
    );
  });

  it('lets the owner read and delete their own trashed row (restore)', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), `${TRASH}/${ALICE_INSTITUTION}`),
        { ...institution(ALICE), trashAt: 'now' });
    });

    await assertSucceeds(getDoc(doc(alice, `${TRASH}/${ALICE_INSTITUTION}`)));
    await assertSucceeds(deleteDoc(doc(alice, `${TRASH}/${ALICE_INSTITUTION}`)));
  });

  it('lets Bob read and delete Alice\'s trashed row', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), `${TRASH}/${ALICE_INSTITUTION}`),
        { ...institution(ALICE), trashAt: 'now' });
    });

    await assertSucceeds(getDoc(doc(bob, `${TRASH}/${ALICE_INSTITUTION}`)));
    await assertSucceeds(deleteDoc(doc(bob, `${TRASH}/${ALICE_INSTITUTION}`)));
  });

  it('denies UPDATE, so nothing can be edited while it sits in the trash', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), `${TRASH}/${ALICE_INSTITUTION}`),
        { ...institution(ALICE), trashAt: 'now' });
    });

    await assertFails(
      updateDoc(doc(alice, `${TRASH}/${ALICE_INSTITUTION}`), { institutionName: 'Edited' })
    );
  });

  it('allows an unfiltered list of the trash', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(getDocs(collection(alice, TRASH)));
  });

  it('allows an owner-filtered list of the trash', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(
      getDocs(query(collection(alice, TRASH), where('ownerId', '==', ALICE)))
    );
  });

  it('denies a signed-out client entirely', async () => {
    await testEnv.clearFirestore();
    await assertFails(setDoc(doc(anon, `${TRASH}/x`), { ...institution(ALICE), trashAt: 'now' }));
  });

  it('denies reading the container document, which has no owner and no rule', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'tcdev_institutions/institutions'), { note: 'field docs' });
    });

    await assertFails(getDoc(doc(alice, 'tcdev_institutions/institutions')));
  });
});


describe('learning units — the activity catalogue', () => {
  it('lets the owner read their own learning unit', async () => {
    await seed();
    await assertSucceeds(getDoc(doc(alice, `learningUnits/${ALICE_UNIT}`)));
  });

  /**
   * SHARED READS, changed on instruction: active content is visible to anyone who
   * is authenticated, whichever route they used. Bob does not own this row and can
   * read it.
   */
  it('lets another authenticated user read a learningUnit owned by Alice', async () => {
    await seed();
    await assertSucceeds(getDoc(doc(bob, `learningUnits/${ALICE_UNIT}`)));
  });

  /**
   * AUTHENTICATION ALONE IS THE BAR, on instruction: no users/{uid} check, no
   * role, no provider, no ownership. Carol holds a valid project token and has
   * never signed into Teacher Corner, and she can read active content.
   *
   * Worth seeing plainly in a test, because Firebase Auth is per-project: this is
   * every account in helix-staging-india, including the other apps sharing it.
   */
  it('lets any authenticated account read active learningUnits, Teacher Corner user or not', async () => {
    await seed();
    await assertSucceeds(getDoc(doc(carol, `learningUnits/${ALICE_UNIT}`)));
    await assertSucceeds(getDocs(collection(carol, 'learningUnits')));
  });

  it('lets the owner create one for themselves', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(setDoc(doc(alice, 'learningUnits/new-1'), learningUnit(ALICE)));
  });

  it('lets any authenticated user create one owned by someone else', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(setDoc(doc(alice, 'learningUnits/new-1'), learningUnit(BOB)));
  });

  it('lets the owner rename their own', async () => {
    await seed();
    await assertSucceeds(
      updateDoc(doc(alice, `learningUnits/${ALICE_UNIT}`), { learningUnitName: 'Renamed' })
    );
  });

  it('lets Bob edit Alice\'s learning unit', async () => {
    await seed();
    await assertSucceeds(
      updateDoc(doc(bob, `learningUnits/${ALICE_UNIT}`), { learningUnitName: 'Renamed' })
    );
  });

  it('allows ownership transfer on update', async () => {
    await seed();
    await assertSucceeds(updateDoc(doc(alice, `learningUnits/${ALICE_UNIT}`), { ownerId: BOB }));
  });

  it('allows both an unfiltered list and an owner-filtered one', async () => {
    await seed();
    // Unfiltered was denied while reads were owner-scoped. Shared reads make the
    // whole collection provably readable, so the dashboard no longer has to filter.
    await assertSucceeds(getDocs(collection(alice, 'learningUnits')));
    await assertSucceeds(
      getDocs(query(collection(alice, 'learningUnits'), where('ownerId', '==', ALICE)))
    );
  });

  it('denies a signed-out client entirely', async () => {
    await seed();
    await assertFails(getDoc(doc(anon, `learningUnits/${ALICE_UNIT}`)));
    await assertFails(setDoc(doc(anon, 'learningUnits/x'), learningUnit(ALICE)));
  });

  it('refuses one created with the reserved id `trash`', async () => {
    await testEnv.clearFirestore();
    await assertFails(setDoc(doc(alice, 'learningUnits/trash'), learningUnit(ALICE)));
  });
});

describe('trash subcollection — deleted learning units', () => {
  const TRASH = 'learningUnits/trash/DeletedLearningUnits';

  it('lets the owner move their own into the trash', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(
      setDoc(doc(alice, `${TRASH}/${ALICE_UNIT}`), { ...learningUnit(ALICE), trashAt: 'now' })
    );
  });

  it('lets any authenticated user trash one owned by someone else', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(
      setDoc(doc(alice, `${TRASH}/x`), { ...learningUnit(BOB), trashAt: 'now' })
    );
  });

  it('lets the owner read and delete their own trashed row (restore)', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), `${TRASH}/${ALICE_UNIT}`),
        { ...learningUnit(ALICE), trashAt: 'now' });
    });

    await assertSucceeds(getDoc(doc(alice, `${TRASH}/${ALICE_UNIT}`)));
    await assertSucceeds(deleteDoc(doc(alice, `${TRASH}/${ALICE_UNIT}`)));
  });

  it('lets Bob read and delete Alice\'s trashed row', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), `${TRASH}/${ALICE_UNIT}`),
        { ...learningUnit(ALICE), trashAt: 'now' });
    });

    await assertSucceeds(getDoc(doc(bob, `${TRASH}/${ALICE_UNIT}`)));
    await assertSucceeds(deleteDoc(doc(bob, `${TRASH}/${ALICE_UNIT}`)));
  });

  it('denies UPDATE, so nothing can be edited while it sits in the trash', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), `${TRASH}/${ALICE_UNIT}`),
        { ...learningUnit(ALICE), trashAt: 'now' });
    });

    await assertFails(
      updateDoc(doc(alice, `${TRASH}/${ALICE_UNIT}`), { learningUnitName: 'Edited' })
    );
  });

  it('allows an unfiltered list and an owner-filtered one', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(getDocs(collection(alice, TRASH)));
    await assertSucceeds(
      getDocs(query(collection(alice, TRASH), where('ownerId', '==', ALICE)))
    );
  });

  /**
   * All four trashes pin both segments precisely so an invented container, or
   * another collection's trash name, cannot open an unaudited tree.
   */
  it('refuses an invented container, and another collection\'s trash name', async () => {
    await testEnv.clearFirestore();
    await assertFails(
      setDoc(doc(alice, 'learningUnits/anything/DeletedLearningUnits/x'), learningUnit(ALICE))
    );
    await assertFails(
      setDoc(doc(alice, 'learningUnits/trash/DeletedProgrammes/x'), learningUnit(ALICE))
    );
  });
});


describe('everything outside this app is denied', () => {
  it('denies a wrapper collection, which does not exist', async () => {
    await testEnv.clearFirestore();
    await assertFails(setDoc(doc(alice, 'Institutions/anything'), { ownerId: ALICE }));
  });

  it('denies an invented container beside trash', async () => {
    await testEnv.clearFirestore();
    await assertFails(
      setDoc(doc(alice, 'institutions/hacked/DeletedInstitutes/x'), { ownerId: ALICE })
    );
  });

  // The subcollection was renamed from institutions_trash to DeletedInstitutes.
  // The rule pins the segment, so the old path is no longer matched by anything
  // and falls through to the catch-all deny. Asserting it keeps a half-finished
  // rename from passing: if the rules still carried the old name, this passes
  // only because the new name was added, and the test above would catch that.
  it('denies the OLD institutions_trash path after the rename', async () => {
    await testEnv.clearFirestore();
    await assertFails(
      setDoc(doc(alice, 'institutions/trash/institutions_trash/x'), { ownerId: ALICE })
    );
  });

  it('denies an invented subcollection under trash', async () => {
    await testEnv.clearFirestore();
    await assertFails(setDoc(doc(alice, 'institutions/trash/hacked/x'), { ownerId: ALICE }));
  });

  it('refuses to create an institution with the reserved id `trash`', async () => {
    await testEnv.clearFirestore();
    await assertFails(setDoc(doc(alice, 'institutions/trash'), institution(ALICE)));
  });

  /**
   * READABLE NOW, and the reason matters.
   *
   * It used to be unreadable for free: the sentinel carries no ownerId, so every
   * ownership check failed on it. Reads no longer look at ownerId. Restoring the
   * deny means testing the document id in the read rule, which makes an unfiltered
   * LIST unprovable and stops the dashboard loading, so the trade was taken
   * knowingly.
   *
   * It discloses nothing in practice: NOTHING IN THIS APP EVER WRITES FIELDS to the
   * container. The five trashDoc() helpers are only ever used as a parent path for
   * the DeletedX subcollection, and Firestore permits a subcollection under a
   * document that does not exist. The `{ note }` below is written by this test and
   * by nothing else, which is exactly what makes it a fair check of the rule rather
   * than of the app.
   */
  it('allows reading the trash container, which the app never puts fields in', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'institutions/trash'), { note: 'container' });
    });
    await assertSucceeds(getDoc(doc(alice, 'institutions/trash')));
  });

  it('denies a collection this app does not own', async () => {
    await testEnv.clearFirestore();
    await assertFails(setDoc(doc(alice, 'anything_else/x'), { ownerId: ALICE }));
  });

  it("denies another user's profile path", async () => {
    await testEnv.clearFirestore();
    await assertFails(setDoc(doc(alice, 'users/somebody-else'), { name: 'x' }));
  });

  it('denies a bare document in the Institutions collection', async () => {
    await testEnv.clearFirestore();
    await assertFails(setDoc(doc(alice, 'not_a_collection/loose'), { ownerId: ALICE }));
  });
});

describe('teachers — ownership by ownerId field', () => {

  it('lets the owner read their own teacher', async () => {
    await seed();
    await assertSucceeds(getDoc(doc(alice, `teachers/${ALICE_TEACHER}`)));
  });

  /**
   * SHARED READS, changed on instruction: active content is visible to anyone who
   * is authenticated, whichever route they used. Bob does not own this row and can
   * read it.
   */
  it('lets another authenticated user read a teacher owned by Alice', async () => {
    await seed();
    await assertSucceeds(getDoc(doc(bob, `teachers/${ALICE_TEACHER}`)));
  });

  /**
   * AUTHENTICATION ALONE IS THE BAR, on instruction: no users/{uid} check, no
   * role, no provider, no ownership. Carol holds a valid project token and has
   * never signed into Teacher Corner, and she can read active content.
   *
   * Worth seeing plainly in a test, because Firebase Auth is per-project: this is
   * every account in helix-staging-india, including the other apps sharing it.
   */
  it('lets any authenticated account read active teachers, Teacher Corner user or not', async () => {
    await seed();
    await assertSucceeds(getDoc(doc(carol, `teachers/${ALICE_TEACHER}`)));
    await assertSucceeds(getDocs(collection(carol, 'teachers')));
  });

  it('lets an admin register a teacher owned by themselves', async () => {
    await seed();
    await assertSucceeds(setDoc(doc(alice, 'teachers/new-1'), teacher(ALICE)));
  });

  it('lets any authenticated user registering one owned by someone else', async () => {
    await seed();
    await assertSucceeds(setDoc(doc(alice, 'teachers/new-2'), teacher(BOB)));
  });

  it('allows a create with no ownerId at all', async () => {
    await seed();
    const { ownerId, ...withoutOwner } = teacher(ALICE);
    await assertSucceeds(setDoc(doc(alice, 'teachers/new-3'), withoutOwner));
  });

  /**
   * `trash` is the container document for deleted teachers and sits in this same
   * collection. Creating a teacher with that id would overwrite the container.
   */
  it('refuses the reserved trash id, even for the owner', async () => {
    await seed();
    await assertFails(setDoc(doc(alice, 'teachers/trash'), teacher(ALICE)));
  });

  it('lets the owner update their own row', async () => {
    await seed();
    await assertSucceeds(
      updateDoc(doc(alice, `teachers/${ALICE_TEACHER}`), { role: 'ThinkTac Coach' })
    );
  });

  it('lets Bob updating a row owned by Alice', async () => {
    await seed();
    await assertSucceeds(
      updateDoc(doc(bob, `teachers/${ALICE_TEACHER}`), { role: 'ThinkTac Coach' })
    );
  });

  it('allows handing ownership to someone else', async () => {
    await seed();
    await assertSucceeds(
      updateDoc(doc(alice, `teachers/${ALICE_TEACHER}`), { ownerId: BOB })
    );
  });

  it('lets Bob seizing ownership of Alice\'s row', async () => {
    await seed();
    await assertSucceeds(
      updateDoc(doc(bob, `teachers/${ALICE_TEACHER}`), { ownerId: BOB })
    );
  });

  it('lets any authenticated user delete any row', async () => {
    await seed();
    // The FAIL case first, while the document still exists — otherwise it would
    // be denied for being missing rather than for being someone else's, which is
    // not the rule under test.
    await assertSucceeds(deleteDoc(doc(bob, `teachers/${ALICE_TEACHER}`)));
    await assertSucceeds(deleteDoc(doc(alice, `teachers/${ALICE_TEACHER}`)));
  });

  it('allows an unfiltered list, so the dashboard can enumerate the collection', async () => {
    await seed();
    await assertSucceeds(getDocs(collection(alice, 'teachers')));
  });

  it('allows a list filtered to the caller\'s own rows', async () => {
    await seed();
    await assertSucceeds(
      getDocs(query(collection(alice, 'teachers'), where('ownerId', '==', ALICE)))
    );
  });

  it('allows a list filtered to another user\'s rows', async () => {
    await seed();
    await assertSucceeds(
      getDocs(query(collection(alice, 'teachers'), where('ownerId', '==', BOB)))
    );
  });

  it('denies a signed-out client entirely', async () => {
    await seed();
    await assertFails(getDoc(doc(anon, `teachers/${ALICE_TEACHER}`)));
    await assertFails(setDoc(doc(anon, 'teachers/new-4'), teacher(ALICE)));
  });
});

describe('teachers — the trash round trip', () => {

  const trashPath = id => `teachers/trash/DeletedTeachers/${id}`;

  /** A DELETE is a create in the trash; a RESTORE is a delete from it. */
  it('lets the owner move their own teacher into the trash', async () => {
    await seed();
    await assertSucceeds(
      setDoc(doc(alice, trashPath(ALICE_TEACHER)), { ...teacher(ALICE), trashAt: 'now' })
    );
  });

  it('lets Bob put Alice\'s teacher in the trash under his own name', async () => {
    await seed();
    await assertSucceeds(
      setDoc(doc(bob, trashPath(ALICE_TEACHER)), { ...teacher(ALICE), trashAt: 'now' })
    );
  });

  it('lets the owner read and then restore their own trashed teacher', async () => {
    await seed();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), trashPath(ALICE_TEACHER)), {
        ...teacher(ALICE), trashAt: 'now'
      });
    });

    await assertSucceeds(getDoc(doc(alice, trashPath(ALICE_TEACHER))));
    await assertSucceeds(deleteDoc(doc(alice, trashPath(ALICE_TEACHER))));
  });

  it('lets Bob read and purge Alice\'s trash', async () => {
    await seed();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), trashPath(ALICE_TEACHER)), {
        ...teacher(ALICE), trashAt: 'now'
      });
    });

    await assertSucceeds(getDoc(doc(bob, trashPath(ALICE_TEACHER))));
    await assertSucceeds(deleteDoc(doc(bob, trashPath(ALICE_TEACHER))));
  });

  /** Nothing legitimately edits a document while it is in the trash. */
  it('refuses an update to a trashed teacher, even by its owner', async () => {
    await seed();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), trashPath(ALICE_TEACHER)), {
        ...teacher(ALICE), trashAt: 'now'
      });
    });

    await assertFails(
      updateDoc(doc(alice, trashPath(ALICE_TEACHER)), { role: 'ThinkTac Coach' })
    );
  });

  /**
   * Both path segments are PINNED, so an invented tree gets no rule and falls to
   * the catch-all deny.
   */
  it('denies an invented trash tree', async () => {
    await seed();
    await assertFails(
      setDoc(doc(alice, 'teachers/anything/DeletedTeachers/x'), teacher(ALICE))
    );
  });

  /**
   * READABLE NOW, and deliberately so.
   *
   * While reads were owner-scoped this was unreadable for free: the sentinel
   * carries no ownerId, so every ownership check failed on it. Shared reads do not
   * look at ownerId, and the exclusion that would restore it — testing the document
   * id in the read rule — makes an unfiltered LIST unprovable and stops the
   * dashboard loading at all. The trade was taken knowingly: this document is an
   * empty container with no fields, so reading it discloses nothing. Its EMPTINESS
   * is what the assertion checks, since that is the property doing the work.
   */
  it('exposes nothing through the readable trash container document', async () => {
    await seed();

    const snapshot = await assertSucceeds(getDoc(doc(alice, 'teachers/trash')));
    assert.equal(snapshot.exists(), false);
  });

  it('denies a signed-out client entirely', async () => {
    await seed();
    await assertFails(getDoc(doc(anon, trashPath(ALICE_TEACHER))));
  });
});

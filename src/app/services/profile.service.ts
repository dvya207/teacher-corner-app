import { Injectable, inject } from '@angular/core';
import {
  Timestamp,
  deleteField,
  getDoc,
  increment,
  onSnapshot,
  serverTimestamp,
  setDoc
} from 'firebase/firestore';

import { userProfileDoc } from '../core/firestore-paths';
import { toSubscriberDigits } from '../data/institution-options';
import { TeacherProfile } from '../models/teaching.model';
import { AuthService, FALLBACK_DISPLAY_NAME } from './auth.service';
import { TeacherService } from './teacher.service';

/**
 * Old request keys that an incoming resolved request supersedes.
 *
 * Exported and tested directly: this DELETES data, so the rule that decides what
 * goes has to be visible rather than inlined in a write.
 */
export function supersededRequestKeys(
  stored: NonNullable<TeacherProfile['selfRegTeacherApproval']>,
  incoming: NonNullable<TeacherProfile['selfRegTeacherApproval']>
): string[] {
  const resolved = Object.values(incoming).filter(request => request.classroomId);

  return Object.entries(stored)
    .filter(([key, request]) =>
      !request.classroomId &&
      !(key in incoming) &&
      resolved.some(
        other => other.grade === request.grade && other.section === request.section
      )
    )
    .map(([key]) => key);
}

/**
 * Whether the name stored on a profile is a real one.
 *
 * Exported and tested directly, for the reason supersededRequestKeys above is:
 * this decides whether the administrator's record gets to supply an identity,
 * and a rule that picks between two sources of a person's name should be visible
 * rather than inlined in a sign-in path.
 *
 * THE PLACEHOLDER IS NOT A NAME. Accounts that signed in while the seed still
 * wrote `displayName()` are carrying the literal 'Teacher' in firstName, which
 * is indistinguishable from a real name by a truthiness check and is why those
 * accounts stayed greeted as 'Teacher' with a users/{uid} document that looked
 * correctly filled in.
 */
export function isUsableProfileName(firstName: string | undefined): boolean {
  const trimmed = (firstName ?? '').trim();

  return trimmed !== '' && trimmed !== FALLBACK_DISPLAY_NAME;
}

@Injectable({
  providedIn: 'root'
})
export class ProfileService {

  private auth = inject(AuthService);
  private teachers = inject(TeacherService);

  /**
   * The teacher's profile document, or a draft seeded from their auth record.
   *
   * A first-time user has no document yet. Rather than return null and make
   * every caller handle it, this falls back to what Firebase Auth already knows
   * — display name, email, phone — so the form opens populated instead of blank.
   */
  async load(): Promise<TeacherProfile> {
    const uid = this.auth.requireUid();
    const snapshot = await getDoc(userProfileDoc(uid));

    if (snapshot.exists()) {
      return { ...(snapshot.data() as TeacherProfile), uid };
    }

    const [first = '', ...rest] = this.auth.displayName().split(/\s+/);
    const now = Timestamp.now();

    return {
      uid,
      firstName: first,
      lastName: rest.join(' '),
      email: this.auth.currentUser?.email ?? '',
      phone: this.auth.currentUser?.phoneNumber ?? '',
      role: this.auth.role(),
      createdAt: now,
      updatedAt: now
    };
  }

  /**
   * Writes the profile to users/{uid}.
   *
   * The uid is the DOCUMENT ID, so ownership is the path and the security rule
   * is a single comparison — a teacher cannot write to anyone else's profile
   * even by editing the payload, because the path itself is checked.
   *
   * merge:true so a field added elsewhere in this document is not wiped by a
   * form that predates it.
   *
   * TIMESTAMPS. `updatedAt` moves on every save. `createdAt` is written ONLY
   * when the document does not yet exist — an earlier version set it on every
   * save, which quietly pushed the creation date forward each time the profile
   * was edited, so it recorded the last edit rather than the first.
   *
   * serverTimestamp() rather than new Date(): the client clock can be wrong or
   * deliberately set, and these are the fields someone reads to answer "when
   * did this change".
   */
  async save(profile: Omit<TeacherProfile, 'uid' | 'createdAt' | 'updatedAt' | 'role'>): Promise<void> {
    const uid = this.auth.requireUid();
    const reference = userProfileDoc(uid);

    const existing = await getDoc(reference);

    /*
     * LEGACY REQUEST KEYS ARE CLEARED IN THE SAME WRITE.
     *
     * Requests used to be keyed grade-section when no classroom could be
     * resolved, and this write is merge:true — so an old `9-A` entry survived
     * every subsequent save and the document ended up carrying both it and the
     * properly keyed one for the same class.
     *
     * Identified by an EMPTY classroomId, never by the shape of the key, and only
     * dropped when a resolved entry covers the same grade and section.
     */
    const stale = supersededRequestKeys(
      (existing.data() as TeacherProfile | undefined)?.selfRegTeacherApproval ?? {},
      profile.selfRegTeacherApproval ?? {}
    );

    await setDoc(
      reference,
      {
        ...profile,
        ...(stale.length
          ? {
              selfRegTeacherApproval: {
                ...(profile.selfRegTeacherApproval ?? {}),
                ...Object.fromEntries(stale.map(key => [key, deleteField()]))
              }
            }
          : {}),
        uid,
        docId: uid,
        role: this.auth.role(),
        // Production's field. This app registers phone sign-ins only — the gate
        // never asks a Google account to register — so the source is always the
        // OTP provider.
        registeredFrom: 'EXOTEL',
        updatedAt: serverTimestamp(),
        // Only on first write. Spread of an empty object is a no-op otherwise.
        ...(existing.exists() ? {} : { createdAt: serverTimestamp(), registeredAt: serverTimestamp() })
      },
      { merge: true }
    );

    /*
     * KEEP THE AUTH RECORD IN STEP WITH THE EDIT.
     *
     * users/{uid} is the source of truth, but the greeting, the topbar and the
     * avatar initials all read `auth.currentUser.displayName` — a cache of this
     * one field, so they can stay synchronous instead of each fetching the
     * profile. Saving a new name here without updating that cache left every one
     * of them showing the old name until a full reload.
     *
     * AFTER the Firestore write, so the cache never leads the record. Best
     * effort inside setDisplayName, which logs and swallows: a refused update
     * costs a stale greeting, and must not fail a save that already succeeded.
     */
    await this.auth.setDisplayName(profile.firstName, profile.lastName ?? '');
  }


  /**
   * Records the signed-in teacher in users/{uid}.
   *
   * CALLED ON EVERY SUCCESSFUL SIGN-IN, so the collection holds a document for
   * everyone who has ever signed in rather than only those who opened the profile
   * form and saved it.
   *
   * IDENTITY COMES FROM THE AUTH RECORD, never from a form or an argument: uid,
   * email, display name and provider are all read off the Firebase user. A caller
   * cannot write a document for somebody else — the uid is the document id, and
   * the security rule compares it against the token.
   *
   * NO PASSWORD IS WRITTEN. Firebase Authentication holds credentials; this
   * document holds identity and bookkeeping only.
   *
   * merge:true, and createdAt only on first write, so this never disturbs a
   * profile the teacher has filled in themselves.
   */
  /**
   * Where a signed-in teacher is allowed to be, in one read.
   *
   *   'register' — no profile yet, or Create Account not submitted
   *   'approval' — registered, waiting for an administrator to approve them
   *   null       — cleared, the app is theirs
   *
   * ONE METHOD AND ONE READ, rather than a guard per question. Two guards each
   * fetching users/{uid} would double the reads on every navigation into the shell
   * and could disagree with each other between the two fetches.
   *
   * PHONE SIGN-INS ONLY. Google accounts are never gated: they arrive with a name
   * and an email, and there is nothing on the registration form they have not
   * either supplied or can set later from /profile.
   *
   * FAILS OPEN. A refused read or a dropped network returns null, letting the
   * teacher through, because the wrong outcome here is somebody locked out of an
   * app they are entitled to use. The rules still decide what they can actually
   * read once inside.
   */
  async gate(): Promise<'register' | 'approval' | null> {
    const uid = this.auth.currentUid();

    // currentUid(), not requireUid(): Angular evaluates guards for signed-out
    // visitors too, and requireUid() throws there.
    if (!uid || !this.auth.signedInWithPhone()) {
      return null;
    }

    try {
      const snapshot = await getDoc(userProfileDoc(uid));

      if (!snapshot.exists()) {
        // No profile at all. An administrator may still have registered them, so
        // that is checked before sending them to a form.
        return (await this.registeredByAdmin()) ? null : 'register';
      }

      const profile = snapshot.data() as TeacherProfile;
      const requests = Object.values(profile.selfRegTeacherApproval ?? {});

      /*
       * THE REQUEST IS WHAT SAYS THE FORM WAS SUBMITTED, not profileComplete.
       *
       * The teaching details are no longer written at registration — they are
       * held on the request and promoted once it is granted — so profileComplete
       * is absent for a teacher who is waiting. Reading it here would send them
       * back to a form they have already filled in.
       */
      if (requests.length === 0) {
        // LEGACY, and it has to stay: documents written before the two-phase
        // split carry profileComplete and ApprovedStatus and no request at all.
        if (profile.profileComplete === true) {
          if (profile.ApprovedStatus === true) {
            return null;
          }

          return (await this.registeredByAdmin()) ? null : 'approval';
        }

        return (await this.registeredByAdmin()) ? null : 'register';
      }

      if (!requests.some(request => request.approvalStatus === true)) {
        return (await this.registeredByAdmin()) ? null : 'approval';
      }

      /*
       * APPROVED. The details are promoted HERE rather than only on the waiting
       * page, because an admin can grant a request while nobody is watching — the
       * teacher may have closed the tab days earlier. Doing it on the way in makes
       * the promotion happen exactly once, whenever they next arrive.
       */
      if (profile.profileComplete !== true) {
        await this.promoteApproved(uid, profile);
      }

      return null;
    } catch (error) {
      console.error('Could not read the profile to decide where to route.', error);
      return null;
    }
  }

  /**
   * Whether an administrator already registered this person in `teachers`.
   *
   * BEING IN THAT COLLECTION IS THE APPROVAL. Someone put the record there
   * deliberately, with a school and a class on it, so asking that person to fill
   * in a self-registration form and then wait in an approval queue is asking
   * them to apply for what they have already been granted. A teacher added in the
   * Setup Wizard should sign in and land on the dashboard.
   *
   * CALLED ONLY WHEN THE PROFILE WOULD OTHERWISE TURN THEM AWAY, which is why
   * the calls are scattered through [gate] rather than hoisted to the top of it.
   * gate() runs on every navigation into the shell and its one-read promise is
   * worth keeping: a teacher who is already through pays nothing for this.
   *
   * MATCHES ON UID **OR** NUMBER. `linkSignedInUid` stamps the uid, but it runs
   * after the session exists and this can run before it, so on a first sign-in
   * there is nothing stamped yet. The number is what the administrator typed.
   *
   * FAILS CLOSED, unlike the rest of gate(). A refused or failed read returns
   * false, so the teacher goes to the form rather than being waved through on a
   * lookup that did not answer. gate() as a whole still fails OPEN on a thrown
   * error, which is the right default for a profile read; this one narrow check
   * is the exception, because it is the thing granting access rather than
   * describing it.
   */
  private async registeredByAdmin(): Promise<boolean> {
    try {
      const uid = this.auth.currentUid() ?? '';
      const digits = (this.auth.currentUser?.phoneNumber ?? '')
        .replace(/\D/g, '')
        .slice(-10);

      if (!uid && digits.length < 10) {
        return false;
      }

      return await this.teachers.isRegisteredTeacher(
        uid,
        digits.length === 10 ? digits : ''
      );
    } catch (error) {
      console.error('Could not check whether a teacher record exists.', error);
      return false;
    }
  }

  /**
   * Writes the teaching details a granted request was holding.
   *
   * WHY THIS EXISTS AT ALL. Registration stores only who the teacher is and what
   * they asked for; the school, class and programme land on the profile only once
   * an administrator has granted it. So the request carries them in the meantime
   * and this is what moves them across.
   *
   * THE FIRST GRANTED REQUEST WINS. A teacher can only have one current class on
   * their profile, and granting two is an administrative decision this app cannot
   * resolve — so it takes the first granted one and leaves the rest on the
   * document to be seen.
   *
   * merge:true, and profileComplete is written LAST in the same write, so a
   * failure leaves the profile un-promoted and this runs again next time rather
   * than leaving it half-written.
   */
  private async promoteApproved(uid: string, profile: TeacherProfile): Promise<void> {
    const granted = Object.values(profile.selfRegTeacherApproval ?? {})
      .find(request => request.approvalStatus === true);

    if (!granted) {
      return;
    }

    await setDoc(
      userProfileDoc(uid),
      {
        institutionId: granted.institutionId ?? '',
        institutionName: granted.institutionName ?? '',
        grade: granted.grade ?? '',
        section: granted.section ?? '',
        programmeId: granted.programmeId ?? '',
        programmeName: granted.programmeName ?? '',
        currentClassInfo: {
          institutionId: granted.institutionId ?? '',
          institutionName: granted.institutionName ?? '',
          classroomName: granted.classroomName ?? '',
          programmeId: granted.programmeId ?? '',
          programmeName: granted.programmeName ?? ''
        },
        // Approved AND promoted. The guards read this to mean "the shell may open".
        profileComplete: true,
        ApprovedStatus: true,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }

  watchApproval(onApproved: () => void): () => void {
    const uid = this.auth.currentUid();

    if (!uid) {
      // Nothing to watch. A no-op unsubscribe so the caller needs no special case.
      return () => undefined;
    }

    return onSnapshot(
      userProfileDoc(uid),
      snapshot => {
        const profile = snapshot.data() as TeacherProfile | undefined;

        const granted = Object.values(profile?.selfRegTeacherApproval ?? {})
          .some(request => request.approvalStatus === true);

        // Legacy documents carry the flag and no request; both count as approved.
        if (granted || profile?.ApprovedStatus === true) {
          onApproved();
        }
      },
      error => {
        // The page still works without this; it just stops updating by itself, which
        // is why the copy no longer claims a refresh is unnecessary if this fails.
        console.error('Stopped watching for approval.', error);
      }
    );
  }

  async recordSignIn(): Promise<void> {
    const user = this.auth.currentUser;

    if (!user) {
      return;
    }

    const reference = userProfileDoc(user.uid);
    const existing = await getDoc(reference);

    // Seeded from the auth record ONLY on first write, so a teacher who has since
    // edited their name in the profile form does not have it overwritten on every
    // sign-in by whatever the provider reports.
    const seed = existing.exists()
      ? {}
      : (() => {
          // storedDisplayName, NOT displayName: the latter substitutes the
          // 'Teacher' placeholder when nothing is known, and this line persists
          // its result as a first name. A phone-only account has no display name
          // on the auth record at this point, so seeding from displayName() wrote
          // the placeholder into users/{uid}.firstName where it then read as a
          // real name to everything downstream. Blank is the honest value, and
          // the backfill below is what fills it.
          const [first = '', ...rest] = this.auth.storedDisplayName().split(/\s+/);
          return {
            firstName: first,
            lastName: rest.join(' '),
            phone: user.phoneNumber ?? '',
            createdAt: serverTimestamp(),
            // First write only, matching production: this records when the account
            // began, so a later profile edit cannot push the date forward.
            registeredAt: serverTimestamp(),
            // 'EXOTEL' for the phone OTP route, the literal production writes for
            // its own OTP users; otherwise the Firebase provider id, so a Google
            // sign-up is not mislabelled as an SMS one.
            registeredFrom:
              user.providerData[0]?.providerId === 'phone'
                ? 'EXOTEL'
                : user.providerData[0]?.providerId ?? 'unknown'
          };
        })();

    await setDoc(
      reference,
      {
        ...seed,
        uid: user.uid,
        // Mirrors of the document id, as production keeps them. Written on every
        // save rather than only the first, so documents that predate this gain them.
        docId: user.uid,
        id: user.uid,
        // Kept in step with the auth record, because this is the address they
        // actually sign in with and it is what a uid is looked up by.
        email: user.email ?? '',
        // Dial code held apart from the subscriber digits, as production does.
        // Derived from the E.164 number rather than from a form, because this runs
        // on every sign-in including ones with no form involved. Empty for a Google
        // account with no phone attached, which is correct rather than a gap.
        countryCode: user.phoneNumber?.startsWith('+91') ? '+91' : '',
        role: this.auth.role(),
        lastSignInAt: serverTimestamp(),
        lastSignInProvider: user.providerData[0]?.providerId ?? 'password',
        signInCount: increment(1),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    // BACKFILL. Anyone who registered before setDisplayName() existed has their name
    // in users/{uid} and nothing on the auth record, so the topbar greets them as
    // 'Teacher' forever. Runs only when the record is actually empty, so it is a
    // one-off per account rather than a write on every sign-in.
    //
    // After the setDoc above, deliberately: the seed may have just written the name
    // on a first sign-in.
    if (!user.displayName) {
      const saved = (await getDoc(reference)).data() as TeacherProfile | undefined;
      if (isUsableProfileName(saved?.firstName)) {
        await this.auth.setDisplayName(
          (saved?.firstName ?? '').trim(),
          saved?.lastName ?? ''
        );
        return;
      }

      /*
       * SECOND SOURCE: the record an administrator registered them from.
       *
       * A teacher added through the Set Up Wizard never fills in the profile
       * form, so the first backfill has nothing to work with and they were
       * greeted as 'Teacher' indefinitely. The administrator typed their name
       * into `teachers` when they registered them, which is a perfectly good
       * name and the one they are known by at their school.
       *
       * ONLY WHEN NOTHING IS KNOWN YET, deliberately. This does not run when the
       * profile carries a real name, so a teacher who edits their own name keeps
       * it rather than having it reverted to the administrator's spelling on
       * every sign-in. The two sources are known to disagree in live data, and
       * the person's own edit is the one that should survive.
       *
       * Written through to users/{uid} as well as the auth record, so the name
       * persists as theirs: the profile form opens populated, and this lookup
       * does not repeat on every subsequent sign-in.
       */
      const registered = await this.teachers.registeredName(
        user.uid,
        toSubscriberDigits(user.phoneNumber ?? '')
      );

      if (registered) {
        await this.auth.setDisplayName(registered.firstName, registered.lastName);
        await setDoc(
          reference,
          {
            firstName: registered.firstName,
            lastName: registered.lastName,
            updatedAt: serverTimestamp()
          },
          { merge: true }
        );
      }
    }
  }

  describeError(error: unknown, fallback: string): string {
    const code = (error as { code?: string })?.code ?? '';

    if (code === 'permission-denied') {
      return 'Not authorised to save your profile.';
    }

    if (code === 'unavailable') {
      return 'Could not reach the database. Check your connection and retry.';
    }

    return fallback;
  }
}

import { Injectable, inject } from '@angular/core';
import {
  Timestamp,
  getDoc,
  increment,
  onSnapshot,
  serverTimestamp,
  setDoc
} from 'firebase/firestore';

import { userProfileDoc } from '../core/firestore-paths';
import { TeacherProfile } from '../models/teaching.model';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root'
})
export class ProfileService {

  private auth = inject(AuthService);

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

    await setDoc(
      reference,
      {
        ...profile,
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
        return 'register';
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
          return profile.ApprovedStatus === true ? null : 'approval';
        }

        return 'register';
      }

      if (!requests.some(request => request.approvalStatus === true)) {
        return 'approval';
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
          const [first = '', ...rest] = this.auth.displayName().split(/\s+/);
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

      if (saved?.firstName) {
        await this.auth.setDisplayName(saved.firstName, saved.lastName ?? '');
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

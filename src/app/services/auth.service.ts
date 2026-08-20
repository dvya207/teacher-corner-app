import { Injectable, inject, Injector } from '@angular/core';
import {
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
  signInWithCustomToken,
  updateProfile,
  signInWithPopup,
  signOut
} from 'firebase/auth';

import { auth } from '../core/firebase';

/**
 * Roles the app knows about. Only 'Teacher' is reachable today — the sign-in
 * page is the teacher entry point — but the union exists so the topbar and any
 * future route guard have something typed to compare against rather than a
 * bare string.
 */
export type UserRole = 'Teacher' | 'Admin';

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  /**
   * Injector rather than the service itself: ProfileService injects AuthService,
   * so asking for it directly here would be a cycle. Resolved at call time, after
   * both exist.
   */
  private injector = inject(Injector);

  get currentUser(): User | null {
    return auth.currentUser;
  }

  /**
   * Resolves once Firebase has finished restoring any persisted session.
   *
   * Reading auth.currentUser synchronously on startup returns null even for a
   * signed-in user, because the session is rehydrated asynchronously. The route
   * guard awaits this instead of guessing, so a page refresh cannot bounce a
   * signed-in teacher back to /login.
   */
  ready(): Promise<User | null> {
    return new Promise(resolve => {
      const unsubscribe = onAuthStateChanged(auth, user => {
        unsubscribe();
        resolve(user);
      });
    });
  }

  /**
   * The uid every Firestore path in this app is keyed on. Throws rather than
   * returning null so a bug in the guard can never silently read or write
   * against the wrong user's subtree.
   */
  requireUid(): string {
    const uid = auth.currentUser?.uid;

    if (!uid) {
      throw new Error('No signed-in user. Sign in before reading teacher data.');
    }

    return uid;
  }

  /**
   * The uid, or null when signed out.
   *
   * requireUid() above THROWS, which is right for the data paths: a read against
   * the wrong subtree is a bug that should be loud. This is for the one caller
   * that must stay quiet instead — the notification feed, which is furniture and
   * must not throw from a topbar that renders before the session is known.
   */
  currentUid(): string | null {
    return auth.currentUser?.uid ?? null;
  }

  /**
   * Whether this session was established with a phone number.
   *
   * Reads providerData rather than lastSignInProvider off the profile document,
   * so it answers for the CURRENT session and needs no Firestore read. `.some`
   * rather than `providerData[0]`, because the order is not guaranteed once an
   * account has more than one provider linked.
   */
  signedInWithPhone(): boolean {
    return (auth.currentUser?.providerData ?? []).some(
      provider => provider.providerId === 'phone'
    );
  }

  /**
   * Writes the teacher's name onto the Firebase Auth record.
   *
   * WHY THE AUTH RECORD AND NOT JUST FIRESTORE. displayName() below reads
   * `auth.currentUser.displayName`, and so do initials() and every consumer of
   * them: the topbar, the avatar and the dashboard greeting. A phone sign-in has no
   * displayName and no email, so all of them fell through to the literal 'Teacher'
   * even though users/{uid} held the real name all along.
   *
   * Putting it here rather than teaching each of those to read Firestore keeps them
   * synchronous. The alternative is an async profile fetch in the topbar, which
   * renders before the session is even known.
   *
   * users/{uid} stays the source of truth; this is a cache of one field on the
   * record that the SDK already hands to every component for free.
   *
   * NEVER FAILS A CALLER. A refused update leaves the greeting reading 'Teacher',
   * which is cosmetic, and must not undo a registration that otherwise succeeded.
   */
  async setDisplayName(firstName: string, lastName: string): Promise<void> {
    const user = auth.currentUser;
    const name = `${firstName} ${lastName}`.trim();

    if (!user || !name) {
      return;
    }

    try {
      await updateProfile(user, { displayName: name });
    } catch (error) {
      console.error('Could not write the display name to the auth record.', error);
    }
  }

  displayName(): string {
    const user = auth.currentUser;
    return user?.displayName || user?.email?.split('@')[0] || 'Teacher';
  }

  /**
   * What the user signed in WITH, for the "Signed in as …" line.
   *
   * Email or phone rather than the display name, deliberately: the point of
   * that line is to disambiguate which account is active when someone has more
   * than one, and two accounts can easily share a display name.
   */
  identity(): string {
    const user = auth.currentUser;
    return user?.email || user?.phoneNumber || 'Unknown account';
  }

  /**
   * Initials for the topbar avatar. Two letters from a two-word name, otherwise
   * the first two characters, so the circle is never empty or overfull.
   */
  initials(): string {
    const parts = this.displayName().trim().split(/\s+/).filter(Boolean);

    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }

    return (parts[0] ?? 'T').slice(0, 2).toUpperCase();
  }

  /**
   * The signed-in user's role.
   *
   * Hardcoded for now, and deliberately behind a method so the eventual real
   * implementation — a custom claim on the ID token, or a lookup against a
   * teachers collection — is a change to this one body and nothing else. The
   * topbar already renders whatever this returns.
   */
  role(): UserRole {
    return 'Teacher';
  }

  /**
   * Google sign-in, now the SECONDARY route: the login page leads with the
   * mobile-number code and offers this under an "or". The email and password
   * form was removed on instruction, and `login(email, password)` went with it
   * rather than being left as a method nothing calls.
   *
   * A fresh provider per call is deliberate: GoogleAuthProvider accumulates
   * scopes and custom parameters, so reusing one instance lets state leak
   * between sign-in attempts.
   */
  async loginWithGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();

    // Always show the chooser. Without it, a browser holding exactly one
    // Google session signs that account straight back in, which makes
    // switching accounts impossible without clearing cookies.
    provider.setCustomParameters({ prompt: 'select_account' });

    await signInWithPopup(auth, provider);
    await this.recordSignIn();
  }

  /**
   * Exchange a server-minted custom token for a session. The phone route ends
   * here: the code was verified server-side and this is the result of that.
   *
   * Deliberately NOT a second place that decides whether sign-in is allowed. By
   * the time a token exists the server has already made that decision, so
   * anything this method rejected would be a token the server said was good.
   */
  async loginWithToken(token: string): Promise<void> {
    await signInWithCustomToken(auth, token);
    await this.recordSignIn();
  }

  /**
   * Records the teacher in users/{uid}, so that collection holds everyone who has
   * signed in rather than only those who saved a profile.
   *
   * NEVER FAILS A SIGN-IN. This is bookkeeping: if the write is refused or the
   * network drops, the teacher is already authenticated and must not be turned
   * away for it. The error is logged and swallowed deliberately.
   *
   * Called from each sign-in method rather than from an auth-state listener,
   * because a listener also fires on every page load and would write once per
   * reload rather than once per sign-in.
   */
  private async recordSignIn(): Promise<void> {
    try {
      // Imported here rather than at the top, so the profile service is only
      // pulled in when a sign-in actually succeeds.
      const { ProfileService } = await import('./profile.service');
      await this.injector.get(ProfileService).recordSignIn();
    } catch (error) {
      console.error('Could not record the sign-in in users/{uid}.', error);
    }
  }

  async logout(): Promise<void> {
    await signOut(auth);
  }

  /**
   * Errors from the OTP callables, which are shaped differently from auth's.
   *
   * A callable rejection carries the SERVER'S message, and for the throttles that
   * message is the only place the specifics live ("wait 43s", "daily limit
   * reached"). Replacing it with generic wording here would throw away the one
   * detail the teacher needs, so it is preferred wherever present and the
   * fallbacks below are only for when it is missing.
   */
  describeOtpError(error: unknown): string {
    const code = (error as { code?: string })?.code ?? '';
    const serverMessage = (error as { message?: string })?.message?.trim() ?? '';

    if (code === 'otp/not-provisioned') {
      return 'Sign in with your mobile number is not switched on yet. Use Google for now.';
    }

    switch (code) {
      case 'functions/resource-exhausted':
        return serverMessage || 'Too many attempts. Wait a moment and try again.';
      case 'functions/permission-denied':
        return serverMessage || 'That code is not correct.';
      case 'functions/failed-precondition':
        return serverMessage || 'That code has expired. Request a new one.';
      case 'functions/invalid-argument':
        return serverMessage || 'That does not look like a valid mobile number.';
      case 'functions/unavailable':
      case 'functions/deadline-exceeded':
        return 'Could not reach the server. Check your connection and retry.';
      case 'functions/internal':
        return 'The code could not be sent. Please try again in a moment.';
      default:
        return this.describeError(error);
    }
  }

  /**
   * Firebase auth errors arrive as { code, message } where the message is a
   * developer string ("Firebase: Error (auth/invalid-credential).") that should
   * never reach a user. Mapped here so every caller gets the same wording.
   */
  describeError(error: unknown): string {
    const code = (error as { code?: string })?.code ?? '';

    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'That email and password combination is not recognised.';
      case 'auth/invalid-email':
        return 'That does not look like a valid email address.';
      case 'auth/user-disabled':
        return 'This account has been disabled. Contact your administrator.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Wait a moment and try again.';
      case 'auth/network-request-failed':
        return 'Could not reach the server. Check your connection and retry.';
      case 'auth/popup-closed-by-user':
      case 'auth/cancelled-popup-request':
        return 'Google sign-in was cancelled.';
      case 'auth/popup-blocked':
        return 'Your browser blocked the Google sign-in popup. Allow popups and retry.';
      case 'auth/invalid-api-key':
      case 'auth/api-key-not-valid':
        return 'Firebase is not configured yet. See src/environments/environment.ts.';
      default:
        return 'Could not sign in. Please try again.';
    }
  }
}

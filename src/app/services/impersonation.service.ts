import { Injectable } from '@angular/core';
import { Functions, getFunctions, httpsCallable } from 'firebase/functions';

import { firebaseApp } from '../core/firebase';

/**
 * Digits in the admin passcode: DDMMYYYY.
 *
 * Exported because the page renders one box per digit and its test counts them,
 * so the length lives in one place rather than as an 8 in three files.
 */
export const PASSCODE_LENGTH = 8;

/**
 * Must match the function's own region, for the same reason OtpService pins it:
 * omit it and the SDK resolves to us-central1 and 404s.
 */
const REGION = 'asia-south1';

/**
 * DEPLOYED 2026-08-31. tcDevImpersonate is live in helix-staging-india,
 * asia-south1, codebase tcdev-otp, alongside tcDevSendOtp and tcDevVerifyOtp.
 *
 * Kept rather than deleted for the same reason OTP_BACKEND_DEPLOYED is: it is
 * the one switch that turns this route off without a deploy. A missing or broken
 * callable otherwise surfaces as an opaque `internal`, which reads as "the app
 * is broken" rather than "this is not switched on".
 */
const IMPERSONATION_BACKEND_DEPLOYED = true;

/** Thrown while the flag above is false, so the UI can explain itself. */
export const IMPERSONATION_NOT_PROVISIONED = 'impersonation/not-provisioned';

export interface ImpersonationResult {
  token: string;
  target: {
    uid: string;
    phoneNumber: string;
    displayName: string;
  };
}

@Injectable({ providedIn: 'root' })
export class ImpersonationService {

  private functions: Functions | null = null;

  get available(): boolean {
    return IMPERSONATION_BACKEND_DEPLOYED;
  }

  /*
   * THERE IS DELIBERATELY NO todaysPasscode() HERE.
   *
   * An earlier draft had one, to label the field with the date it wants. It was
   * removed: computing the expected value in the browser is the first half of
   * what makes production's gate decorative, and a helper that returns it is one
   * edit away from a component comparing against it. The page states the FORMAT
   * instead, and the only clock consulted is the server's — which also removes
   * the timezone disagreement a client-side date would reintroduce.
   */

  /**
   * Ask the server for a session on somebody else's account.
   *
   * REJECTS and does not swallow. Every refusal — not an admin, wrong passcode,
   * throttled, no such account, target is an admin — arrives as a callable error
   * whose message is the server's, and that message is the only place the reason
   * lives. A caller that caught and ignored would leave the form looking as
   * though nothing had happened.
   */
  async impersonate(
    countryCode: string,
    phoneNumber: string,
    password: string
  ): Promise<ImpersonationResult> {
    if (!this.available) {
      throw Object.assign(new Error('Impersonation is not switched on yet.'), {
        code: IMPERSONATION_NOT_PROVISIONED
      });
    }

    const call = httpsCallable<
      { countryCode: string; phoneNumber: string; password: string },
      ImpersonationResult & { success: boolean }
    >(this.resolve(), 'tcDevImpersonate');

    const result = await call({ countryCode, phoneNumber, password });
    const token = result.data?.token;

    if (!token) {
      throw new Error('The server authorised the request but returned no session token.');
    }

    return { token, target: result.data.target };
  }

  private resolve(): Functions {
    this.functions ??= getFunctions(firebaseApp, REGION);
    return this.functions;
  }
}

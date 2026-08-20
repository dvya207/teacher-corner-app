import { Injectable } from '@angular/core';
import { Functions, getFunctions, httpsCallable } from 'firebase/functions';

import { firebaseApp } from '../core/firebase';

/** Digits in the SMS code. Six, matching the DLT-registered template. */
export const OTP_CODE_LENGTH = 6;

/**
 * Seconds before the UI offers Resend again.
 *
 * A COURTESY, not the real limit. The server allows 3 sends per phone per
 * rolling 10 minutes and answers a fourth with resource-exhausted; there is no
 * per-send cooldown to mirror. This just stops a teacher hammering the button
 * through their three sends in as many seconds.
 */
export const OTP_RESEND_SECONDS = 60;

/**
 * FLIP THIS WHEN THE FUNCTIONS ARE DEPLOYED.
 *
 * DEPLOYED 2026-08-19. tcDevSendOtp and tcDevVerifyOtp are live in
 * helix-staging-india, asia-south1, codebase tcdev-otp, and both answer.
 *
 * Kept rather than deleted because it is the one switch that turns this route
 * off without a deploy: a missing or broken callable otherwise surfaces as an
 * opaque `internal`, which reads to a teacher as "the app is broken" rather than
 * "this route is not available".
 */
const OTP_BACKEND_DEPLOYED = true;

/**
 * Must match the functions' own region.
 *
 * Omit it and the SDK resolves to us-central1 and 404s, which is the documented
 * first mistake on the client side of this flow.
 */
const REGION = 'asia-south1';

/**
 * Substituted into the SMS template's {{platformName}}.
 *
 * Short and plain on purpose: a long or punctuation-heavy value can push the
 * message past a segment boundary or break the DLT template match. The server
 * validates and falls back regardless, so this is the agreed value rather than
 * the only line of defence.
 */
const PLATFORM_NAME = 'ThinkTac';

/** Thrown while OTP_BACKEND_DEPLOYED is false, so the UI can say why. */
export const OTP_NOT_PROVISIONED = 'otp/not-provisioned';

interface SendOtpResult {
  success: boolean;
  expiresInSeconds: number;
}

interface VerifyOtpResult {
  success: boolean;
  token: string;
}

@Injectable({ providedIn: 'root' })
export class OtpService {

  /**
   * Resolved lazily. Building the Functions instance for a visitor who signs in
   * with Google would cost them the Functions SDK for nothing.
   */
  private functions: Functions | null = null;

  /**
   * True once the callables are deployed.
   *
   * There is deliberately no emulator arm here. This app talks to
   * helix-staging-india and nothing else: an emulator branch in the client is a
   * branch that can be reached in a shipped bundle, and the whole point of a
   * single path is that there is nothing to reach. The emulator is still used to
   * exercise the FUNCTIONS directly (see the dev:emulators script), which needs
   * no client support.
   */
  get available(): boolean {
    return OTP_BACKEND_DEPLOYED;
  }

  /**
   * Ask the server to send a code.
   *
   * REJECTS on failure and does not swallow it. The send cap arrives as a
   * rejection, so a caller that catches and ignores would start a countdown for
   * an SMS that was never sent. Callers must await this before revealing the
   * code entry step.
   *
   * Takes the code and the national number separately because that is what the
   * form holds; the E.164 string the server wants is composed here so no caller
   * has to remember the format.
   */
  async requestOtp(countryCode: string, phoneNumber: string): Promise<number> {
    this.assertAvailable();

    const call = httpsCallable<{ phone: string; platformName: string }, SendOtpResult>(
      this.resolve(),
      'tcDevSendOtp'
    );

    const result = await call({
      phone: `${countryCode}${phoneNumber}`,
      platformName: PLATFORM_NAME
    });

    return result.data?.expiresInSeconds ?? 0;
  }

  /**
   * Verify the code and return the custom token to exchange for a session.
   *
   * The code is SENT, never compared here. A client-side comparison means the
   * browser has to hold the correct value, which is what made the previous
   * generation of this flow signable-into without ever receiving the SMS.
   */
  async verifyOtp(countryCode: string, phoneNumber: string, code: string): Promise<string> {
    this.assertAvailable();

    const call = httpsCallable<{ phone: string; otp: string }, VerifyOtpResult>(
      this.resolve(),
      'tcDevVerifyOtp'
    );

    const result = await call({ phone: `${countryCode}${phoneNumber}`, otp: code });
    const token = result.data?.token;

    if (!token) {
      throw new Error('The server accepted the code but returned no login token.');
    }

    return token;
  }

  private assertAvailable(): void {
    if (!this.available) {
      throw Object.assign(new Error('Phone sign-in is not provisioned yet.'), {
        code: OTP_NOT_PROVISIONED
      });
    }
  }

  private resolve(): Functions {
    this.functions ??= getFunctions(firebaseApp, REGION);
    return this.functions;
  }
}

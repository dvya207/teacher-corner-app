import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { ProfileService } from '../services/profile.service';

/**
 * Where a phone sign-in is sent before the app opens up.
 *
 * THREE STATES, ONE READ. ProfileService.gate() answers "register", "approval" or
 * null from a single fetch of users/{uid}; see it for why the questions are not
 * split across separate guards.
 *
 * These sit on routes rather than in the login page, which is the point: the login
 * page keeps navigating to /dashboard and knows nothing about registration or
 * approval, so the phone route, the Google route and a bookmark to a deep URL all
 * behave the same without three redirects to keep in step.
 */

/** Guards the shell: nothing inside it opens until the gate is clear. */
export const registrationGuard: CanActivateFn = async () => {

  const router = inject(Router);
  const gate = await inject(ProfileService).gate();

  if (gate === 'register') {
    return router.createUrlTree(['/register']);
  }

  if (gate === 'approval') {
    return router.createUrlTree(['/approval-page']);
  }

  return true;
};

/**
 * Guards /register: only somebody who still has the form to fill in.
 *
 * Without this the form stays reachable forever and offers to overwrite a finished
 * profile with a blank one. A teacher already waiting on approval is sent to the
 * waiting page, not back to a form they have completed.
 */
export const registrationCompleteGuard: CanActivateFn = async () => {

  const router = inject(Router);
  const gate = await inject(ProfileService).gate();

  if (gate === 'register') {
    return true;
  }

  return router.createUrlTree([gate === 'approval' ? '/approval-page' : '/dashboard']);
};

/**
 * Guards /approval-page: only somebody actually waiting.
 *
 * An approved teacher landing here would see a message about a request that has
 * already been granted, and one who has not registered would see it name a
 * classroom they never chose.
 */
export const approvalPendingGuard: CanActivateFn = async () => {

  const router = inject(Router);
  const gate = await inject(ProfileService).gate();

  if (gate === 'approval') {
    return true;
  }

  return router.createUrlTree([gate === 'register' ? '/register' : '/dashboard']);
};

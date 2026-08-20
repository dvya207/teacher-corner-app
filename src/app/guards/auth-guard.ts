import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

/**
 * Guards everything inside the app shell.
 *
 * Awaits Firebase's session rehydration before deciding. Checking
 * auth.currentUser synchronously would return null for a signed-in user on a
 * cold load and redirect them to /login on every refresh.
 */
export const authGuard: CanActivateFn = async () => {

  const router = inject(Router);
  const authService = inject(AuthService);

  const user = await authService.ready();

  if (user) {
    return true;
  }

  return router.createUrlTree(['/login']);
};

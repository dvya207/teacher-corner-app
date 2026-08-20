import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { Icon } from '../../components/icon/icon';
import { Logo } from '../../components/logo/logo';
import { AuthService } from '../../services/auth.service';

/**
 * Post-sign-out confirmation, with a countdown back to /login.
 *
 * NOT behind the auth guard, for the obvious reason: by the time anyone sees
 * it there is no session left to check.
 *
 * ZONELESS. The countdown is a signal — a plain field decremented inside a
 * setInterval callback notifies the change detection scheduler of nothing, so
 * the number would be written on the component and never repaint.
 */
@Component({
  selector: 'app-sign-out',
  imports: [Icon, Logo],
  templateUrl: './sign-out.html',
  styleUrl: './sign-out.css'
})
export class SignOut implements OnInit, OnDestroy {

  private static readonly COUNTDOWN_SECONDS = 5;

  readonly secondsLeft = signal(SignOut.COUNTDOWN_SECONDS);

  private auth = inject(AuthService);
  private router = inject(Router);

  private timer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {

    /**
     * Defensive sign-out for the direct-navigation case.
     *
     * The normal path is the shell, which signs out and only then routes here,
     * so currentUser is already null and this does nothing. But someone can
     * type /sign-out — or land on it from history — while still holding a
     * session, and a page that says "You've signed out" over a live session is
     * a lie the user has no way to detect.
     *
     * Not awaited: the countdown must not wait on the network, and every path
     * out of this page ends at /login where the guard is authoritative anyway.
     */
    if (this.auth.currentUser) {
      void this.auth.logout().catch(() => {
        // Nothing useful to show here. /login is where the guard decides, and
        // a still-valid session simply lands the user back in the app.
      });
    }

    this.timer = setInterval(() => {
      const next = this.secondsLeft() - 1;
      this.secondsLeft.set(next);

      if (next <= 0) {
        this.goToLogin();
      }
    }, 1000);
  }

  /**
   * Clears the interval on the way out. Without this the timer survives the
   * component and fires a navigation after the user has already gone
   * somewhere else, yanking them to /login from an unrelated page.
   */
  ngOnDestroy(): void {
    this.stopTimer();
  }

  /** The button. Skips the remaining wait rather than duplicating it. */
  goToLogin(): void {
    this.stopTimer();
    void this.router.navigate(['/login']);
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';

import { Logo } from '../../components/logo/logo';
import { AuthService } from '../../services/auth.service';

/**
 * The splash at '/'. Holds the screen while Firebase restores any persisted
 * session, then sends the user where they were always going.
 *
 * WHY THIS EXISTS rather than routing straight to the guard. Firebase restores
 * a session asynchronously, so on a cold load there is a window where the app
 * knows nothing about the user. Previously '/' went to the guarded shell and
 * that window was paid for as a blank screen of indeterminate length. This page
 * is what fills it, and the decision it makes is the same one the guard makes.
 *
 * NOT behind the guard, for the obvious reason: it runs before there is an
 * answer to guard on.
 */
@Component({
  selector: 'app-welcome',
  imports: [Logo],
  templateUrl: './welcome.html',
  styleUrl: './welcome.css'
})
export class Welcome implements OnInit {

  /**
   * Floor on how long the splash stays up, in ms.
   *
   * Session rehydration off a warm cache resolves in tens of milliseconds, so
   * without a floor this page would flash and vanish — read by the user as a
   * glitch rather than as a load. It is a floor and not a delay: a slow restore
   * takes as long as it takes, and this adds nothing to it.
   */
  private static readonly MIN_VISIBLE_MS = 1200;

  private auth = inject(AuthService);
  private router = inject(Router);

  async ngOnInit(): Promise<void> {

    const [user] = await Promise.all([
      this.auth.ready(),
      new Promise(resolve => setTimeout(resolve, Welcome.MIN_VISIBLE_MS))
    ]);

    // replaceUrl so the splash does not become a back-button destination. Going
    // back to it would re-run this and bounce the user forward again, trapping
    // them on whichever page they were trying to leave.
    await this.router.navigate([user ? '/dashboard' : '/login'], { replaceUrl: true });
  }
}

import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import { Icon } from '../../components/icon/icon';
import { DashboardCounts } from '../../models/teaching.model';
import { AuthService } from '../../services/auth.service';
import { DashboardService } from '../../services/dashboard.service';

/**
 * Dashboard — the welcome banner and its two headline counts.
 *
 * The four action tiles that used to sit under the banner (Programmes, Learning
 * Units, Assignments, Kit Manager) were removed on instruction, so the banner is
 * the page now and is sized to fill it rather than sitting as a strip above
 * empty space.
 *
 * ZONELESS. The counts arrive after an `await`, and a plain field assigned in a
 * promise continuation notifies the change detection scheduler of nothing — the
 * value would land on the component and never reach the DOM. Everything the
 * template reads that is written post-await is therefore a signal.
 */
@Component({
  selector: 'app-dashboard',
  imports: [DatePipe, RouterLink, Icon],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class Dashboard implements OnInit {

  private auth = inject(AuthService);
  private dashboard = inject(DashboardService);

  /**
   * Resolved once at construction. Safe as a plain field because authGuard has
   * already awaited session rehydration by the time this component exists.
   */
  readonly username = this.auth.displayName();

  /** Captured once rather than per render, so the DatePipe is not handed a new
      Date on every change detection pass. */
  readonly today = new Date();

  readonly counts = signal<DashboardCounts | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');

  async ngOnInit(): Promise<void> {
    try {
      this.counts.set(await this.dashboard.counts());
    } catch (error) {
      this.error.set(this.describe(error));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * permission-denied is called out specifically because it is the expected
   * failure while the rules for this app's collections are still undeployed,
   * and it is NOT the same as having no institutions. Collapsing it to a zero
   * would quietly show a wrong number that looks perfectly plausible.
   */
  private describe(error: unknown): string {
    const code = (error as { code?: string })?.code ?? '';

    if (code === 'permission-denied') {
      return 'Not authorised to read your data yet — the Firestore rules for ' +
             'this app have not been deployed.';
    }

    if (code === 'unavailable') {
      return 'Could not reach the database. Check your connection and reload.';
    }

    return 'Could not load your dashboard counts.';
  }
}

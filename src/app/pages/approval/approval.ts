import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { Logo } from '../../components/logo/logo';
import { TeacherProfile } from '../../models/teaching.model';
import { AuthService } from '../../services/auth.service';
import { ProfileService } from '../../services/profile.service';

/**
 * Approval pending — where a registered teacher waits.
 *
 * Reached only from the guard, once Create Account has been submitted and while
 * `ApprovedStatus` on users/{uid} is not yet true. An administrator flips that field in
 * the Firestore console; the next navigation lets them through to the dashboard.
 *
 * OUTSIDE THE SHELL, with only a Logout. There is deliberately nothing else to
 * press: the whole point of this page is that the app is not open yet, and a
 * sidebar offering Institutions and Classrooms would contradict it.
 *
 * THE COPY NAMES THE REQUEST, reading the classroom and institution back out of
 * the profile they were just saved to. A generic "awaiting approval" leaves the
 * teacher unable to tell whether the form recorded the right school at all, which
 * is exactly what they would want to check while waiting.
 */
@Component({
  selector: 'app-approval',
  imports: [Logo],
  templateUrl: './approval.html',
  styleUrl: './approval.css'
})
export class Approval implements OnDestroy {

  private auth = inject(AuthService);
  private profileService = inject(ProfileService);
  private router = inject(Router);

  private readonly profile = signal<TeacherProfile | null>(null);

  /** Detaches the approval listener. Held so ngOnDestroy can call it. */
  private stopWatching: (() => void) | null = null;

  constructor() {
    void this.load();

    // The page moves on BY ITSELF the moment ApprovedStatus flips, which is what the
    // copy promises. Without this the teacher sits here until they happen to refresh.
    this.stopWatching = this.profileService.watchApproval(() => {
      void this.enterDashboard();
    });
  }

  /**
   * An onSnapshot left attached after the component is gone keeps a socket open and
   * keeps firing into a navigation that has already happened.
   */
  ngOnDestroy(): void {
    this.stopWatching?.();
    this.stopWatching = null;
  }

  /**
   * Leaves for the dashboard, once.
   *
   * GUARDED, because the listener can fire more than once: any later write to
   * users/{uid} while the account is approved delivers another snapshot, and a second
   * navigate() to a route already active is wasted work at best.
   *
   * Detaches first, so nothing arrives mid-navigation.
   */
  private async enterDashboard(): Promise<void> {
    if (this.leaving) {
      return;
    }

    this.leaving = true;
    this.stopWatching?.();
    this.stopWatching = null;

    await this.router.navigate(['/dashboard']);
  }

  private leaving = false;

  /** What they asked to join, e.g. "10 A". Empty until the profile arrives. */
  readonly classroomName = computed(() => this.profile()?.currentClassInfo?.classroomName ?? '');

  readonly institutionName = computed(
    () => this.profile()?.currentClassInfo?.institutionName ?? ''
  );

  /**
   * True once there is enough to name the request.
   *
   * Guards the sentence rather than the page: rendering "join the  classroom in the
   *  institution" while the read is in flight is worse than holding the line back
   * for a moment.
   */
  readonly named = computed(() => !!this.classroomName() && !!this.institutionName());

  private async load(): Promise<void> {
    try {
      this.profile.set(await this.profileService.load());
    } catch (error) {
      // The page still says something useful without it; only the specifics are
      // lost, and the teacher is not blocked on them.
      console.error('Could not load the profile for the approval page.', error);
    }
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigate(['/login']);
  }
}

import { Component, inject } from '@angular/core';

import { Icon } from '../../components/icon/icon';
import { AuthService } from '../../services/auth.service';

/**
 * Edit Profile — routed placeholder.
 *
 * Reached from the topbar user menu rather than the sidebar, so it has a route
 * but no nav entry. It already shows the real signed-in identity, because that
 * needs no Firestore read; editing it will need a write to tcdev_users/{uid},
 * which is blocked until this app's rules are deployed.
 */
@Component({
  selector: 'app-profile',
  imports: [Icon],
  template: `
    <div class="page-stub animate-fade-up">
      <span class="stub-icon"><app-icon name="edit" [size]="24" /></span>
      <h2>Edit Profile</h2>
      <p>
        Signed in as <strong>{{ identity }}</strong> ({{ role }}).
        Editing personal details will live here.
      </p>
    </div>
  `
})
export class Profile {
  private auth = inject(AuthService);

  readonly identity = this.auth.identity();
  readonly role = this.auth.role();
}

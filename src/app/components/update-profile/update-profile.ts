import { Component, OnInit, computed, inject, output, signal } from '@angular/core';

import { Icon } from '../icon/icon';
import { toSubscriberDigits } from '../../data/institution-options';
import { TeacherProfile } from '../../models/teaching.model';
import { UserRole } from '../../services/auth.service';
import { ProfileService } from '../../services/profile.service';

/**
 * Update Profile — modal, opened from the topbar user menu.
 *
 * Reads and writes tcdev_users/{uid}. That document is keyed by uid, so
 * ownership is the path and a teacher cannot reach anyone else's profile even
 * by tampering with the payload.
 *
 * ZONELESS. The profile arrives after an await and `saving` flips after
 * another, so everything the template reads is a signal.
 */
@Component({
  selector: 'app-update-profile',
  imports: [Icon],
  templateUrl: './update-profile.html',
  styleUrl: './update-profile.css',
  /**
   * Escape dismisses the modal. On the DOCUMENT, not the template: the backdrop
   * is a div that never takes focus, so a keydown bound to it would never fire.
   */
  host: { '(document:keydown.escape)': 'close()' }
})
export class UpdateProfile implements OnInit {

  readonly closed = output<void>();
  readonly saved = output<TeacherProfile>();

  private service = inject(ProfileService);

  readonly firstName = signal('');
  readonly lastName = signal('');
  readonly email = signal('');
  /** Local digits only. The +91 lives in the control, as in the reference. */
  readonly phone = signal('');

  /**
   * Held so a save can echo it back, but never rendered and never editable —
   * the role comes from the signed-in session, so an account cannot promote
   * itself by editing a field.
   */
  private readonly role = signal<UserRole>('Teacher');

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');

  /** What was loaded, so the button can stay disabled until something changes. */
  private original = signal('');

  private snapshot = computed(() =>
    JSON.stringify([this.firstName(), this.lastName(), this.email(), this.phone()])
  );

  readonly dirty = computed(() => this.snapshot() !== this.original());

  /**
   * First name is the only hard requirement.
   *
   * The reference disables Update Profile until something is edited, and a
   * profile with no name at all is what makes the avatar and greeting
   * meaningless — the rest can legitimately be blank.
   */
  readonly valid = computed(() => this.firstName().trim().length > 0);

  readonly initials = computed(() => {
    const first = this.firstName().trim();
    const last = this.lastName().trim();

    if (first && last) {
      return (first[0] + last[0]).toUpperCase();
    }

    return (first || last || '?').slice(0, 2).toUpperCase();
  });

  async ngOnInit(): Promise<void> {
    try {
      const profile = await this.service.load();

      this.firstName.set(profile.firstName ?? '');
      this.lastName.set(profile.lastName ?? '');
      this.email.set(profile.email ?? '');
      this.phone.set(toSubscriberDigits(profile.phone ?? ''));
      this.role.set(profile.role ?? 'Teacher');

      this.original.set(this.snapshot());
    } catch (error) {
      this.error.set(this.service.describeError(error, 'Could not load your profile.'));
    } finally {
      this.loading.set(false);
    }
  }

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  async save(): Promise<void> {
    if (this.saving() || !this.valid() || !this.dirty()) {
      return;
    }

    this.saving.set(true);
    this.error.set('');

    const profile = {
      firstName: this.firstName().trim(),
      lastName: this.lastName().trim(),
      email: this.email().trim(),
      // Subscriber digits only. The dial code is shown by the control and is
      // not part of the stored value, matching how institutions store a phone.
      phone: toSubscriberDigits(this.phone())
    };

    // role, createdAt and updatedAt are set by the service from the session and
    // the server clock. Sending them from here would let the form claim a role
    // it was not granted, and would let a wrong client clock set the times.
    try {
      await this.service.save(profile);
      this.original.set(this.snapshot());
      this.saved.emit({ ...profile, role: this.role() } as unknown as TeacherProfile);
      this.closed.emit();
    } catch (error) {
      this.error.set(this.service.describeError(error, 'Could not save your profile.'));
    } finally {
      this.saving.set(false);
    }
  }

  close(): void {
    this.closed.emit();
  }
}

import { Component, computed, input, output, signal, inject } from '@angular/core';
import { ConfigurationService } from '../../services/configuration.service';

import { Icon } from '../../components/icon/icon';
import { FlowField, isFieldLocked } from '../../data/form-flow';
import {
  boardLabel,
  dialFor,
  emptyDraft,
  toSubscriberDigits
} from '../../data/institution-options';
import { InstitutionAddress, InstitutionDraft } from '../../models/teaching.model';

/**
 * Add a New Institution — the inline school form, reached from inside a School
 * dropdown.
 *
 * TWO CALLERS, one form: Add Classroom (modal) and the Set Up Wizard's
 * Institution Selection step (page). It lives in this folder because that is
 * where it was first needed; nothing about it is classroom-specific, and its
 * user-visible copy is deliberately caller-neutral so neither surface reads as
 * the other one.
 *
 * WHY IT EXISTS. Add Classroom's School list is filtered to the teacher's own
 * schools at the chosen board and pincode. When none match, the flow used to
 * dead-end on "Register it under Institutions first" — which means abandoning a
 * half-filled classroom, navigating away, registering the school, and starting
 * over. Production solves it the same way, opening its school-create dialog from
 * the same dropdown (`classroom-create.component.ts` → `createSchool()`).
 *
 * WHY NOT REUSE AddInstitution. That is a THREE-STEP WIZARD, and production's
 * inline form is one flat page — which is the right shape here, because the
 * teacher is already mid-task in another modal and a nested wizard would be a
 * second multi-step flow inside the first. The DATA is identical: this emits the
 * same `InstitutionDraft` the wizard does, so it writes to the same
 * `institutions` collection through the same service, under the same rules. No
 * new model, no new collection, no new rule block.
 *
 * Country, board and pincode arrive PREFILLED from whichever search found
 * nothing, because they are what that search was made of. Country and board are
 * read-only: changing them here would produce a school that does not match the
 * search that led to this form, so the new school would not appear in the list it
 * was created for. Pincode stays editable, since a mistyped one is the likeliest
 * reason nothing matched — callers are expected to move their search to the
 * school that comes back.
 *
 * ZONELESS. Every field the template reads is a signal.
 */
@Component({
  selector: 'app-add-institution-inline',
  imports: [Icon],
  templateUrl: './add-institution-inline.html',
  styleUrl: './add-institution-inline.css',
  /**
   * Escape dismisses. On the DOCUMENT, not the template: the backdrop is a div
   * that never takes focus, so a keydown bound to it would never fire.
   */
  host: { '(document:keydown.escape)': 'close()' }
})
export class AddInstitutionInline {

  /**
   * Option lists, read from the Configuration collection in Firestore.
   *
   * The properties below are its SIGNALS, so a list edited in the console reaches
   * this form without a deploy. Each falls back to the constant it replaced, so a
   * refused read renders the options the app shipped with rather than empty selects.
   */
  private config = inject(ConfigurationService);

  /** Carried in from Add Classroom — the search that found nothing. */
  readonly country = input.required<string>();
  readonly board = input.required<string>();
  readonly pincode = input.required<string>();

  readonly saving = input(false);
  readonly error = input('');

  readonly submitted = output<InstitutionDraft>();
  readonly closed = output<void>();

  readonly mediums = this.config.languages;
  readonly schoolTypes = this.config.schoolTypes;
  readonly genderTypes = this.config.genderTypes;

  /** The full board name, for the read-only field. */
  readonly boardLabel = computed(() => boardLabel(this.board()));

  /**
   * The working draft.
   *
   * Seeded from emptyDraft() so every key exists — the same guard the wizard
   * relies on, and the reason nothing here can reach Firestore as undefined.
   */
  private readonly draft = signal<InstitutionDraft>(emptyDraft());

  /**
   * The pincode once the user has touched it, or null while it is still the one
   * carried in.
   *
   * Needed because `current()` below re-applies the carried-in values on every
   * read. Country and board are PINNED that way on purpose, but the pincode has
   * to stay editable — a typo in it is one of the likeliest reasons the school
   * search found nothing — and without this the field silently ignored typing.
   */
  private readonly pincodeOverride = signal<string | null>(null);

  /**
   * The prefilled trio, applied on top of whatever has been typed.
   *
   * A computed rather than a constructor assignment: the inputs arrive before the
   * first render, and seeding in a lifecycle hook would render one frame with the
   * wrong country and dial code.
   */
  readonly current = computed<InstitutionDraft>(() => {
    const draft = this.draft();

    return {
      ...draft,
      board: this.board(),
      institutionAddress: {
        ...draft.institutionAddress,
        country: this.country(),
        pincode: this.pincodeOverride() ?? this.pincode()
      },
      // The dial code follows the country, as it does in the wizard. Without it a
      // school in Iraq would store +91 against a real number.
      representativeCountryCode: dialFor(this.country())
    };
  });

  readonly dialCode = computed(() => this.current().representativeCountryCode);

  /* ---- Progressive unlocking ---------------------------------------------
     The same chain the Add Institution wizard uses, in this form's own order.
     Country, board and pincode are carried in from the caller's search and are
     read-only here, so the chain effectively opens at the UDISE code.

     Landmark is optional, so an empty one cannot hold City shut. ------------ */

  private readonly flow = computed<FlowField[]>(() => {
    const draft = this.current();
    const address = draft.institutionAddress;
    const has = (value: unknown) => String(value ?? '').trim() !== '';

    return [
      { name: 'country',     filled: has(address.country) },
      { name: 'board',       filled: has(draft.board) },
      { name: 'udise',       filled: has(draft.registrationNumber) },
      { name: 'name',        filled: has(draft.institutionName) },
      { name: 'medium',      filled: has(draft.medium) },
      { name: 'type',        filled: has(draft.typeofSchool) },
      { name: 'gender',      filled: has(draft.genderType) },
      { name: 'pincode',     filled: has(address.pincode) },
      { name: 'street',      filled: has(address.street) },
      { name: 'locality',    filled: has(address.village) },
      { name: 'landmark',    filled: has(address.landmark), optional: true },
      { name: 'city',        filled: has(address.city) },
      { name: 'subdistrict', filled: has(address.subDistrict) },
      { name: 'district',    filled: has(address.district) },
      { name: 'state',       filled: has(address.state) },
      { name: 'phone',       filled: has(draft.representativePhoneNumber) },
      { name: 'first',       filled: has(draft.representativeFirstName) },
      { name: 'last',        filled: has(draft.representativeLastName) },
      { name: 'email',       filled: has(draft.representativeEmail) }
    ];
  });

  locked(name: string): boolean {
    return isFieldLocked(this.flow(), name);
  }

  field<K extends keyof InstitutionDraft>(key: K): InstitutionDraft[K] {
    return this.current()[key];
  }

  addressField<K extends keyof InstitutionAddress>(key: K): string {
    return this.current().institutionAddress[key];
  }

  update<K extends keyof InstitutionDraft>(key: K, value: InstitutionDraft[K]): void {
    this.draft.update(draft => ({ ...draft, [key]: value }));
  }

  updateAddress<K extends keyof InstitutionAddress>(key: K, value: string): void {
    // The pincode needs its own record of having been edited, because current()
    // otherwise re-applies the carried-in value over whatever was typed.
    if (key === 'pincode') {
      this.pincodeOverride.set(value);
      return;
    }

    this.draft.update(draft => ({
      ...draft,
      institutionAddress: { ...draft.institutionAddress, [key]: value }
    }));
  }

  /**
   * Three fields are required, matching the asterisks production's form shows —
   * the UDISE code and the representative's first name — plus the school name.
   *
   * The name carries no asterisk there, and is required here anyway: it is what
   * every table, dropdown and picker in this app renders, so a nameless school
   * would be a blank row nobody could identify. Everything else is descriptive
   * and can be filled in later from the Institutions page.
   */
  readonly valid = computed(() => {
    const draft = this.current();

    return draft.registrationNumber.trim() !== '' &&
      draft.institutionName.trim() !== '' &&
      draft.representativeFirstName.trim() !== '';
  });

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  save(): void {
    if (this.saving() || !this.valid()) {
      return;
    }

    const draft = this.current();

    this.submitted.emit({
      ...draft,
      institutionName: draft.institutionName.trim(),
      registrationNumber: draft.registrationNumber.trim(),
      representativeFirstName: draft.representativeFirstName.trim(),
      representativeLastName: draft.representativeLastName.trim(),
      representativeEmail: draft.representativeEmail.trim(),
      /**
       * Stripped to subscriber digits on the way OUT, not per keystroke.
       * Rewriting as the user types moves the caret and fights them mid-number.
       * The dial code stays a separate field, exactly as the wizard keeps it.
       */
      representativePhoneNumber: toSubscriberDigits(draft.representativePhoneNumber)
    });
  }

  close(): void {
    this.closed.emit();
  }

}

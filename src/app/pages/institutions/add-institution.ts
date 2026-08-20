import { Component, computed, input, output, signal, inject } from '@angular/core';
import { ConfigurationService } from '../../services/configuration.service';

import { Icon } from '../../components/icon/icon';
import {
  COUNTRIES,
  DIAL_CODES,
  WIZARD_STEPS,
  dialFor,
  emptyDraft,
  toSubscriberDigits
} from '../../data/institution-options';
import { FlowField, firstLockedField, isFieldLocked } from '../../data/form-flow';
import { InstitutionAddress, InstitutionDraft } from '../../models/teaching.model';

/**
 * Add Institution — a three-step wizard in a modal.
 *
 * Presentational: it collects and validates, then emits the draft; the parent
 * owns the Firestore write. That keeps the form testable without a database and
 * means a failed save can leave the modal open with the user's input intact.
 *
 * ZONELESS. Every field the template reads is a signal.
 */
@Component({
  selector: 'app-add-institution',
  imports: [Icon],
  templateUrl: './add-institution.html',
  styleUrl: './add-institution.css',
  /**
   * Escape dismisses the modal. On the DOCUMENT, not the template: the backdrop
   * is a div that never takes focus, so a keydown bound to it would never fire.
   */
  host: { '(document:keydown.escape)': 'close()' }
})
export class AddInstitution {

  /**
   * Option lists, read from the Configuration collection in Firestore.
   *
   * The properties below are its SIGNALS, so a list edited in the console reaches
   * this form without a deploy. Each falls back to the constant it replaced, so a
   * refused read renders the options the app shipped with rather than empty selects.
   */
  private config = inject(ConfigurationService);

  readonly submitted = output<InstitutionDraft>();
  readonly closed = output<void>();

  /** True while the parent's write is in flight. Owned by the parent. */
  readonly saving = input(false);

  readonly steps = WIZARD_STEPS;
  readonly countries = COUNTRIES;
  readonly dialCodes = DIAL_CODES;
  readonly boards = this.config.boards;
  readonly mediums = this.config.languages;
  readonly schoolTypes = this.config.schoolTypes;
  readonly genderTypes = this.config.genderTypes;

  readonly step = signal(1);
  readonly draft = signal<InstitutionDraft>(emptyDraft());

  /**
   * Fields the user has left, by name.
   *
   * Errors appear on BLUR rather than on submit. The Next button is disabled
   * until the form is complete, so there is no submit attempt left to hang
   * "show me what is wrong" on: without this, an incomplete form would sit
   * behind a dead button with nothing marked.
   */
  private readonly blurred = signal<ReadonlySet<string>>(new Set());

  /**
   * Every field on the form is required EXCEPT Landmark, which the reference's
   * edit view does not even display and so must not be able to block a save.
   *
   * institutionCode is absent from both lists because it is absent from the
   * form: the reference does not collect it at creation. It is still stored, and
   * is filled from the edit modal's Basic Info tab.
   *
   * The label is carried alongside the key so the missing-field summary can name
   * fields the way the form does, rather than echoing camelCase at the user.
   */
  private static readonly REQUIRED: { key: keyof InstitutionDraft; label: string }[] = [
    { key: 'board',                     label: 'Board' },
    { key: 'registrationNumber',        label: 'School Affiliation Number or UDISE Code' },
    { key: 'institutionName',           label: 'School Name' },
    { key: 'medium',                    label: 'Medium of Instruction' },
    { key: 'typeofSchool',              label: 'Type of School' },
    { key: 'genderType',                label: 'Boys / Girls / Co-ed' },
    { key: 'representativePhoneNumber', label: 'School Representative Contact Number' },
    { key: 'representativeFirstName',   label: 'Representative First Name' },
    { key: 'representativeLastName',    label: 'Representative Last Name' },
    { key: 'representativeEmail',       label: 'Representative Email' }
  ];

  private static readonly REQUIRED_ADDRESS: { key: keyof InstitutionAddress; label: string }[] = [
    { key: 'country',     label: 'Country' },
    { key: 'pincode',     label: 'School Pincode' },
    { key: 'street',      label: 'Street Name' },
    { key: 'village',     label: 'Locality Name' },
    { key: 'city',        label: 'City' },
    { key: 'subDistrict', label: 'Sub District' },
    { key: 'district',    label: 'District' },
    { key: 'state',       label: 'State' }
  ];

  /** Labels of every required field still empty. Drives the footer summary. */
  readonly missingLabels = computed(() => {
    const draft = this.draft();
    const address = draft.institutionAddress;

    return [
      ...AddInstitution.REQUIRED
        .filter(field => !String(draft[field.key] ?? '').trim())
        .map(field => field.label),
      ...AddInstitution.REQUIRED_ADDRESS
        .filter(field => !String(address[field.key] ?? '').trim())
        .map(field => field.label)
    ];
  });

  /**
   * Nothing left empty. Gates both Next and Save.
   *
   * The email is checked for being FILLED IN and nothing more — no shape rule.
   * The field takes whatever is typed.
   */
  readonly stepOneValid = computed(() => this.missingLabels().length === 0);

  /* ---- Progressive unlocking ---------------------------------------------
     Each field is locked until the one before it has a value, so the form is
     filled top to bottom. The ORDER below is the order the fields appear in the
     template, and it is the only place that order is written down — the locking
     follows from it rather than from nineteen hand-written conditions.

     Landmark is marked optional, so leaving it empty cannot hold City shut.
     ---------------------------------------------------------------------- */

  private readonly flow = computed<FlowField[]>(() => {
    const draft = this.draft();
    const address = draft.institutionAddress;
    const has = (value: unknown) => String(value ?? '').trim() !== '';

    return [
      { name: 'country',            filled: has(address.country) },
      { name: 'board',              filled: has(draft.board) },
      { name: 'registrationNumber', filled: has(draft.registrationNumber) },
      { name: 'institutionName',    filled: has(draft.institutionName) },
      { name: 'medium',             filled: has(draft.medium) },
      { name: 'typeofSchool',       filled: has(draft.typeofSchool) },
      { name: 'genderType',         filled: has(draft.genderType) },
      { name: 'pincode',            filled: has(address.pincode) },
      { name: 'street',             filled: has(address.street) },
      { name: 'village',            filled: has(address.village) },
      { name: 'landmark',           filled: has(address.landmark), optional: true },
      { name: 'city',               filled: has(address.city) },
      { name: 'subDistrict',        filled: has(address.subDistrict) },
      { name: 'district',           filled: has(address.district) },
      { name: 'state',              filled: has(address.state) },
      { name: 'representativePhoneNumber',           filled: has(draft.representativePhoneNumber) },
      { name: 'representativeFirstName',       filled: has(draft.representativeFirstName) },
      { name: 'representativeLastName',        filled: has(draft.representativeLastName) },
      { name: 'representativeEmail',           filled: has(draft.representativeEmail) }
    ];
  });

  /** True while this field is still waiting on the one above it. */
  locked(name: string): boolean {
    return isFieldLocked(this.flow(), name);
  }

  /**
   * The first locked field, so the reason is stated ONCE, under the control the
   * user is actually blocked at, rather than repeated under all of them.
   */
  readonly firstLocked = computed(() => firstLockedField(this.flow()));

  /** Empty AND already visited, which is when an inline error is fair. */
  isMissing(field: keyof InstitutionDraft): boolean {
    return this.blurred().has(field) && !String(this.draft()[field] ?? '').trim();
  }

  isAddressMissing(field: keyof InstitutionAddress): boolean {
    return (
      this.blurred().has(field) &&
      !String(this.draft().institutionAddress[field] ?? '').trim()
    );
  }

  /** Marks a field visited, so leaving it empty starts showing an error. */
  markBlurred(field: string): void {
    this.blurred.update(current => new Set(current).add(field));
  }

  update<K extends keyof InstitutionDraft>(key: K, value: InstitutionDraft[K]): void {
    this.draft.update(current => ({ ...current, [key]: value }));
  }

  /** Patches one key inside the nested institutionAddress map. */
  updateAddress<K extends keyof InstitutionAddress>(key: K, value: string): void {
    this.draft.update(current => ({
      ...current,
      institutionAddress: { ...current.institutionAddress, [key]: value }
    }));
  }

  /**
   * Country drags the representative's dial code with it.
   *
   * Production does the same (getInternationalBoards derives the dial code from
   * the selected country). Without it, picking Iraq would leave the phone field
   * prefixed +91, and the wrong dial code stored against a real number is worse
   * than an empty one.
   */
  setCountry(name: string): void {
    this.updateAddress('country', name);
    this.update('representativeCountryCode', dialFor(name));
  }

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  next(): void {
    // The button is disabled while step one is incomplete, so this is a guard
    // against a programmatic call rather than something a user can reach.
    if (this.step() === 1 && !this.stepOneValid()) {
      return;
    }

    this.step.update(current => Math.min(current + 1, this.steps.length));
  }

  back(): void {
    this.step.update(current => Math.max(current - 1, 1));
  }

  save(): void {
    if (this.saving() || !this.stepOneValid()) {
      return;
    }

    /**
     * Strip the phone to subscriber digits on the way out, not per keystroke.
     * Rewriting as the user types moves the caret and fights them mid-number.
     * The dial code is a separate field and is never folded into this one.
     */
    this.submitted.emit({
      ...this.draft(),
      representativePhoneNumber: toSubscriberDigits(this.draft().representativePhoneNumber)
    });
  }

  close(): void {
    this.closed.emit();
  }

  /** Non-empty entries, for the Review step. */
  readonly reviewRows = computed(() => {
    const draft = this.draft();
    const address = draft.institutionAddress;

    const rows: { label: string; value: string }[] = [
      { label: 'Country', value: address.country },
      { label: 'School Name', value: draft.institutionName },
      { label: 'Board', value: draft.board },
      { label: 'Registration Number', value: draft.registrationNumber },
      { label: 'Type of School', value: draft.typeofSchool },
      { label: 'Medium of Instruction', value: draft.medium },
      { label: 'Boys / Girls / Co-ed', value: draft.genderType },
      { label: 'Street', value: address.street },
      { label: 'Locality', value: address.village },
      { label: 'Landmark', value: address.landmark },
      { label: 'City', value: address.city },
      { label: 'Sub District', value: address.subDistrict },
      { label: 'District', value: address.district },
      { label: 'State', value: address.state },
      { label: 'Pincode', value: address.pincode },
      {
        label: 'Representative Phone',
        value: draft.representativePhoneNumber
          ? `${draft.representativeCountryCode} ${draft.representativePhoneNumber}`
          : ''
      },
      { label: 'Representative First Name', value: draft.representativeFirstName },
      { label: 'Representative Last Name', value: draft.representativeLastName },
      { label: 'Representative Email', value: draft.representativeEmail }
    ];

    return rows.filter(row => row.value.trim() !== '');
  });
}

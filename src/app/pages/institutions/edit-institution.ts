import { Component, computed, input, output, signal, inject } from '@angular/core';
import { ConfigurationService } from '../../services/configuration.service';

import { Icon } from '../../components/icon/icon';
import {
  COUNTRIES,
  DIAL_CODES,
  toSubscriberDigits
} from '../../data/institution-options';
import { Institution, InstitutionAddress } from '../../models/teaching.model';

export type EditTab = 'basic' | 'address' | 'board';

/**
 * Equality for one institution field, used to decide whether a tab has anything
 * to save.
 *
 * institutionAddress is a nested map, so === would report every draft as changed
 * the moment anything is typed anywhere: the draft holds a fresh copy of the
 * object. Compared key by key instead, over the union of both sides, so a key
 * present on only one of them still counts as a difference.
 */
function sameFieldValue(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }

  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;

  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .every(key => left[key] === right[key]);
}

/**
 * Edit Institution — tabbed modal.
 *
 * Presentational: it edits a local copy and emits the changed fields. The
 * parent owns the Firestore write, which keeps this testable without a database
 * and means a failed save can leave the modal open with the user's edits intact.
 *
 * THREE TABS. Chain, School Onboarding and Programmes were all removed outright
 * rather than left as stubs: an institution's programmes are managed on the
 * Programme page, against the programmes collection, so a pane here would have
 * been a second place to look for the same thing.
 *
 * Each tab saves independently, exactly as the reference does — each has its own
 * Save Changes.
 */
@Component({
  selector: 'app-edit-institution',
  imports: [Icon],
  templateUrl: './edit-institution.html',
  styleUrl: './edit-institution.css',
  /**
   * Escape dismisses the modal. On the DOCUMENT, not the template: the backdrop
   * is a div that never takes focus, so a keydown bound to it would never fire.
   */
  host: { '(document:keydown.escape)': 'close()' }
})
export class EditInstitution {

  /**
   * Option lists, read from the Configuration collection in Firestore.
   *
   * The properties below are its SIGNALS, so a list edited in the console reaches
   * this form without a deploy. Each falls back to the constant it replaced, so a
   * refused read renders the options the app shipped with rather than empty selects.
   */
  private config = inject(ConfigurationService);

  readonly institution = input.required<Institution>();
  readonly saving = input(false);

  /**
   * A failed save's message, owned by the parent.
   *
   * Rendered inside this modal rather than on the page behind it: the overlay
   * covers the page, so a message out there is invisible and the save looks like
   * it did nothing at all.
   */
  readonly error = input('');

  readonly saved = output<Partial<Institution>>();
  readonly closed = output<void>();

  readonly countries = COUNTRIES;
  readonly dialCodes = DIAL_CODES;
  readonly boards = this.config.boards;
  readonly mediums = this.config.languages;
  readonly schoolTypes = this.config.schoolTypes;
  readonly genderTypes = this.config.genderTypes;

  readonly tabs: { key: EditTab; label: string }[] = [
    { key: 'basic',   label: 'Basic Info' },
    { key: 'address', label: 'Address' },
    { key: 'board',   label: 'Board' }
  ];

  readonly tab = signal<EditTab>('basic');

  /**
   * The working copy.
   *
   * Seeded lazily from the input rather than in a constructor, because an input
   * is not readable until after construction. A linkedSignal keeps it in step
   * if the parent ever swaps which institution is being edited.
   */
  readonly draft = signal<Institution | null>(null);

  readonly current = computed(() => this.draft() ?? this.institution());

  /** The nested address map, for the Address tab. */
  readonly address = computed(() => this.current().institutionAddress);

  /** True for a moment after a successful copy, so the icon can confirm it. */
  readonly copied = signal(false);

  /** Set when the clipboard is unavailable, so the id can be shown to read off. */
  readonly copyFailed = signal(false);

  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Copies the document id.
   *
   * The clipboard API rejects outside a secure context and can be blocked by
   * permissions, so the failure path matters: rather than a silent no-op, the id
   * is rendered under the field to be read off manually.
   */
  async copyId(): Promise<void> {
    this.copyFailed.set(false);

    try {
      await navigator.clipboard.writeText(this.current().docId);
    } catch {
      this.copyFailed.set(true);
      return;
    }

    this.copied.set(true);

    if (this.copiedTimer !== null) {
      clearTimeout(this.copiedTimer);
    }

    this.copiedTimer = setTimeout(() => {
      this.copied.set(false);
      this.copiedTimer = null;
    }, 1800);
  }

  setTab(tab: EditTab): void {
    this.tab.set(tab);
  }

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  /**
   * The select shows Yes / No; the document stores a boolean.
   *
   * Converted here rather than in the template so nothing downstream ever has to
   * compare against display text, and so switching the labels later cannot
   * change what is written.
   */
  setCustomerSchool(value: string): void {
    this.update('customerSchool', value === 'Yes');
  }

  update<K extends keyof Institution>(key: K, value: Institution[K]): void {
    this.draft.set({ ...this.current(), [key]: value });
  }

  /** Patches one key inside the nested institutionAddress map. */
  updateAddress<K extends keyof InstitutionAddress>(key: K, value: string): void {
    this.draft.set({
      ...this.current(),
      institutionAddress: { ...this.current().institutionAddress, [key]: value }
    });
  }

  /**
   * Saves only the fields belonging to the current tab.
   *
   * The reference gives each tab its own Save Changes, and honouring that
   * matters beyond fidelity: a whole-document write from the Address tab would
   * silently overwrite Basic Info with whatever the working copy happened to
   * hold, including fields the user never opened.
   */
  save(): void {
    // An in-flight save is the only thing that stops this. The email shape is
    // not checked here: the field takes whatever is typed.
    if (this.saving()) {
      return;
    }

    this.saved.emit(this.patchFor(this.tab()));
  }

  /**
   * The patch a given tab would emit.
   *
   * Shared with `dirty` below, so the button's enabled state is decided by the
   * exact object clicking it would write, rather than by a second list of fields
   * that could drift from this one.
   */
  private patchFor(tab: EditTab): Partial<Institution> {
    const draft = this.current();

    const fieldsByTab: Record<string, (keyof Institution)[]> = {
      basic: [
        'institutionName', 'genderType', 'medium', 'typeofSchool',
        'customerSchool', 'registrationNumber',
        'representativeFirstName', 'representativeLastName',
        'representativeEmail', 'representativeCountryCode',
        'representativePhoneNumber'
      ],
      // One key, not seven: the address is a nested map, so the whole object is
      // the unit of change and nothing outside it can be touched by this tab.
      address: ['institutionAddress'],
      // institutionAddress is here because Select Country writes into it — the
      // country has always lived in the address map, and this tab now edits it
      // rather than showing it read-only. Writing the whole map is safe: the
      // draft is a copy of the loaded document, so every other address field
      // goes back exactly as it came.
      board: ['board', 'institutionAddress']
    };

    const keys = fieldsByTab[tab] ?? [];
    const patch: Partial<Institution> = {};

    for (const key of keys) {
      patch[key] = draft[key] as never;
    }

    // Normalise on save rather than per keystroke, so the caret is never moved
    // out from under someone mid-number. The dial code stays its own field.
    if ('representativePhoneNumber' in patch) {
      patch.representativePhoneNumber =
        toSubscriberDigits(String(patch.representativePhoneNumber ?? ''));
    }

    return patch;
  }

  /**
   * Whether THIS tab has an unsaved change. Save Changes is disabled until it
   * does, so the button never offers to write the document back unaltered.
   *
   * Per tab, not per modal: each tab saves independently, so a pending edit on
   * Address must not light up the Board tab's button. The one overlap is
   * deliberate — the Board tab writes the whole address map, so an edit made
   * there does count as a change for it.
   *
   * Compared against the loaded document via the patch the tab would emit, so a
   * value typed and then typed back to what it was leaves the button shut. That
   * also means the phone number is compared AFTER normalisation: reformatting a
   * number without changing its digits is not an edit.
   */
  readonly dirty = computed(() => {
    const original = this.institution() as unknown as Record<string, unknown>;
    const patch = this.patchFor(this.tab()) as Record<string, unknown>;

    return Object.keys(patch).some(key => {
      const wanted = key === 'representativePhoneNumber'
        ? toSubscriberDigits(String(original[key] ?? ''))
        : original[key];

      return !sameFieldValue(patch[key], wanted);
    });
  });

  close(): void {
    this.closed.emit();
  }
}

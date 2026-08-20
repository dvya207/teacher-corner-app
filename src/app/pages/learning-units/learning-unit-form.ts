import { Component, computed, input, output, signal } from '@angular/core';
import { LEARNING_UNIT_MATURITIES } from '../../data/learning-unit-taxonomy';

import { Icon } from '../../components/icon/icon';
import {
  DIFFICULTY_LEVELS,
  LEARNING_UNIT_LANGUAGES,
  LEARNING_UNIT_STATUSES,
  emptyLearningUnitDraft,
  learningUnitIdOf,
  nextVersionLabel,
  storedVersionOf
} from '../../data/learning-unit-options';
import {
  LEARNING_UNIT_CODE_PATTERN,
  LEARNING_UNIT_TYPES,
  TaxonomyRow,
  compositeCodeFor,
  domainCodesOf,
  domainNamesOf,
  learningUnitTypeCode,
  subDomainCodesOf,
  subDomainNamesOf,
  subjectCodesOf,
  subjectNamesOf,
  taxonomyForCode,
  taxonomyFromUnits
} from '../../data/learning-unit-taxonomy';
import { LearningUnit, LearningUnitDraft } from '../../models/teaching.model';

/**
 * Add a New Learning Unit or Version — ONE component for create and edit.
 *
 * WHY NOT TWO, when institutions and programmes each have a separate add and
 * edit. Those two are split because their forms genuinely differ: Add
 * Institution is a three-step wizard and Edit Institution is a tabbed editor.
 * A learning unit is a single flat form either way, so splitting it would be the
 * same two hundred lines twice with the word "Add" changed — and the two copies
 * would drift the first time a field was added to one.
 *
 * WHAT THE TITLE MEANS. "or Version" is not a second mode. A new version of PT12
 * is a new DOCUMENT that shares `learningUnitCode` with the others and carries a
 * higher `version` — production stores one language and one version per
 * document, which is why its list shows three AE04 cards side by side. Reaching
 * that case is a matter of typing an existing unit's name and picking it from
 * the suggestions: doing so locks the identity and the categorisation, and the
 * version number advances on its own.
 *
 * THE FIELDS ARE NOT INDEPENDENT. Two mechanisms drive most of this form, and
 * both are production's:
 *
 *   1. PROGRESSIVE UNLOCK. Each field enables the next, in the order
 *      name → display name → type → language → code → maturity. A learning unit
 *      cannot be numbered before its language is known (versions run per
 *      language) and cannot be categorised before its code is known, so offering
 *      those fields early would be offering the user a chance to enter something
 *      that is about to be overwritten.
 *
 *   2. THE CODE DERIVES THE CATEGORISATION. 'AE04' means domain A, sub-domain E.
 *      All six taxonomy fields and the composite code are looked up from that
 *      letter pair and are never typed. A pair with no row is what makes a code
 *      invalid — the digits are only a serial number.
 *
 * ZONELESS. Every field the template reads is a signal.
 */
@Component({
  selector: 'app-learning-unit-form',
  imports: [Icon],
  templateUrl: './learning-unit-form.html',
  styleUrl: './learning-unit-form.css',
  /**
   * Escape dismisses the modal.
   *
   * On the DOCUMENT, not the template: the backdrop is a div that never takes
   * focus, so a keydown bound to it would never fire. This is the keyboard
   * equivalent of the backdrop click, and it is why the two accessibility rules
   * are disabled on that element rather than worked around.
   */
  host: { '(document:keydown.escape)': 'close()' }
})
export class LearningUnitForm {


  /** null creates, a unit edits. */
  readonly unit = input<LearningUnit | null>(null);

  /**
   * Every learning unit already stored, active and trashed.
   *
   * Needed for three things that cannot be answered from the draft alone: the
   * name suggestions, the next version number for a code and language, and the
   * taxonomy rows the real data carries. Trashed units are included in the
   * version arithmetic ON PURPOSE — a version number freed by a deletion must
   * not be handed out again, or restoring the deleted one later would put two
   * V11s of the same language in the same family.
   *
   * (Production instead REVIVES the trashed document when the numbers collide.
   * The effect on the user is the same — no duplicate version — and skipping
   * forward avoids resurrecting a document someone deliberately deleted.)
   */
  readonly units = input<readonly LearningUnit[]>([]);
  readonly trashedUnits = input<readonly LearningUnit[]>([]);

  readonly saving = input(false);
  readonly error = input('');

  readonly submitted = output<LearningUnitDraft>();
  readonly closed = output<void>();

  readonly statuses = LEARNING_UNIT_STATUSES;
  readonly languages = LEARNING_UNIT_LANGUAGES;
  readonly difficulties = DIFFICULTY_LEVELS;
  readonly types = LEARNING_UNIT_TYPES;
  readonly maturities = LEARNING_UNIT_MATURITIES;

  readonly isEdit = computed(() => this.unit() !== null);

  /**
   * The taxonomy this form looks codes up in.
   *
   * The static table folded under whatever the stored units actually carry, so a
   * populated database corrects the seeded vocabulary without anyone editing
   * the seed file. See learning-unit-taxonomy.ts.
   */
  private readonly taxonomy = computed<TaxonomyRow[]>(() =>
    taxonomyFromUnits([...this.units(), ...this.trashedUnits()] as LearningUnit[])
  );

  /**
   * The working copy, as a partial patch over whatever the input holds.
   *
   * `null` means untouched, so every getter falls through to the stored value —
   * or to a blank draft when creating. Seeded by computeds rather than an
   * ngOnInit assignment, because the input arrives before the first render and a
   * signal set in a lifecycle hook renders one frame of empty fields first.
   */
  private readonly edits = signal<Partial<LearningUnitDraft> | null>(null);

  private readonly base = computed<LearningUnitDraft>(() => {
    const unit = this.unit();

    if (!unit) {
      return emptyLearningUnitDraft();
    }

    return {
      learningUnitCode: unit.learningUnitCode,
      learningUnitName: unit.learningUnitName,
      learningUnitDisplayName: unit.learningUnitDisplayName,
      isoCode: unit.isoCode,
      version: unit.version,
      status: unit.status,
      type: unit.type,
      typeCode: unit.typeCode,
      Maturity: unit.Maturity,
      subjectCode: unit.subjectCode,
      subjectName: unit.subjectName,
      domainCode: unit.domainCode,
      domainName: unit.domainName,
      subDomainCode: unit.subDomainCode,
      subDomainName: unit.subDomainName,
      compositeCode: unit.compositeCode,
      tacOwnerName: unit.tacOwnerName,
      shortDescription: unit.shortDescription,
      difficultyLevel: unit.difficultyLevel,
      totalTime: unit.totalTime
    };
  });

  private field<K extends keyof LearningUnitDraft>(key: K): LearningUnitDraft[K] {
    const edited = this.edits();

    return (edited && key in edited ? edited[key] : this.base()[key]) as LearningUnitDraft[K];
  }

  private patch(values: Partial<LearningUnitDraft>): void {
    this.edits.update(current => ({ ...(current ?? {}), ...values }));
  }

  readonly code = computed(() => this.field('learningUnitCode'));
  readonly name = computed(() => this.field('learningUnitName'));
  readonly displayName = computed(() => this.field('learningUnitDisplayName'));
  readonly isoCode = computed(() => this.field('isoCode'));
  readonly status = computed(() => this.field('status'));
  readonly type = computed(() => this.field('type'));
  readonly maturity = computed(() => this.field('Maturity'));
  readonly shortDescription = computed(() => this.field('shortDescription'));
  readonly difficultyLevel = computed(() => this.field('difficultyLevel'));
  readonly totalTime = computed(() => this.field('totalTime'));

  // ---- Existing-unit suggestions -----------------------------------------

  /**
   * Set when the name came from the suggestion list rather than the keyboard.
   *
   * It is what separates "a new version of PT12" from "a new unit that happens
   * to be called something similar", and it is why the code and the six taxonomy
   * fields lock: a version must inherit its family's identity exactly, or it is
   * not a version of it.
   */
  readonly pickedExisting = signal(false);

  /** Open only while typing, so a picked value does not leave the list up. */
  readonly suggestionsOpen = signal(false);

  /**
   * Up to eight matches on name or code.
   *
   * Capped because production's list is scrollable inside a dropdown and this one
   * is not; an unbounded list on a 1,839-unit collection would run off the modal.
   * One row per DOCUMENT rather than per code — the version and language are
   * exactly what the user is choosing between here.
   */
  readonly suggestions = computed<LearningUnit[]>(() => {
    if (!this.suggestionsOpen() || this.isEdit()) {
      return [];
    }

    const needle = String(this.name()).trim().toLowerCase();

    if (needle.length < 2) {
      return [];
    }

    return this.units()
      .filter(
        unit =>
          unit.learningUnitName.toLowerCase().includes(needle) ||
          unit.learningUnitCode.toLowerCase().includes(needle)
      )
      .slice(0, 8);
  });

  suggestionLabel(unit: LearningUnit): string {
    return [
      unit.learningUnitCode,
      unit.learningUnitName,
      unit.typeCode && `(${unit.typeCode})`,
      unit.isoCode && `(${unit.isoCode})`,
      unit.version && `(${unit.version})`,
      unit.Maturity && `(${unit.Maturity})`
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /**
   * Adopts an existing unit's identity, so what is saved becomes a new version.
   *
   * The language is deliberately NOT copied. The point of picking a unit is
   * usually to add the missing language or the next revision, and inheriting the
   * source's language would put the form straight into a state where the version
   * number it computed is already taken.
   */
  pickExisting(unit: LearningUnit): void {
    this.patch({
      learningUnitName: unit.learningUnitName,
      learningUnitDisplayName: unit.learningUnitDisplayName,
      learningUnitCode: unit.learningUnitCode,
      type: unit.type,
      typeCode: unit.typeCode,
      subjectCode: unit.subjectCode,
      subjectName: unit.subjectName,
      domainCode: unit.domainCode,
      domainName: unit.domainName,
      subDomainCode: unit.subDomainCode,
      subDomainName: unit.subDomainName,
      compositeCode: unit.compositeCode,
      isoCode: '',
      version: ''
    });

    this.pickedExisting.set(true);
    this.suggestionsOpen.set(false);
    this.displayNameUnlocked.set(false);
  }

  // ---- Progressive unlock -------------------------------------------------
  //
  // Editing unlocks everything: the gate exists to stop a NEW unit being
  // numbered or categorised before the inputs those depend on are known, and by
  // definition a stored unit already has them.

  readonly displayNameEnabled = computed(
    () => this.isEdit() || String(this.name()).trim() !== ''
  );

  readonly typeEnabled = computed(
    () => this.isEdit() || (this.displayNameEnabled() && String(this.displayName()).trim() !== '')
  );

  readonly languageEnabled = computed(
    () => this.isEdit() || (this.typeEnabled() && String(this.type()).trim() !== '')
  );

  /**
   * The code is locked when versioning an existing unit — a version cannot
   * change the code, that would make it a different unit.
   */
  readonly codeEnabled = computed(
    () =>
      !this.pickedExisting() &&
      (this.isEdit() || (this.languageEnabled() && String(this.isoCode()).trim() !== ''))
  );

  readonly maturityEnabled = computed(
    () => this.isEdit() || (String(this.isoCode()).trim() !== '' && this.codeValid())
  );

  // ---- Code, taxonomy, composite code ------------------------------------

  /**
   * The taxonomy row the current code resolves to.
   *
   * Everything categorical on this form reads through here, so there is exactly
   * one place the letter-pair lookup happens.
   */
  private readonly resolved = computed<TaxonomyRow | null>(() =>
    taxonomyForCode(String(this.code()), this.taxonomy())
  );

  readonly codeWellFormed = computed(() =>
    LEARNING_UNIT_CODE_PATTERN.test(String(this.code()).trim().toUpperCase())
  );

  /**
   * Whether the code is usable — well formed AND known to the taxonomy.
   *
   * Production gates Save on the same two conditions (`tacForm.valid` and its
   * own `codeValid`), because a well-formed code whose letter pair has no row
   * would be stored with six empty categorisation fields and would never appear
   * under any domain filter.
   *
   * EDITING AN UNTOUCHED CODE IS EXEMPT. Stored data predates parts of this
   * taxonomy — and predates the four-character format itself — so refusing to
   * save a description change because a code entered years ago fails today's
   * pattern would be a trap: the user cannot fix the code without changing which
   * unit it is. Touching the code drops the exemption, because a code being
   * typed now should meet the current rules.
   */
  readonly codeValid = computed(() => {
    if (this.isEdit() && this.edits()?.learningUnitCode === undefined) {
      return true;
    }

    return this.codeWellFormed() && this.resolved() !== null;
  });

  readonly codeUnknownPair = computed(
    () => this.codeWellFormed() && this.resolved() === null
  );

  /**
   * The six taxonomy values, read from the resolved row and falling back to
   * whatever is stored.
   *
   * The fallback is what makes these correct in two cases the lookup cannot
   * cover: a unit picked from the suggestions (its row is inherited wholesale,
   * including a pair this table may not list) and a stored unit being edited.
   */
  private taxonomyField(
    key: keyof TaxonomyRow,
    stored: keyof LearningUnitDraft
  ): string {
    const row = this.resolved();

    if (row && !this.pickedExisting()) {
      return row[key];
    }

    return String(this.field(stored) ?? '');
  }

  readonly subjectCode = computed(() => this.taxonomyField('subjectCode', 'subjectCode'));
  readonly subjectName = computed(() => this.taxonomyField('subjectName', 'subjectName'));
  readonly domainCode = computed(() => this.taxonomyField('domainCode', 'domainCode'));
  readonly domainName = computed(() => this.taxonomyField('domainName', 'domainName'));
  readonly subDomainCode = computed(() => this.taxonomyField('subDomainCode', 'subDomainCode'));
  readonly subDomainName = computed(() => this.taxonomyField('subDomainName', 'subDomainName'));

  /**
   * 'AE' for AE04 — the domain code and sub-domain code concatenated, which is
   * all production's composite code is.
   */
  readonly compositeCode = computed(() => {
    const row = this.resolved();

    if (row && !this.pickedExisting()) {
      return compositeCodeFor(row);
    }

    return String(this.field('compositeCode') ?? '');
  });

  /** The option lists the six selects render, from the same table. */
  readonly subjectCodeOptions = computed(() => subjectCodesOf(this.taxonomy()));
  readonly subjectNameOptions = computed(() => subjectNamesOf(this.taxonomy()));
  readonly domainCodeOptions = computed(() => domainCodesOf(this.taxonomy()));
  readonly domainNameOptions = computed(() => domainNamesOf(this.taxonomy()));
  readonly subDomainCodeOptions = computed(() => subDomainCodesOf(this.taxonomy()));
  readonly subDomainNameOptions = computed(() =>
    subDomainNamesOf(this.taxonomy(), this.subDomainCode())
  );

  // ---- Version ------------------------------------------------------------

  readonly typeCode = computed(() => {
    const stored = String(this.field('typeCode') ?? '');

    // The stored code wins while versioning: the family's id prefix is fixed,
    // and a type since renamed must not silently re-prefix it.
    return this.pickedExisting() && stored ? stored : learningUnitTypeCode(String(this.type()));
  });

  /** The pencil. Production gates this on access level 11; this app has one role. */
  readonly versionUnlocked = signal(false);
  readonly displayNameUnlocked = signal(false);

  /**
   * The version label shown in the field: 'EN-V10'.
   *
   * COMPUTED, not stored, until the pencil is used. Editing shows what is
   * stored; creating shows the next number for this code, language and type,
   * which is V10 for a family that does not exist yet and one past the highest
   * otherwise. Blank until a language is chosen, because versions run per
   * language and there is nothing to compute yet.
   */
  readonly versionLabel = computed(() => {
    const manual = this.edits()?.version;

    if (this.versionUnlocked() && manual !== undefined) {
      return `${this.isoCode()}-${storedVersionOf(String(manual))}`;
    }

    if (this.isEdit()) {
      return `${this.isoCode()}-${this.field('version')}`;
    }

    const iso = String(this.isoCode()).trim();

    if (!iso || !this.codeWellFormed()) {
      return '';
    }

    return nextVersionLabel(
      [...this.units(), ...this.trashedUnits()],
      String(this.code()).trim().toUpperCase(),
      iso,
      this.typeCode()
    );
  });

  /** 'TA-AE04-EN-V10' — shown read-only so the identity being minted is visible. */
  readonly learningUnitId = computed(() =>
    learningUnitIdOf(this.typeCode(), String(this.code()).trim().toUpperCase(), this.versionLabel())
  );

  toggleVersionEdit(): void {
    this.versionUnlocked.update(unlocked => !unlocked);
  }

  toggleDisplayNameEdit(): void {
    this.displayNameUnlocked.update(unlocked => !unlocked);
  }

  /**
   * The display name is locked after picking an existing unit, because a version
   * should carry its family's name. The pencil is the deliberate override, which
   * is exactly how production treats it.
   */
  readonly displayNameLocked = computed(
    () => this.pickedExisting() && !this.displayNameUnlocked()
  );

  // ---- Setters ------------------------------------------------------------

  setName(value: string): void {
    // Typing over a picked suggestion means this is no longer that unit's
    // version — the identity it locked has to be released with it.
    if (this.pickedExisting()) {
      this.pickedExisting.set(false);
    }

    this.suggestionsOpen.set(true);
    this.patch({ learningUnitName: value });
  }

  setDisplayName(value: string): void {
    this.patch({ learningUnitDisplayName: value });
  }

  setType(value: string): void {
    // typeCode travels WITH the name: it is half of learningUnitId, and deriving
    // it later from a name that has since been renamed would mint the wrong id.
    this.patch({ type: value, typeCode: learningUnitTypeCode(value) });
  }

  setIsoCode(value: string): void {
    // The computed version depends on the language, so a manual override made
    // for the previous language is dropped rather than carried across.
    this.versionUnlocked.set(false);
    this.patch({ isoCode: value, version: '' });
  }

  setCode(value: string): void {
    // Codes are uppercase everywhere in production ('PT12'), and a lowercase one
    // would sort apart from its siblings in every picker. Capped at four, as
    // production's maxlength does, so the pattern check is about the letters and
    // digits rather than the length.
    this.patch({ learningUnitCode: value.toUpperCase().slice(0, 4) });
  }

  setVersion(value: string): void {
    this.patch({ version: storedVersionOf(value) });
  }

  setMaturity(value: string): void {
    this.patch({ Maturity: value });
  }

  setStatus(value: string): void {
    this.patch({ status: value as LearningUnitDraft['status'] });
  }

  setShortDescription(value: string): void {
    this.patch({ shortDescription: value });
  }

  setDifficulty(value: string): void {
    this.patch({ difficultyLevel: value });
  }

  setTotalTime(value: string): void {
    const minutes = Number.parseInt(value, 10);

    // An empty or unparseable box is 0, not NaN — NaN reaches Firestore as a
    // rejected value and would fail the whole write.
    this.patch({ totalTime: Number.isFinite(minutes) && minutes > 0 ? minutes : 0 });
  }

  /**
   * A stored status outside the two the form offers, or ''.
   *
   * Production types `status` as a bare string and this app has not enumerated
   * its full vocabulary, so a row can arrive carrying 'ARCHIVED' or lowercase
   * 'live'. Without rendering it as its own option, [selected] matches nothing,
   * the browser shows the FIRST option ("Live"), and saving writes the original
   * value back — the user is shown one status and stores another.
   */
  readonly unknownStatus = computed(() => {
    const current = String(this.status() ?? '');

    return this.statuses.some(option => option.value === current) ? '' : current;
  });

  /**
   * Everything production makes required, and nothing it does not.
   *
   * Its form marks all fourteen controls `Validators.required` and additionally
   * gates the button on `codeValid`. The taxonomy six are not listed here
   * because they are not typed — they are filled from the code, so `codeValid`
   * already covers them.
   */
  readonly valid = computed(() =>
    String(this.name()).trim() !== '' &&
    String(this.displayName()).trim() !== '' &&
    String(this.type()).trim() !== '' &&
    String(this.isoCode()).trim() !== '' &&
    String(this.code()).trim() !== '' &&
    this.codeValid() &&
    this.versionLabel().trim() !== '' &&
    String(this.maturity()).trim() !== ''
  );

  /** Editing only: nothing to write. Creating is always "dirty". */
  readonly dirty = computed(() => {
    if (!this.isEdit()) {
      return true;
    }

    const edited = this.edits();

    if (!edited) {
      return false;
    }

    const base = this.base();

    return Object.entries(edited).some(
      ([key, value]) => value !== base[key as keyof LearningUnitDraft]
    );
  });

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  save(): void {
    if (this.saving() || !this.valid() || !this.dirty()) {
      return;
    }

    const name = String(this.name()).trim();

    this.submitted.emit({
      ...this.base(),
      ...(this.edits() ?? {}),
      learningUnitCode: String(this.code()).trim().toUpperCase(),
      learningUnitName: name,
      // The display name is what every list and picker renders, so it falls back
      // to the name rather than being allowed to go empty.
      learningUnitDisplayName: String(this.displayName()).trim() || name,
      type: String(this.type()).trim(),
      typeCode: this.typeCode(),
      Maturity: String(this.maturity()).trim(),
      // The stored form drops the language prefix the field shows; the document
      // already carries isoCode.
      version: storedVersionOf(this.versionLabel()),
      // Resolved, not typed — the code is the single source for all seven.
      subjectCode: this.subjectCode(),
      subjectName: this.subjectName(),
      domainCode: this.domainCode(),
      domainName: this.domainName(),
      subDomainCode: this.subDomainCode(),
      subDomainName: this.subDomainName(),
      compositeCode: this.compositeCode()
    });
  }

  close(): void {
    this.closed.emit();
  }
}

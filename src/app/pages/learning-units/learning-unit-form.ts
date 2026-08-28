import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';

import { Icon } from '../../components/icon/icon';
import {
  emptyLearningUnitDraft,
  learningUnitIdOf,
  nextVersionLabel,
  storedVersionOf
} from '../../data/learning-unit-options';
import { GRADES } from '../../data/classroom-options';
import { resourceSlotsFor } from '../../data/learning-unit-resource-slots';
import {
  LEARNING_UNIT_CODE_PATTERN,
  TaxonomyRow,
  compositeCodeFor,
  cumulativeMaturityFor,
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
import {
  BoardGradeResource,
  LearningUnit,
  LearningUnitAdditionalResource,
  LearningUnitDraft,
  LearningUnitResource,
  LearningUnitResources
} from '../../models/teaching.model';
import { ConfigurationService } from '../../services/configuration.service';
import {
  LearningUnitResourceService,
  ResourceSlotEdit
} from '../../services/learning-unit-resource.service';
import {
  BoardGradeResourceService,
  gradeKey
} from '../../services/board-grade-resource.service';
import { ResourceLinkService } from '../../services/resource-link.service';
import { ResourceUploadService, UploadResult } from '../../services/resource-upload.service';

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
/**
 * What to say when an upload is refused.
 *
 * NAMES THE TYPE AND THE SIZE. The Storage rule checks both, and a refusal comes
 * back as a bare "unauthorized" — so a message that only says "check the file
 * type and size" leaves the one useful fact, which of the two and what the value
 * was, buried in the browser console.
 */
function refusalMessage(result: UploadResult): string {
  if (result.error !== 'denied') {
    return 'The upload did not finish. Try again.';
  }

  // Guarded, because a caller may report a denial without the detail — and
  // "refused this file: undefined, undefined MB" is worse than saying nothing.
  const detail =
    result.contentType === undefined
      ? ''
      : ` this file: ${result.contentType}, ${result.sizeMb} MB.`;

  return (
    `The storage bucket refused the upload.${detail} Documents and images are ` +
    'allowed up to 25 MB, video and zip up to 500 MB.'
  );
}

/**
 * Rows per column on a resource tab, counted off the reference.
 */
/**
 * Writes text to the clipboard, with the fallback that makes it actually work.
 *
 * `navigator.clipboard` EXISTS ONLY IN A SECURE CONTEXT. On localhost it is
 * there, but the moment this app is opened over the LAN — 192.168.x.x:4200,
 * which is how anyone tests on a phone — the whole API is undefined and every
 * copy silently failed. It can also reject when the document is not focused, or
 * when the permission is denied.
 *
 * The textarea-and-execCommand path is deprecated and works everywhere, which is
 * exactly the trade wanted for a fallback. It is off-screen rather than
 * `display: none`: a hidden element cannot be selected, so the copy would
 * succeed at copying nothing.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);

      return true;
    }
  } catch {
    // Falls through to the textarea below rather than reporting failure — a
    // rejected writeText is the commonest case the fallback exists for.
  }

  const area = document.createElement('textarea');

  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);

  try {
    area.select();
    area.setSelectionRange(0, text.length);

    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

const RESOURCE_COLUMN_ROWS = 3;

/** Slots into columns of RESOURCE_COLUMN_ROWS, in schema order. */
function chunkSlots<T>(slots: readonly T[]): T[][] {
  const columns: T[][] = [];

  for (let index = 0; index < slots.length; index += RESOURCE_COLUMN_ROWS) {
    columns.push(slots.slice(index, index + RESOURCE_COLUMN_ROWS));
  }

  return columns;
}

/**
 * A minutes box, parsed the way all three timings need it.
 *
 * An empty or unparseable box is 0, not NaN — NaN reaches Firestore as a
 * rejected value and would fail the whole write. Negatives are 0 too: none of
 * the three has a meaning below zero.
 */
function minutesFrom(value: string): number {
  const minutes = Number.parseInt(value, 10);

  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

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
  /**
   * Slot edits, emitted alongside the unit's own.
   *
   * A SEPARATE OUTPUT because they land in a different collection: the unit goes
   * to learningUnits and these to learningUnitResources. The page writes both,
   * so this component stays the thing that collects edits rather than the thing
   * that persists them — which is what every other form here does.
   */
  readonly resourcesSubmitted = output<ResourceSlotEdit[]>();
  readonly closed = output<void>();

  /*
   * DECLARED FIRST, above every field that reads it. Class field initialisers run
   * in source order, so `maturities` below — a computed that calls into this —
   * would see `undefined` if the inject sat further down the class.
   */
  private config = inject(ConfigurationService);
  private resourceService = inject(LearningUnitResourceService);
  private links = inject(ResourceLinkService);
  private uploads = inject(ResourceUploadService);
  private boardGrades = inject(BoardGradeResourceService);

  /* ======================================================================
     EVERY DROPDOWN IN THIS FORM READS THE Configuration COLLECTION.
     ======================================================================
     There are eleven selects, and none of them holds a list any more. All five
     sources below are signals on ConfigurationService, seeded with the constants
     this form used to import directly — so a Firestore edit changes an option list
     without a deploy, and a refused read leaves the form working on exactly what it
     shipped with.

     COMPUTEDS, NOT CAPTURED VALUES. The collection is read once after sign-in, which
     lands AFTER this component first paints. Assigning `= this.config.x()` here would
     read the signal once at construction and pin the form to the fallback for the rest
     of the session.

     The remaining six selects — Subject Code / Name, Domain Code / Name, Sub-Domain
     Code / Name — derive from `taxonomy` below, which reads
     Configuration/learningUnitDomains. So the whole form is configuration-driven.

       Learning Unit Type        LearningUnitTypes.Types
       Select Language           LearningUnitLanguages.langTypes
       Learning Unit Maturity    learningUnitMaturity.maturity
       Status                    ProgrammeStatuses.statuses
       Difficulty                LearningUnitDifficulty.levels
       the six taxonomy selects  learningUnitDomains.domains
     ====================================================================== */

  /**
   * STATUS REUSES THE PROGRAMME DOCUMENT, on purpose.
   *
   * learning-unit-options.ts re-exports PROGRAMME_STATUSES rather than declaring its
   * own, and says why: the two vocabularies are the same two values including the same
   * preserved misspelling, and LearningUnitStatus is an alias of ProgrammeStatus. A
   * second identical document would be two things to keep in step for no gain. This is
   * the one place the form reads a document not named for learning units.
   */
  readonly statuses = computed(() => this.config.programmeStatuses());

  readonly languages = computed(() => this.config.learningUnitLanguages());
  readonly difficulties = computed(() => this.config.learningUnitDifficulty());
  /**
   * The Type dropdown's options, from Configuration.
   *
   * Same reasoning as `maturities` below — a computed off the signal, because the read
   * lands after first paint. This one matters more than most: the chosen type's `code`
   * becomes the first segment of the unit's `learningUnitId`.
   */
  readonly types = computed(() => this.config.learningUnitTypes());
  /**
   * The Maturity dropdown's options, from Configuration.
   *
   * A COMPUTED OFF THE SIGNAL, not the constant it used to be — same reasoning as
   * `taxonomy` below: the read lands after first paint, so a value captured at
   * construction would pin this to the fallback for the session.
   *
   * Names only. The ladder each name expands to is not needed until something
   * creates the per-maturity resource documents, which this form does not yet do.
   */
  readonly maturities = computed(() =>
    this.config.learningUnitMaturities().map(entry => entry.level)
  );

  readonly isEdit = computed(() => this.unit() !== null);

  /* ======================================================================
     THE EDITOR'S TABS
     ======================================================================
     Production's own thirteen, in its own order, and they apply to EDITING
     ONLY. Adding a unit is still the single progressive-unlock form below: its
     three identity fields — language, code, version — have no place on a Basic
     Info tab that never shows them, because production fixes a unit's identity
     at creation and never offers it again.

     Basic Info and Descriptions are built. The other eleven render their name
     and nothing else: the strip is the whole point of the reference, and a tab
     that is visibly empty is honest about what is not built yet, where a tab
     missing from the strip would read as a feature that does not exist.

     Short Description is on Descriptions rather than waiting for that tab to be
     built out, because the form this replaces could already edit it. A rebuild
     that quietly dropped it would be a regression dressed as a redesign. */
  readonly tabs = [
    'Basic Info',
    'Descriptions',
    'Images',
    // The media tabs run together — Video, 3S, Social Media — ahead of the two
    // development ones. This is the order production's 2D Algebraic Tiles shows,
    // and it groups what a teacher looks at before what an author works on.
    'Video',
    '3S',
    'Social Media',
    'TACDev',
    'Graphics',
    'External Resources',
    'Associated LU',
    'Additional Resources',
    'Version Changes'
  ] as const;

  readonly activeTab = signal<(typeof this.tabs)[number]>('Basic Info');

  /** The tabs with something on them. Everything else renders the empty state. */
  readonly builtTabs = new Set<string>(['Basic Info', 'Descriptions']);

  private readonly tabStrip = viewChild<ElementRef<HTMLElement>>('tabStrip');

  setTab(tab: (typeof this.tabs)[number]): void {
    this.activeTab.set(tab);
  }

  /**
   * Scrolls the strip by roughly two thirds of what is on screen.
   *
   * Not a full page: overlapping the previous view by a third keeps a tab
   * visible across the jump, so the strip reads as continuous rather than
   * replacing itself. Falls back to a fixed step if the element is not measured
   * yet, which only happens before the first paint.
   */
  scrollTabs(direction: -1 | 1): void {
    const strip = this.tabStrip()?.nativeElement;

    if (!strip) {
      return;
    }

    strip.scrollBy({ left: direction * (strip.clientWidth * 0.66 || 220), behavior: 'smooth' });
  }

  /* ---- Opening a resource -------------------------------------------------
     View turns a slot's value into something a browser can show: a link opens
     as it is, a Storage path is exchanged for a download URL first. */

  /** Set when the last View found nothing to open, so the row can say so. */
  readonly viewFailed = signal('');

  async openResource(value: string, label: string): Promise<void> {
    this.viewFailed.set('');

    if (await this.links.open(value)) {
      return;
    }

    // Either the bucket refused the read or the file is not there. Both look the
    // same from here, and both mean the same thing to whoever clicked.
    this.viewFailed.set(label);
    setTimeout(() => this.viewFailed.set(''), 4000);
  }

  /** Feedback for the Learning Unit ID copy button, cleared on a timer. */
  readonly copied = signal(false);

  /** Which slot's path was last copied, so the row can confirm it. */
  readonly copiedSlot = signal('');

  /**
   * Copies a plain slot's stored path.
   *
   * The path, not a download URL: it is what the document holds and what a
   * colleague needs to find the object. A grade-dependent slot has no single
   * path, which is why those rows carry no copy button.
   */
  async copySlotPath(category: string, slotKey: string, path: string): Promise<void> {
    if (!path) {
      return;
    }

    try {
      await navigator.clipboard?.writeText(path);
      this.copiedSlot.set(`${category}|${slotKey}`);
      setTimeout(() => this.copiedSlot.set(''), 1600);
    } catch {
      this.copiedSlot.set('');
    }
  }

  isSlotCopied(category: string, slotKey: string): boolean {
    return this.copiedSlot() === `${category}|${slotKey}`;
  }

  async copyLearningUnitId(): Promise<void> {
    const id = this.unit()?.docId ?? '';

    // clipboard is absent over plain HTTP on a non-localhost origin, and denied
    // outright in some browsers. A failed copy must not throw into the template.
    try {
      await navigator.clipboard?.writeText(id);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1600);
    } catch {
      this.copied.set(false);
    }
  }

  /**
   * The taxonomy this form looks codes up in. THREE SOURCES, in increasing priority.
   *
   *   1. LEARNING_UNIT_TAXONOMY   the 44 rows in source, the fallback
   *   2. Configuration/learningUnitDomains.domains   read at sign-in, overrides 1
   *   3. the stored units themselves   override both, per pair
   *
   * 1 AND 2 ARE THE SAME 44 ROWS until somebody edits the document, because the seed
   * wrote the document from the constant. So this reads as a no-op today and becomes
   * load-bearing the moment a row is added in the console — which is exactly what
   * moving the vocabulary into Firestore was for. A refused or empty read leaves the
   * signal holding the constant, so the dropdowns cannot go blank.
   *
   * 3 IS UNCHANGED and still last: a unit carrying a pair neither source lists is
   * still offered, so a code already in the data can always be re-selected.
   *
   * A COMPUTED OVER THE SIGNAL, not a value captured in the constructor — the read
   * completes after first paint, and destructuring it here would pin this form to the
   * fallback for the life of the session.
   */
  private readonly taxonomy = computed<TaxonomyRow[]>(() =>
    taxonomyFromUnits(
      [...this.units(), ...this.trashedUnits()] as LearningUnit[],
      this.config.learningUnitDomains()
    )
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

    /*
     * DESTRUCTURED, not listed field by field.
     *
     * LearningUnitDraft is Omit<LearningUnit, these five>, so stripping exactly
     * those five IS the draft — the compiler checks that, where a hand-written
     * literal only checked the fields someone remembered to write. The literal
     * this replaces listed twenty; the model now carries sixty, and every one
     * added to it silently went missing here until the build broke.
     */
    const {
      docId: _docId,
      learningUnitId: _learningUnitId,
      ownerId: _ownerId,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...draft
    } = unit;

    return draft;
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
  readonly longDescription = computed(() => this.field('longDescription'));
  readonly alternateShortDescription = computed(() =>
    this.field('alternateShortDescription')
  );
  readonly alternateLongDescription = computed(() =>
    this.field('alternateLongDescription')
  );
  readonly tinyDescription = computed(() => this.field('tinyDescription'));
  readonly versionNotes = computed(() => this.field('versionNotes'));

  /* ---- Images ----------------------------------------------------------
     The three slots the Images tab shows, each reporting only whether a path is
     stored. Whether a slot offers Upload or Re-upload + View is that and
     nothing more — an empty string means no file has ever been put there. */

  readonly headlineImage = computed(() => String(this.field('learningUnitImage') ?? ''));

  readonly qrCodeImage = computed(() =>
    String((this.field('resources') as LearningUnitResources | undefined)?.qrCodeImagePath ?? '')
  );

  readonly otherImage = computed(() =>
    String((this.field('resources') as LearningUnitResources | undefined)?.otherImagePath ?? '')
  );

  /**
   * The three slots as the template renders them, so the markup is one loop
   * rather than three near-identical blocks that would drift.
   */
  /* ---- The resource tabs ------------------------------------------------
     TACDev, and in time Graphics, Video, 3S and Social Media, all render the
     same thing: one category of the resource schema, for the unit's type and a
     CHOSEN maturity rung. */

  /**
   * EVERY rung, not only the ones this unit has reached.
   *
   * The cumulative ladder would be the narrower answer — a Silver unit has only
   * a Silver resource document — but the selector is also how you look ahead at
   * what a unit WILL need to carry when it is promoted, and hiding Platinum and
   * Diamond behind a promotion made that impossible to see.
   *
   * The same list the Basic Info dropdown offers, so the two cannot disagree,
   * and Configuration-backed so a rung added in Firestore appears in both.
   */
  readonly resourceMaturities = computed(() => this.maturities());

  /**
   * The rungs this unit has actually reached, and so the ones that can be
   * chosen. The ladder is cumulative: a Gold unit has a Silver document and a
   * Gold one, a Platinum unit has three, a Silver unit has one.
   *
   * The rest stay in the list and are DISABLED rather than hidden, so the whole
   * ladder is visible and it is obvious that Platinum and Diamond exist and
   * this unit has not got there yet.
   */
  private readonly reachedMaturities = computed(
    () => new Set(cumulativeMaturityFor(String(this.maturity() ?? '')))
  );

  isMaturityReached(level: string): boolean {
    return this.reachedMaturities().has(level);
  }

  /** Which rung the resource tabs are showing. Defaults to the unit's own. */
  private readonly chosenMaturity = signal('');

  readonly resourceMaturity = computed(() => {
    const chosen = this.chosenMaturity();
    const available = this.resourceMaturities();

    // Reached, not merely listed: a rung the unit has not got to cannot be shown
    // even if it was selected before the unit's maturity was lowered.
    if (chosen && available.includes(chosen) && this.isMaturityReached(chosen)) {
      return chosen;
    }

    // The unit's OWN maturity, not the first or last of the list: opening the
    // tab should show what the unit is, and looking ahead should be a
    // deliberate act rather than the default.
    const own = String(this.maturity() ?? '');

    return available.includes(own) ? own : (available[0] ?? '');
  });

  setResourceMaturity(value: string): void {
    this.chosenMaturity.set(value);
  }

  /**
   * The TACDev rows: the schema's slots for this type, rung and category.
   *
   * `path` is always empty for now. Whether a slot holds a file is recorded on
   * the unit's learningUnitResources document, which nothing reads yet — so
   * every row renders in its empty state, which is the honest answer rather
   * than a guess.
   */
  readonly tacDevSlots = computed(() =>
    resourceSlotsFor(String(this.type() ?? ''), this.resourceMaturity(), 'tacDev').map(
      slot => ({ ...slot, path: this.slotValue('tacDev', slot.key) })
    )
  );

  readonly videoSlots = computed(() =>
    resourceSlotsFor(String(this.type() ?? ''), this.resourceMaturity(), 'video').map(
      slot => ({ ...slot, path: this.slotValue('video', slot.key) })
    )
  );

  /**
   * The slots chunked into columns of three, which is how the reference lays
   * them out: three rows down, then a divider, then three more, scrolling
   * sideways. Thirteen slots stacked in one column would be a page of scrolling
   * inside a modal that already scrolls.
   *
   * Chunked here rather than in CSS because the divider belongs to the column,
   * and CSS columns give no element to hang it on.
   */
  readonly threeSSlots = computed(() =>
    resourceSlotsFor(String(this.type() ?? ''), this.resourceMaturity(), '3S').map(
      slot => ({ ...slot, path: this.slotValue('3S', slot.key) })
    )
  );

  readonly socialSlots = computed(() =>
    resourceSlotsFor(
      String(this.type() ?? ''),
      this.resourceMaturity(),
      'socialMedia'
    ).map(slot => ({ ...slot, path: this.slotValue('socialMedia', slot.key) }))
  );

  readonly graphicsSlots = computed(() =>
    resourceSlotsFor(String(this.type() ?? ''), this.resourceMaturity(), 'graphics').map(
      slot => ({ ...slot, path: this.slotValue('graphics', slot.key) })
    )
  );

  readonly tacDevColumns = computed(() => chunkSlots(this.tacDevSlots()));
  readonly videoColumns = computed(() => chunkSlots(this.videoSlots()));
  readonly threeSColumns = computed(() => chunkSlots(this.threeSSlots()));
  readonly socialColumns = computed(() => chunkSlots(this.socialSlots()));
  readonly graphicsColumns = computed(() => chunkSlots(this.graphicsSlots()));

  /**
   * True on a resource tab that has no slots at the chosen rung.
   *
   * The footer is hidden when it is: a tab showing "there is no resource
   * available" has nothing to save and nothing to cancel, so Save Changes and
   * Cancel are two dead controls under a sentence explaining why.
   */
  readonly emptyResourceTab = computed(() => {
    switch (this.activeTab()) {
      case 'TACDev':
        return this.tacDevColumns().length === 0;
      case 'Video':
        return this.videoColumns().length === 0;
      case '3S':
        return this.threeSColumns().length === 0;
      case 'Social Media':
        return this.socialColumns().length === 0;
      case 'Graphics':
        return this.graphicsColumns().length === 0;
      default:
        return false;
    }
  });

  /* ---- External Resources ------------------------------------------------
     THE ONE RESOURCE TAB WITH NO MATURITY. These nine live on the learning
     unit's own `resources` map rather than in learningUnitResources, which is
     why the reference shows no Maturity Type selector here: there is one set per
     unit, not one per rung.

     Grouped in three columns by what they belong to — the unit, the topic, the
     variation — which is how the reference lays them out, and it is not the
     three-per-column chunking the other tabs use. */

  readonly externalGroups = [
    [
      { key: 'guidePath', label: 'Learning Unit Guide' },
      { key: 'observationPath', label: 'Learning Unit Observation Sheet' },
      { key: 'materialPath', label: 'Learning Unit Materials' },
      { key: 'videoUrl', label: 'Learning Unit Video' },
      { key: 'templatePath', label: 'Learning Unit Template (Optional)' }
    ],
    [
      { key: 'topicGuidePath', label: 'Topic Guide' },
      { key: 'topicVideoUrl', label: 'Topic Video' }
    ],
    [
      { key: 'varGuidePath', label: 'VAR Guide (PDF)' },
      { key: 'varVideoUrl', label: 'VAR Video' }
    ]
  ] as const;

  /** What the unit's own resources map holds for a key. */
  unitResource(key: string): string {
    const map = this.field('resources') as LearningUnitResources | undefined;
    const value = map?.[key];

    return typeof value === 'string' ? value : '';
  }

  /**
   * Writes one key of the unit's resources map.
   *
   * Spread, not replaced: the map also carries the two maturity ids and the two
   * image paths the Images tab shows, and none of them belongs to this tab.
   */
  setUnitResource(key: string, value: string): void {
    const map = (this.field('resources') ?? {}) as LearningUnitResources;

    this.patch({ resources: { ...map, [key]: value } });
  }

  /** A link is typed; a path is uploaded. Same rule the Video tab uses. */
  isUrlResource(key: string): boolean {
    return /url$/i.test(key);
  }

  /**
   * How far the upload in flight has got, 0-100.
   *
   * ONE signal, not one per slot, for the same reason there is one
   * `uploadError`: every picker disables its own button while its upload runs,
   * so the label that reads this is always the label of the file being sent.
   *
   * It exists because the Storage rules allow a 500 MB video and the old
   * single-shot upload reported nothing at all — the button read "Uploading…"
   * from the first byte to the last, which is indistinguishable from a hang.
   */
  readonly uploadPercent = signal(0);

  /** Forwarded to ResourceUploadService, which drives it off bytesTransferred. */
  private readonly onUploadProgress = (percent: number): void => {
    this.uploadPercent.set(percent);
  };

  /** Which external resource slot is uploading, by key, or ''. */
  readonly uploadingUnitResource = signal('');

  /**
   * Uploads a file for one of the unit's own resource slots.
   *
   * These six are the guides, worksheets and materials on the External
   * Resources tab. Unlike the resource tabs, they live on the LEARNING UNIT's
   * own `resources` map rather than on a maturity rung — there is one set per
   * unit — so the path is patched into the draft and saved with the unit.
   */
  async uploadUnitResource(key: string, label: string, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const docId = this.unit()?.docId;

    input.value = '';

    if (!file || !docId) {
      return;
    }

    this.uploadError.set('');
    this.uploadingUnitResource.set(key);

    const result = await this.uploads.upload(docId, file, '', this.onUploadProgress);

    this.uploadingUnitResource.set('');

    if (result.path) {
      this.setUnitResource(key, result.path);

      return;
    }

    this.uploadError.set(`${label}: ${refusalMessage(result)}`);
  }

  /* ---- Associated LU ------------------------------------------------------
     Three lists of other learning units, all behaving identically: a row of
     chips, a + that opens a searchable picker, an x on each chip. Held as
     docIds — the half of a unit's identity that cannot change — and rendered
     through the units() this form already receives for its name suggestions. */

  readonly luLists = [
    { key: 'associatedLearningUnits', label: 'Associated Learning Units' },
    { key: 'prerequisiteLearningUnits', label: 'Prerequisite Learning Units' },
    { key: 'similarLearningUnits', label: 'Similar Learning Units' }
  ] as const;

  /** Which list the picker is open for, by draft key, or null. */
  readonly luPickerFor = signal<string | null>(null);
  readonly luQuery = signal('');

  /** The ids currently in one list. */
  luPicked(key: string): string[] {
    return (this.field(key as keyof LearningUnitDraft) ?? []) as string[];
  }

  /**
   * 'Food Web Model (Sunboard) (V11)' — display name and version, as the
   * reference labels them. Falls back to the id for a unit that is not in the
   * list this form was given, which can happen for one that has since been
   * deleted.
   */
  luLabel(docId: string): string {
    const found = this.units().find(unit => unit.docId === docId);

    if (!found) {
      return docId;
    }

    const name = found.learningUnitDisplayName || found.learningUnitName;

    return found.version ? `${name} (${found.version})` : name;
  }

  /** Every unit that could be picked: all of them except the one being edited. */
  readonly luMatches = computed(() => {
    const needle = this.luQuery().trim().toLowerCase();
    const self = this.unit()?.docId;

    return this.units().filter(unit => {
      if (unit.docId === self) {
        return false;
      }

      if (needle === '') {
        return true;
      }

      const name = `${unit.learningUnitDisplayName} ${unit.learningUnitName} ${unit.learningUnitCode}`;

      return name.toLowerCase().includes(needle);
    });
  });

  openLuPicker(key: string): void {
    this.luQuery.set('');
    this.luPickerFor.set(key);
  }

  closeLuPicker(): void {
    this.luPickerFor.set(null);
  }

  setLuQuery(value: string): void {
    this.luQuery.set(value);
  }

  isLuPicked(key: string, docId: string): boolean {
    return this.luPicked(key).includes(docId);
  }

  toggleLu(key: string, docId: string): void {
    const current = this.luPicked(key);

    this.patch({
      [key]: current.includes(docId)
        ? current.filter(id => id !== docId)
        : [...current, docId]
    } as Partial<LearningUnitDraft>);
  }

  removeLu(key: string, docId: string): void {
    this.patch({
      [key]: this.luPicked(key).filter(id => id !== docId)
    } as Partial<LearningUnitDraft>);
  }

  /* ---- The board-and-grade dialog ---------------------------------------
     A grade-dependent slot does not hold ONE file. It holds a fallback and, per
     board and grade, an override — so uploading to one has to ask WHICH before
     it can ask for a file. That is what the reference's dialog is for, and why
     it opens from Observation Worksheet but not from Dev Guide (PDF). */

  /* ---- The stored resource documents -------------------------------------
     One per maturity rung, read when the editor opens. Empty until they load,
     and empty for good if the read is denied — see the service. */

  private readonly storedResources = signal<Map<string, LearningUnitResource>>(new Map());

  /** Everything filed against this unit by board and grade, across every slot. */
  private readonly storedBoardGrades = signal<readonly BoardGradeResource[]>([]);

  /** Slot edits made on this visit, keyed maturity|category|key. */
  private readonly slotEdits = signal<Map<string, ResourceSlotEdit>>(new Map());

  constructor() {
    // Reloads whenever the editor is opened on a different unit. The read is
    // owned here rather than by the page because it is the tabs that need it,
    // and nothing outside this component looks at a resource document.
    effect(() => {
      const unit = this.unit();

      this.slotEdits.set(new Map());
      this.storedResources.set(new Map());
      this.boardGradeFiled.set(false);

      if (!unit) {
        return;
      }

      void this.resourceService
        .byMaturity(unit.docId)
        .then(found => this.storedResources.set(found));

      void this.reloadBoardGrades();
    });
  }

  /** Re-reads what is filed by board and grade, so a Submit shows up at once. */
  private async reloadBoardGrades(): Promise<void> {
    const unit = this.unit();

    this.storedBoardGrades.set(unit ? await this.boardGrades.forUnit(unit.docId) : []);
  }

  /**
   * What a GRADE-DEPENDENT slot holds, from the board-and-grade collection.
   *
   * A slot like Observation Worksheet has no single file — it has one per board
   * and grade — so there is nothing to put in the rung document and its path
   * there stays empty. This looks in the other collection instead.
   *
   * Newest first, so View opens the most recently filed one.
   */
  boardGradeFilings(category: string, slotKey: string): { label: string; path: string }[] {
    const maturity = this.resourceMaturity();

    return this.storedBoardGrades()
      .filter(
        row =>
          row.category === category && row.subCategory === slotKey && row.maturity === maturity
      )
      .flatMap(row =>
        Object.entries(row.resources)
          .filter(([, path]) => path)
          .map(([grade, path]) => ({
            label: `${row.board} · ${grade.replace('grade_0', 'Grade ').replace('grade_', 'Grade ')}`,
            path,
            at: row.updatedAt?.toMillis?.() ?? 0
          }))
      )
      .sort((a, b) => b.at - a.at)
      .map(({ label, path }) => ({ label, path }));
  }

  /** The one View opens: the most recently filed. '' when the slot has none. */
  boardGradePath(category: string, slotKey: string): string {
    return this.boardGradeFilings(category, slotKey)[0]?.path ?? '';
  }

  /** How many board-and-grade files a slot holds, for the row to show. */
  boardGradeCount(category: string, slotKey: string): number {
    return this.boardGradeFilings(category, slotKey).length;
  }

  /**
   * What a slot holds: the edit if one has been made, otherwise what is stored.
   *
   * Grade-dependent slots read their fallback path, because that is the one a
   * row without a board and grade is showing.
   */
  slotValue(category: string, key: string): string {
    const maturity = this.resourceMaturity();
    const edited = this.slotEdits().get(`${maturity}|${category}|${key}`);

    if (edited) {
      return edited.value;
    }

    const stored = this.storedResources().get(maturity)?.resources?.[category]?.[key];

    if (typeof stored === 'string') {
      return stored;
    }

    if (stored && typeof stored === 'object') {
      return String(stored['universalGradeBoardResourcePath'] ?? '');
    }

    return '';
  }

  setSlotValue(category: string, key: string, value: string): void {
    const maturity = this.resourceMaturity();

    this.slotEdits.update(current => {
      const next = new Map(current);
      next.set(`${maturity}|${category}|${key}`, { maturity, category, key, value });

      return next;
    });
  }

  /** The slot the dialog is collecting a board and grade for, or null. */
  readonly boardGradeSlot = signal<{ key: string; label: string } | null>(null);
  /** Which category that slot belongs to — the sheet writes it on the document. */
  readonly boardGradeCategory = signal('');
  /** The file chosen in the sheet, held until Submit. */
  readonly boardGradeFile = signal<File | null>(null);
  readonly boardGradeSaving = signal(false);
  readonly boardGradeDone = signal('');

  /**
   * Set once a file has been filed by board and grade.
   *
   * It exists to wake Save Changes up. The filing itself is ALREADY durable —
   * the sheet writes to boardGradeResources on Submit, because the boards and
   * grades it collects have nowhere to live in the editor's draft — so there is
   * nothing here for Save to persist.
   *
   * A greyed Save after a visible action reads as "that did not take", though,
   * and the cost of the alternative is one harmless rewrite of the unit's own
   * fields with the values they already hold.
   */
  readonly boardGradeFiled = signal(false);

  readonly boardQuery = signal('');

  /**
   * SEVERAL of each, not one.
   *
   * A file is rarely for one board and one grade — the same worksheet usually
   * covers CBSE and ICSE, or grades 6 to 8 — and repeating the whole dialog per
   * combination is the flow this replaces.
   */
  readonly chosenBoards = signal<string[]>([]);
  readonly chosenGrades = signal<string[]>([]);

  readonly boards = computed(() => this.config.boards());
  readonly grades = computed(() => this.config.grades());

  /** Boards matching what has been typed. The field is an autocomplete, not a select. */
  readonly boardMatches = computed(() => {
    const needle = this.boardQuery().trim().toLowerCase();

    if (needle === '') {
      return this.boards();
    }

    // Both, so typing either the code or the full name finds the row.
    return this.boards().filter(board =>
      `${board.label} ${board.code}`.toLowerCase().includes(needle)
    );
  });

  /** What the closed field shows: the codes, joined, as production does. */
  readonly boardSummary = computed(() => this.chosenBoards().join(', '));

  readonly gradeSummary = computed(() =>
    this.chosenGrades().map(grade => this.gradeLabel(grade)).join(', ')
  );

  /**
   * `category` is REQUIRED, with no default.
   *
   * It is written onto the BoardGradeResources document, and three tabs open
   * this sheet — TACDev, 3S and Graphics. A default would quietly file one tab's
   * file under another's category, which nothing downstream would flag.
   */
  openBoardGrade(slot: { key: string; label: string }, category: string): void {
    this.boardGradeCategory.set(category);
    this.boardGradeFile.set(null);
    this.boardGradeDone.set('');
    this.boardGradeSlot.set(slot);
    this.boardQuery.set('');
    this.chosenBoards.set([]);
    this.chosenGrades.set([]);
    this.closePickers();
  }

  /* The two panels. One at a time: open together they would overlap, since the
     grade list sits directly under the board field. */
  readonly boardsOpen = signal(false);
  readonly gradesOpen = signal(false);

  openBoards(): void {
    this.gradesOpen.set(false);
    this.boardsOpen.set(true);
  }

  openGrades(): void {
    this.boardsOpen.set(false);
    this.gradesOpen.set(true);
  }

  closePickers(): void {
    this.boardsOpen.set(false);
    this.gradesOpen.set(false);
  }

  /**
   * A click inside the sheet, which both closes an open picker and stops the
   * backdrop from seeing it.
   *
   * The picker closes only when the click landed outside one — otherwise ticking
   * a second board would shut the list after the first.
   */
  onSheetClick(event: Event): void {
    event.stopPropagation();

    if (!(event.target as HTMLElement | null)?.closest('.multi')) {
      this.closePickers();
    }
  }

  /**
   * 'Grade 5' for '5', and 'Pre-primary 1' untouched.
   *
   * The stored value is the bare grade — GRADES holds '1' through '10' and three
   * pre-primary names — and production's list prefixes only the numbered ones.
   */
  gradeLabel(grade: string): string {
    return /^\d+$/.test(grade) ? `Grade ${grade}` : grade;
  }

  toggleBoard(label: string): void {
    this.chosenBoards.update(current =>
      current.includes(label) ? current.filter(x => x !== label) : [...current, label]
    );
  }

  toggleGrade(grade: string): void {
    this.chosenGrades.update(current =>
      current.includes(grade) ? current.filter(x => x !== grade) : [...current, grade]
    );
  }

  isBoardChosen(label: string): boolean {
    return this.chosenBoards().includes(label);
  }

  isGradeChosen(grade: string): boolean {
    return this.chosenGrades().includes(grade);
  }

  /* ======================================================================
     THE BOARD x GRADE GRID

     Production's own surface for a grade-dependent slot: grades across the top,
     boards down the side, and every cell its own file. Its markup is
     view-resources.component.html — a header row of `grades`, a "Universal Board
     and Grade" row, then one row per board in `filteredResourceInfo`, which is
     the slot object minus the universal key.

     ROWS ARE THE BOARDS ALREADY FILED, exactly as production's are. A board with
     nothing against it has no row, and no row means no cell to upload into — so
     the multi-select sheet is KEPT, reached by "Add board", as the way a board
     first gets a document. Production has no equivalent and simply cannot add
     one from this screen.
     ====================================================================== */

  /**
   * The slot whose board x grade page is open, and its category.
   *
   * SEPARATE from boardGradeSlot, which belongs to the upload sheet. The two are
   * different surfaces reached from different buttons on the same row — Upload
   * opens the sheet, View opens this page — and sharing one signal made opening
   * either one open the other.
   */
  readonly boardGridSlot = signal<{ key: string; label: string } | null>(null);
  readonly boardGridCategory = signal('');

  openBoardGrid(slot: { key: string; label: string }, category: string): void {
    this.boardGridCategory.set(category);
    this.boardGridSlot.set(slot);
    this.boardGradeDone.set('');
    this.closePickers();
  }

  closeBoardGrid(): void {
    this.boardGridSlot.set(null);
  }

  /**
   * The grade columns — EVERY grade, and always the whole vocabulary.
   *
   * TWO THINGS WENT WRONG HERE, and they had different causes.
   *
   * Grades 9 and 10 could vanish because this read `config.grades()`, which is
   * overwritten from Firestore. Production's own `grades` document holds
   * ['3','4'] — a default-seeding pair, not a vocabulary, as the note in
   * core/configuration.ts warns — so a synced list could shrink the grid to two
   * columns. GRADES is unioned in as a floor, so the grid always spans the full
   * ladder no matter what that document says.
   *
   * The three pre-primary years were dropped on purpose and should not have
   * been: gradeKey() returns '' for a non-numeric grade because production has
   * no key for one, and this filtered those columns out. They are columns a
   * teacher expects to file against, so gradeKey() now mints a key for them
   * instead — see the note there on the shape it writes.
   */
  readonly gradeColumns = computed(() => {
    const configured = this.grades();
    const ordered = [...configured, ...GRADES.filter(grade => !configured.includes(grade))];

    return ordered
      .map(grade => ({ grade, key: gradeKey(grade), label: this.gradeLabel(grade) }))
      .filter(column => column.key !== '');
  });

  /** The board rows for the open slot, alphabetical so the order is stable. */
  readonly boardGradeRows = computed(() => {
    const slot = this.boardGridSlot();

    if (!slot) {
      return [];
    }

    const category = this.boardGridCategory();
    const maturity = this.resourceMaturity();

    return this.storedBoardGrades()
      .filter(
        row =>
          row.category === category &&
          row.subCategory === slot.key &&
          row.maturity === maturity
      )
      .map(row => ({ board: row.board, resources: row.resources }))
      .sort((a, b) => a.board.localeCompare(b.board));
  });

  /** What is filed in one cell, or '' — which is what an empty cell renders. */
  cellPath(row: { resources: Record<string, string> }, gradeColumnKey: string): string {
    return row.resources[gradeColumnKey] ?? '';
  }

  /** True where the open slot is a pasted link rather than an uploaded file. */
  readonly boardGradeIsUrl = computed(() => {
    const slot = this.boardGridSlot();

    if (!slot) {
      return false;
    }

    const slots = resourceSlotsFor(
      String(this.type() ?? ''),
      this.resourceMaturity(),
      this.boardGridCategory()
    );

    return slots.find(row => row.key === slot.key)?.url ?? false;
  });

  /** The universal fallback: one file for every board and grade at once. */
  universalPath(): string {
    const slot = this.boardGridSlot();

    return slot ? this.slotValue(this.boardGridCategory(), slot.key) : '';
  }

  /** The cell currently uploading, as 'board|grade_07', or ''. */
  readonly uploadingCell = signal('');

  /**
   * Puts one file in one cell.
   *
   * The upload and the two writes are sequential because each needs the last:
   * the path comes from Storage, the document id comes from the write that uses
   * that path, and the rung's link needs that id. A failure at any step leaves
   * the ones before it done, which is why the cell reports rather than silently
   * reverting — the file IS in Storage.
   */
  async uploadCell(board: string, gradeColumnKey: string, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const unit = this.unit();
    const slot = this.boardGridSlot();

    input.value = '';

    if (!file || !unit || !slot) {
      return;
    }

    this.uploadError.set('');
    this.uploadingCell.set(`${board}|${gradeColumnKey}`);

    const uploaded = await this.uploads.upload(
      unit.docId,
      file,
      'GradeDependentResources',
      this.onUploadProgress
    );

    if (!uploaded.path) {
      this.uploadingCell.set('');
      this.uploadError.set(refusalMessage(uploaded));

      return;
    }

    await this.writeCell(board, gradeColumnKey, uploaded.path);
    this.uploadingCell.set('');
  }

  /** The URL variant of the same cell, for a slot that holds links. */
  async setCellUrl(board: string, gradeColumnKey: string, event: Event): Promise<void> {
    await this.writeCell(board, gradeColumnKey, this.valueOf(event).trim());
  }

  /**
   * Writes one cell and links the board, then refreshes what the grid reads.
   *
   * The link is written EVERY time rather than only on creation. It is a set of
   * the same id to the same key when the board already had a document, which
   * costs one field on a write that is happening anyway, and it repairs a slot
   * whose link was lost — which is the state every board filed before this grid
   * existed could be in.
   */
  private async writeCell(board: string, gradeColumnKey: string, path: string): Promise<void> {
    const unit = this.unit();
    const slot = this.boardGridSlot();

    if (!unit || !slot) {
      return;
    }

    const category = this.boardGridCategory();
    const maturity = this.resourceMaturity();

    try {
      const docId = await this.boardGrades.setCell(unit, {
        maturity,
        category,
        subCategory: slot.key,
        board,
        gradeKey: gradeColumnKey,
        path
      });

      if (docId) {
        await this.resourceService.linkBoardDocuments(unit, maturity, category, slot.key, {
          [board]: docId
        });
      }

      await this.reloadBoardGrades();
    } catch {
      this.uploadError.set('The file uploaded, but it could not be filed against that cell.');
    }
  }

  /** The cell currently uploading in the Universal row. */
  readonly uploadingUniversal = signal(false);

  /**
   * The Universal row: one file standing in for every board and grade.
   *
   * It writes the rung slot's own path, NOT a board document — which is what
   * `universalGradeBoardResourcePath` is, and why production strips that key out
   * of the object it builds the board rows from. Staged through setSlotValue
   * like every other slot edit, so it lands with Save rather than on its own.
   */
  async uploadUniversal(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const unit = this.unit();
    const slot = this.boardGridSlot();

    input.value = '';

    if (!file || !unit || !slot) {
      return;
    }

    this.uploadError.set('');
    this.uploadingUniversal.set(true);

    const uploaded = await this.uploads.upload(
      unit.docId,
      file,
      'GradeDependentResources',
      this.onUploadProgress
    );

    this.uploadingUniversal.set(false);

    if (!uploaded.path) {
      this.uploadError.set(refusalMessage(uploaded));

      return;
    }

    this.setSlotValue(this.boardGridCategory(), slot.key, uploaded.path);
  }

  /** The URL variant of the Universal row. */
  setUniversalUrl(event: Event): void {
    const slot = this.boardGridSlot();

    if (slot) {
      this.setSlotValue(this.boardGridCategory(), slot.key, this.valueOf(event).trim());
    }
  }

  /**
   * The path just copied, so its own button can confirm it.
   *
   * The message at the foot of the panel is not enough on its own: the panel is
   * 80vh tall and the cell copied from can be anywhere in it, so a line at the
   * bottom is feedback the user never sees — which reads as the button doing
   * nothing at all.
   */
  readonly copiedCell = signal('');
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  /** The Universal row's cell id. Not a board, so it cannot collide with one. */
  readonly universalCell = '__universal__';

  /**
   * Copies the file's own name — production's copy button, same tooltip.
   *
   * KEYED BY CELL, NOT BY PATH. This compared the copied PATH against each
   * cell's path, and the upload sheet files ONE file across every board and
   * grade chosen — so a path is shared by many cells by design, and copying any
   * one of them lit the tick on all of them. `cell` is 'CBSE|grade_03', which is
   * unique to the cell that was clicked.
   */
  async copyCellName(cell: string, path: string): Promise<void> {
    const name = path.split('/').pop() ?? '';

    if (!name) {
      return;
    }

    const copied = await copyText(name);

    if (this.copiedTimer !== null) {
      clearTimeout(this.copiedTimer);
    }

    this.boardGradeDone.set(copied ? `Copied ${name}` : 'Could not copy that file name.');
    this.copiedCell.set(copied ? cell : '');

    // Clears itself, so a stale "Copied" cannot be mistaken for the result of
    // the NEXT copy.
    this.copiedTimer = setTimeout(() => {
      this.copiedCell.set('');
      this.boardGradeDone.set('');
      this.copiedTimer = null;
    }, 2000);
  }

  closeBoardGrade(): void {
    this.boardGradeSlot.set(null);
  }

  setBoardQuery(value: string): void {
    this.boardQuery.set(value);
  }

  chooseBoardGradeFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.boardGradeFile.set(input.files?.[0] ?? null);
    input.value = '';
  }

  /**
   * Uploads the chosen file and files it against every board and grade picked.
   *
   * TWO WRITES, deliberately in this order: the file goes to Storage first,
   * because a document pointing at an object that does not exist is worse than
   * an object nothing points at. The second is one document per board, with a
   * key per grade.
   *
   * This does NOT wait for Save Changes. The sheet is its own transaction — it
   * has its own Submit, and the boards and grades it collected have nowhere to
   * live in the editor's draft.
   */
  async submitBoardGrade(): Promise<void> {
    const slot = this.boardGradeSlot();
    const unit = this.unit();
    const file = this.boardGradeFile();

    if (!slot || !unit || !file || !this.boardGradeReady()) {
      return;
    }

    this.boardGradeSaving.set(true);
    this.uploadError.set('');

    const uploaded = await this.uploads.upload(
      unit.docId,
      file,
      'GradeDependentResources',
      this.onUploadProgress
    );

    if (!uploaded.path) {
      this.boardGradeSaving.set(false);
      this.uploadError.set(refusalMessage(uploaded));

      return;
    }

    try {
      const maturity = this.resourceMaturity();
      const category = this.boardGradeCategory();

      const byBoard = await this.boardGrades.apply(unit, {
        maturity,
        category,
        subCategory: slot.key,
        boards: this.chosenBoards(),
        grades: this.chosenGrades(),
        path: uploaded.path
      });

      // And point the rung document's own slot at those documents, which is what
      // makes the file visible in the resources map rather than only in the
      // board-and-grade collection.
      await this.resourceService.linkBoardDocuments(
        unit,
        maturity,
        category,
        slot.key,
        byBoard
      );

      // Re-read the rung documents too, so the slot reflects the new link.
      this.storedResources.set(await this.resourceService.byMaturity(unit.docId));

      // Re-read before the sheet closes, so the row behind it shows its View
      // lit the moment the sheet goes rather than on the next editor open.
      await this.reloadBoardGrades();

      this.boardGradeDone.set(
        `Filed for ${this.chosenBoards().join(', ')} · ${this.chosenGrades().length} grade(s)`
      );
      this.boardGradeFile.set(null);
      this.boardGradeFiled.set(true);

      // Closed on a short delay, so the confirmation is readable first.
      setTimeout(() => this.closeBoardGrade(), 1200);
    } catch {
      this.uploadError.set('The file uploaded, but it could not be filed. Try Submit again.');
    }

    this.boardGradeSaving.set(false);
  }

  /**
   * BOTH are required — production marks Select Grade with an asterisk too, and
   * a file attached to boards but no grade could not be filed anywhere.
   */
  readonly boardGradeReady = computed(
    () => this.chosenBoards().length > 0 && this.chosenGrades().length > 0
  );

  /**
   * The three image slots, and the three DIFFERENT places they are stored.
   *
   * The headline is a field on the unit; the other two are keys inside its
   * `resources` map. `key` says which, and `fileBase` is the name the file takes
   * in Storage — production's headline is 'learningUnitImage.jpg', so a fixed
   * name per slot both matches it and means a re-upload REPLACES the file rather
   * than leaving the old one orphaned in the bucket.
   */
  readonly imageSlots = computed(() => [
    { key: 'learningUnitImage', fileBase: 'learningUnitImage', label: 'Head Line Image', path: this.headlineImage() },
    { key: 'qrCodeImagePath', fileBase: 'qrCodeImage', label: 'QR Code Image', path: this.qrCodeImage() },
    { key: 'otherImagePath', fileBase: 'otherImage', label: 'Other Image', path: this.otherImage() }
  ]);

  /** Writes an image path to whichever of the two places that slot lives in. */
  private setImagePath(key: string, path: string): void {
    if (key === 'learningUnitImage') {
      this.patch({ learningUnitImage: path });

      return;
    }

    this.setUnitResource(key, path);
  }

  /** The slot currently uploading, by key, or ''. */
  readonly uploadingImage = signal('');

  async uploadImage(
    slot: { key: string; fileBase: string; label: string },
    event: Event
  ): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const docId = this.unit()?.docId;

    input.value = '';

    if (!file || !docId) {
      return;
    }

    this.uploadError.set('');
    this.uploadingImage.set(slot.key);

    // A fixed name per slot, keeping only the file's own extension.
    const extension = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
    const named = new File([file], `${slot.fileBase}.${extension}`, { type: file.type });

    const result = await this.uploads.upload(docId, named, '', this.onUploadProgress);

    this.uploadingImage.set('');

    if (result.path) {
      this.setImagePath(slot.key, result.path);

      return;
    }

    this.uploadError.set(refusalMessage(result));
  }
  readonly difficultyLevel = computed(() => this.field('difficultyLevel'));
  readonly exploreTime = computed(() => this.field('exploreTime'));
  readonly learnTime = computed(() => this.field('learnTime'));
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

  setLongDescription(value: string): void {
    this.patch({ longDescription: value });
  }

  setAlternateShortDescription(value: string): void {
    this.patch({ alternateShortDescription: value });
  }

  setAlternateLongDescription(value: string): void {
    this.patch({ alternateLongDescription: value });
  }

  setTinyDescription(value: string): void {
    this.patch({ tinyDescription: value });
  }

  setVersionNotes(value: string): void {
    this.patch({ versionNotes: value });
  }

  /* ---- Additional Resources ---------------------------------------------
     An array on the unit itself, edited in place. Held as a whole rather than
     per-field because adding and removing a card changes its length, and a
     patch of one index would not survive that. */

  readonly additionalResources = computed(
    () => (this.field('additionalResources') ?? []) as LearningUnitAdditionalResource[]
  );

  /**
   * The three the reference's select offers, and what each one stores.
   *
   * Production splits the choice across TWO fields: `type` says how the resource
   * arrives — only ever 'UPLOAD' or 'VIDEO' across all 538 of its entries — and
   * `fileExtension` says what it is. 'Upload PPT' writes 'pptx' rather than
   * 'ppt' because that is the majority by five to one and the modern format;
   * both read back fine.
   */
  readonly fileTypes = [
    { label: 'Upload PDF', type: 'UPLOAD' as const, fileExtension: 'pdf' },
    { label: 'Youtube Link', type: 'VIDEO' as const, fileExtension: 'video' },
    { label: 'Upload PPT', type: 'UPLOAD' as const, fileExtension: 'pptx' }
  ];

  /** The label for what a row currently holds, so the select can show it. */
  fileTypeLabel(row: LearningUnitAdditionalResource): string {
    return (
      this.fileTypes.find(
        option => option.type === row.type && option.fileExtension === row.fileExtension
      )?.label ?? ''
    );
  }

  addResource(): void {
    this.patch({
      additionalResources: [
        ...this.additionalResources(),
        {
          title: '',
          shortdescription: '',
          type: '',
          fileExtension: '',
          resourcePath: '',
          publish: false
        }
      ]
    });
  }

  /* ---- Uploading a resource file -----------------------------------------
     Only the two UPLOAD types take a file; a VIDEO is a pasted link. */

  /** The row currently uploading, by index, or null. */
  readonly uploadingRow = signal<number | null>(null);
  readonly uploadError = signal('');

  /** What the file picker will accept, from the chosen type. */
  acceptFor(row: LearningUnitAdditionalResource): string {
    return row.fileExtension === 'pdf' ? '.pdf,application/pdf' : '.ppt,.pptx';
  }

  /**
   * What the resource tabs and the board-and-grade sheet accept.
   *
   * Kept in one place because it has to agree with the Storage rule: a picker
   * that offers a type the rule refuses produces an upload that fails at the
   * last step, which is the most annoying way to find out.
   */
  readonly documentAccept =
    '.pdf,.doc,.docx,.ppt,.pptx,application/pdf,application/msword,' +
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
    'application/vnd.ms-powerpoint,' +
    'application/vnd.openxmlformats-officedocument.presentationml.presentation,image/*';

  /**
   * Uploads the chosen file and stores its PATH on the resource.
   *
   * The unit has to exist first: the path is built from its document id, so
   * there is nowhere to put a file for a unit that has not been created. Add
   * collects no resources, so that cannot happen from the UI, but the guard
   * keeps it honest.
   */
  async uploadResourceFile(index: number, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const docId = this.unit()?.docId;

    // Cleared so choosing the same file twice in a row fires again.
    input.value = '';

    if (!file || !docId) {
      return;
    }

    this.uploadError.set('');
    this.uploadingRow.set(index);

    const result = await this.uploads.upload(docId, file, '', this.onUploadProgress);

    this.uploadingRow.set(null);

    if (result.path) {
      this.updateResource(index, 'resourcePath', result.path);

      return;
    }

    this.uploadError.set(refusalMessage(result));
  }

  /**
   * Uploads a file into one slot of a resource tab.
   *
   * The slot's value is a PATH in the rung's resource document, so the upload
   * and the Firestore write are two steps: the file lands in the bucket now, and
   * the path reaches learningUnitResources when the editor is saved.
   *
   * The file keeps its own name, as production's resource paths do — those read
   * 'learningUnits/{docId}/TABP11TA52ENV18 Measure - Leaf Area.pdf'. Re-uploading
   * under a different name leaves the old object behind; the image slots avoid
   * that with a fixed name, but a resource file's name is meaningful and worth
   * keeping.
   */
  readonly uploadingSlot = signal('');

  async uploadSlotFile(category: string, slotKey: string, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const docId = this.unit()?.docId;

    input.value = '';

    if (!file || !docId) {
      return;
    }

    this.uploadError.set('');
    this.uploadingSlot.set(`${category}|${slotKey}`);

    const result = await this.uploads.upload(docId, file, '', this.onUploadProgress);

    this.uploadingSlot.set('');

    if (result.path) {
      this.setSlotValue(category, slotKey, result.path);

      return;
    }

    this.uploadError.set(refusalMessage(result));
  }

  isSlotUploading(category: string, slotKey: string): boolean {
    return this.uploadingSlot() === `${category}|${slotKey}`;
  }

  /** The select carries a label; the document carries the pair behind it. */
  setResourceFileType(index: number, label: string): void {
    const chosen = this.fileTypes.find(option => option.label === label);

    this.patch({
      additionalResources: this.additionalResources().map((row, at) =>
        at === index
          ? { ...row, type: chosen?.type ?? '', fileExtension: chosen?.fileExtension ?? '' }
          : row
      )
    });
  }

  setResourcePublish(index: number, value: string): void {
    this.patch({
      additionalResources: this.additionalResources().map((row, at) =>
        at === index ? { ...row, publish: value === 'true' } : row
      )
    });
  }

  removeResource(index: number): void {
    this.patch({
      additionalResources: this.additionalResources().filter((_row, at) => at !== index)
    });
  }

  updateResource(
    index: number,
    field: keyof LearningUnitAdditionalResource,
    value: string
  ): void {
    this.patch({
      additionalResources: this.additionalResources().map((row, at) =>
        at === index ? { ...row, [field]: value } : row
      )
    });
  }

  setDifficulty(value: string): void {
    this.patch({ difficultyLevel: value });
  }

  setTotalTime(value: string): void {
    this.patch({ totalTime: minutesFrom(value) });
  }

  setExploreTime(value: string): void {
    this.patch({ exploreTime: minutesFrom(value) });
  }

  setLearnTime(value: string): void {
    this.patch({ learnTime: minutesFrom(value) });
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

    return this.statuses().some(option => option.value === current) ? '' : current;
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
    String(this.maturity()).trim() !== '' &&
    this.additionalResourcesValid()
  );

  /**
   * Every additional resource needs a title and a file type.
   *
   * Both are marked required on the reference's own form, and the card starts
   * EMPTY: adding one makes the editor dirty, so without this Save came alive
   * over a card with nothing in it and would have written a resource that is
   * neither named nor of any type.
   *
   * A resource with no PATH is still valid — the path arrives with the upload,
   * which needs Cloud Storage.
   */
  readonly additionalResourcesValid = computed(() =>
    this.additionalResources().every(row => row.title.trim() !== '' && row.type !== '')
  );

  /** Editing only: nothing to write. Creating is always "dirty". */
  readonly dirty = computed(() => {
    if (!this.isEdit()) {
      return true;
    }

    if (this.slotsDirty() || this.boardGradeFiled()) {
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

  /** True when a slot has been edited, which makes the editor dirty on its own. */
  readonly slotsDirty = computed(() => this.slotEdits().size > 0);

  save(): void {
    if (this.saving() || !this.valid() || !this.dirty()) {
      return;
    }

    // Emitted first, so the page has them before it starts writing the unit.
    if (this.slotEdits().size > 0) {
      this.resourcesSubmitted.emit([...this.slotEdits().values()]);
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

  /**
   * LAYERED. Escape and the editor's own close both land here, and they must
   * dismiss the TOP surface rather than the whole editor.
   *
   * The board x grade page is a fixed, viewport-level overlay: before this,
   * Escape over it closed the editor underneath and took the page with it,
   * losing whatever was typed in the form behind. Checked in stacking order,
   * page first.
   */
  close(): void {
    if (this.boardGridSlot()) {
      this.closeBoardGrid();

      return;
    }

    if (this.boardGradeSlot()) {
      this.closeBoardGrade();

      return;
    }

    this.closed.emit();
  }
}

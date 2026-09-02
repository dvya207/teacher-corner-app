import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { combineLatest } from 'rxjs';

import { Icon } from '../../components/icon/icon';
import { languageLabel } from '../../data/learning-unit-options';
import {
  Classroom,
  ClassroomProgramme,
  LearningUnit,
  WorkflowStep,
  classLabel
} from '../../models/teaching.model';
import { ClassroomService } from '../../services/classroom.service';
import { ConfigurationService } from '../../services/configuration.service';
import { LearningUnitService } from '../../services/learning-unit.service';
import { PageContextService } from '../../services/page-context.service';
import { ProgrammeService } from '../../services/programme.service';
import { ResourceLinkService } from '../../services/resource-link.service';
import { WorkflowService } from '../../services/workflow.service';

/** One card on this page: a learning unit, plus what the classroom says about it. */
export interface ClassroomUnit {
  docId: string;
  code: string;
  name: string;
  language: string;
  /** The learning unit's own `totalTime`. Production's card shows this. */
  minutes: number;
  /**
   * The sum of this unit's WORKFLOW step durations, or 0 when it has no workflow.
   *
   * SEPARATE FROM `minutes` rather than overwriting it, because the two answer
   * different questions and the card has to be able to fall back: `minutes` is
   * what the unit was authored to take (45 by default, straight off production's
   * own template), and this is how long the steps a teacher actually built add up
   * to. Where a workflow exists, that is the honest number for this class.
   */
  workflowMinutes: number;
  /** Storage path of the unit's thumbnail, or '' — see the note on the card. */
  imagePath: string;
  /** Empty when the classroom has no open/close dates for this unit. */
  scheduled: string;
  /** 'TACtivity', 'MuT' — the badge on the thumbnail, and what the filter picks. */
  type: string;
}

/**
 * A classroom's learning units — what the dashboard's classroom cards open.
 *
 * PRODUCTION'S SHAPE. Its URL is
 * /dashboard/{classroomId}?institutionId=…&classroomId=…&programmeId=…, and the
 * page shows the programme as a pill, the student count, a search and language
 * filter, then a card per learning unit with its language, duration and whether
 * it is scheduled.
 *
 * THE JOIN THIS PAGE IS. Three reads, and none of them can be skipped:
 *
 *   classrooms/{id}          which programmes this class runs, and its student
 *                            count — plus workflowIds, which is where the
 *                            open/close dates per unit live.
 *   programmes/{id}          learningUnitsIds, IN ORDER. The classroom does not
 *                            hold the unit list; the programme does.
 *   learningUnits            the units themselves, for name, language and time.
 *
 * WHAT IS NOT HERE, and why. Production's cards carry a progress percentage and
 * a progress bar — 0%, 14% — which is per-student progress through a unit. This
 * app has no student-progress data of any kind, so a bar would be decoration
 * showing a number nobody computed. Its Schedule and Year View buttons are left
 * out for the same reason the dashboard's action tiles were: a control that
 * cannot do anything is worse than its absence.
 *
 * ZONELESS. Everything the template reads after an await is a signal.
 */
@Component({
  selector: 'app-classroom-units',
  imports: [Icon, RouterLink],
  templateUrl: './classroom-units.html',
  styleUrl: './classroom-units.css'
})
export class ClassroomUnits implements OnInit {

  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  private classrooms = inject(ClassroomService);
  private programmes = inject(ProgrammeService);
  private learningUnits = inject(LearningUnitService);
  private links = inject(ResourceLinkService);
  private workflows = inject(WorkflowService);
  private config = inject(ConfigurationService);
  private pageContext = inject(PageContextService);

  readonly classroom = signal<Classroom | null>(null);
  readonly units = signal<ClassroomUnit[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');

  /** Which programme's units are showing. From the query string. */
  readonly programmeId = signal('');

  /** The classroom in the URL, so a card can link into its workflow stepper. */
  readonly classroomId = signal('');

  /**
   * Resolved thumbnail URLs, keyed by unit docId.
   *
   * A unit stores a PATH into Cloud Storage, not a URL — the path is stored
   * precisely because a download URL carries a token that can be revoked — so
   * each one has to be exchanged for a URL before a browser can show it.
   * ResourceLinkService already does that exchange for resource slots; this is
   * the same round trip for a card.
   *
   * A SEPARATE MAP rather than a field on ClassroomUnit, because the units
   * render immediately and the URLs arrive after: putting them on the row would
   * mean rebuilding every row when one image resolves.
   */
  readonly imageUrls = signal<Record<string, string>>({});

  /**
   * Paths that failed to LOAD in the browser, so the card can fall back.
   *
   * urlFor succeeding only means Storage minted a URL; the image can still 404
   * or be blocked afterwards. Without this the card shows a broken-image icon,
   * which is worse than the placeholder it replaced.
   */
  readonly brokenImages = signal<Record<string, boolean>>({});

  readonly search = signal('');

  /**
   * Cards or rows, matching the toggle production puts at the right of the
   * action strip.
   *
   * Cards by default, which is what its page opens on and what the artwork is
   * for; the row view is for a class running twenty units, where three-across
   * cards mean a lot of scrolling to find one code.
   */
  readonly view = signal<'card' | 'list'>('card');

  setView(view: 'card' | 'list'): void {
    this.view.set(view);
  }

  /**
   * Completion, in percent. ZERO, for every unit, and not as a placeholder.
   *
   * Production computes this from student submissions against the unit's
   * workflow. This app records neither — a classroom carries a student COUNTER
   * and no students, and there is no workflow to progress through — so nothing
   * has been recorded and zero is the true answer. A number chosen to look
   * plausible would be worse than the honest one, and would be indistinguishable
   * from real data to whoever read it next.
   *
   * A constant rather than a computed, because there is nothing to derive it
   * from. When submissions exist it becomes a per-unit lookup, and the card
   * already reads it per unit.
   */
  readonly completion = 0;

  readonly progressTitle =
    'Completion is not tracked in this app: it needs student submissions, which are not recorded here.';

  /**
   * Whether this unit already has a workflow, from the CLASSROOM'S OWN ENTRY.
   *
   * `programmes[programmeId].workflowIds[]` holds one entry per unit and the
   * entry's `workflowId` is the document id — so a non-empty id means the unit has
   * been started. That is the whole Start-versus-Continue rule, and it needs no
   * extra read: the classroom is already loaded for this page.
   */
  hasWorkflow(unitDocId: string): boolean {
    const entry = this.programme()?.workflowIds?.find(
      workflow => workflow.learningUnitId === unitDocId
    );

    return !!entry?.workflowId;
  }

  startTitle(unitDocId: string): string {
    return this.hasWorkflow(unitDocId)
      ? 'Continue this unit’s workflow'
      : 'Start this unit’s workflow';
  }

  /**
   * The dropdown filters by TYPE, not by language.
   *
   * Production's "All" select lists MuT, Group Activity, FLN, Micro Improvement
   * Programme and TACTivity — its learning-unit type vocabulary. This filtered by
   * language on a guess; the units on one classroom page are nearly always in one
   * language anyway, so the filter did almost nothing.
   */
  readonly unitType = signal('');

  /**
   * The programme this page is about.
   *
   * Taken from the CLASSROOM's own copy rather than read again: the classroom
   * denormalises programmeName and displayName at the moment the programme is
   * attached, which is what production's pill renders. Falls back to the first
   * programme when the URL names none, so the page still works from a link that
   * lost its query string.
   */
  readonly programme = computed<ClassroomProgramme | null>(() => {
    // A MAP on the classroom, keyed by programme id — production's shape, so a
    // programme can be attached with one dotted write. Values, in insertion
    // order, is the list this page wants.
    const attached = Object.values(this.classroom()?.programmes ?? {});
    const wanted = this.programmeId();

    return (
      attached.find(entry => entry.programmeId === wanted) ?? attached[0] ?? null
    );
  });

  readonly programmeTitle = computed(() => this.programmeLabel(this.programme()));

  /**
   * EVERY programme attached to this classroom, as the tab strip.
   *
   * Production's page is a `mat-tab-group` with one tab per programme, labelled
   * `displayName || programmeName` — that blue pill in its screenshot is the
   * SELECTED tab, not a title. A classroom running two programmes gets two tabs,
   * and this app showed only one pill and no way to reach the other.
   *
   * Selecting a tab is a QUERY-ONLY navigation, so the URL always says which
   * programme is being looked at and the page is shareable and reloadable — the
   * same reason production carries programmeId in its own query string.
   */
  readonly programmeTabs = computed(() =>
    Object.values(this.classroom()?.programmes ?? {}).map(entry => ({
      programmeId: entry.programmeId,
      label: this.programmeLabel(entry)
    }))
  );

  /** displayName over programmeName, as production's tab label does. */
  programmeLabel(programme: ClassroomProgramme | null): string {
    if (!programme) {
      return '';
    }

    return programme.displayName || programme.programmeName || '';
  }

  isSelectedProgramme(programmeId: string): boolean {
    return this.programme()?.programmeId === programmeId;
  }

  readonly studentCount = computed(() => this.classroom()?.studentCounter ?? 0);

  /**
   * The type vocabulary, from Configuration.
   *
   * The WHOLE vocabulary, as production's list is — so an option can match
   * nothing on this particular class. Offering only the types present would hide
   * a type because this programme happens not to use it, which reads as the type
   * not existing.
   */
  readonly typeOptions = this.config.learningUnitTypes;

  readonly visibleUnits = computed(() => {
    const query = this.search().trim().toLowerCase();
    const type = this.unitType();

    return this.units().filter(unit => {
      if (type !== '' && unit.type !== type) {
        return false;
      }

      if (query === '') {
        return true;
      }

      return (
        unit.code.toLowerCase().includes(query) ||
        unit.name.toLowerCase().includes(query)
      );
    });
  });

  /**
   * REACTS TO THE URL, rather than reading it once.
   *
   * THE BUG THIS FIXES. Angular REUSES a component when only the parameters
   * change — navigating from /classrooms/A to /classrooms/B is the same route —
   * so ngOnInit fires for the first classroom and never again. Clicking a second
   * class in the sidebar or on the dashboard left the first one's units on
   * screen under the new URL, which is the worst kind of wrong: it looks like
   * data rather than like a failure.
   *
   * Both streams are watched together: the classroom is in the path and the
   * programme in the query string, and switching programme within one class is a
   * query-only navigation that must still reload the units.
   *
   * takeUntilDestroyed, so the subscription dies with the component rather than
   * outliving it and writing into signals nothing renders.
   */
  ngOnInit(): void {
    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([params, query]) => {
        this.programmeId.set(query.get('programmeId') ?? '');
        this.classroomId.set(params.get('classroomId') ?? '');
        void this.load(params.get('classroomId') ?? '');
      });
  }

  private async load(classroomId: string): Promise<void> {
    // Reset first: the previous classroom's units must not linger while this
    // one is read, or a slow read shows the wrong list under the right name.
    this.loading.set(true);
    this.error.set('');
    this.units.set([]);
    this.imageUrls.set({});
    this.brokenImages.set({});

    try {
      const classroom = await this.classrooms.get(classroomId);

      this.classroom.set(classroom);

      if (!classroom) {
        this.error.set('That classroom no longer exists.');

        return;
      }

      /*
       * THE CRUMB NAMES THE CLASS, not the screen.
       *
       * It read "Admin › Classroom" for every class, which named the wrong
       * section and told the reader nothing. Production's is
       * institution › class › programme, so: school, then the class, then the
       * programme showing. Set here rather than in route data because none of
       * the three is known until the classroom is read.
       */
      this.pageContext.set(
        classroom.institutionName || 'Institutions',
        [classLabel(classroom)],
        this.programmeTitle() || 'Learning units'
      );

      await this.loadUnits();
    } catch (error) {
      this.error.set(this.classrooms.describeError(error, 'Could not load the classroom.'));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Resolves the programme's units, IN THE PROGRAMME'S ORDER.
   *
   * learningUnitsIds is positional — a classroom's per-unit locking is lined up
   * against it index for index — so the cards are built by walking that array
   * rather than by filtering the catalogue, which would return them in
   * catalogue order and silently reorder the programme.
   */
  private async loadUnits(): Promise<void> {
    const programme = this.programme();

    if (!programme) {
      return;
    }

    const stored = await this.programmes.get(programme.programmeId);

    /*
     * TRIMMED, AND READ ONE BY ONE — production's own strategy, from
     * learning-list.component.ts:
     *
     *   (programmes ?? []).filter(res => res?.trim())
     *                     .map(res => this.luService.get(res.trim()))
     *
     * TRIMMING MATTERS: an id stored with stray whitespace matched nothing when
     * this looked units up in a catalogue keyed by exact docId, so a unit
     * silently vanished from the class with no way to tell it apart from one
     * that was never attached.
     *
     * READ BY ID rather than scanning the collection, for the same reason
     * ClassroomService.get is a direct read: a programme of six units should
     * cost six reads, not one read of everything anybody ever created. In
     * parallel, since none of them depends on another.
     *
     * NO STATUS FILTER — see LearningUnitService.get. A unit already attached
     * stays visible if it moves back to development.
     */
    const ids = (stored?.learningUnitsIds ?? [])
      .map(id => String(id ?? '').trim())
      .filter(id => id !== '');

    const resolved = await Promise.all(ids.map(id => this.learningUnits.get(id)));

    this.units.set(
      resolved
        .filter((unit): unit is LearningUnit => unit !== null)
        .map(unit => ({
          docId: unit.docId,
          code: unit.learningUnitCode,
          name: unit.learningUnitDisplayName || unit.learningUnitName,
          language: unit.isoCode,
          minutes: Number(unit.totalTime) || 0,
          workflowMinutes: 0,
          imagePath: unit.learningUnitPreviewImage || unit.learningUnitImage || '',
          scheduled: scheduleLabel(programme, unit.docId),
          type: unit.type
        }))
    );

    // AFTER the cards are on screen. Each is one Storage round trip, and a card
    // must not wait on an image to render its name and duration.
    void this.resolveThumbnails();
    void this.resolveWorkflowMinutes(programme);
  }

  /**
   * Adds up each unit's workflow step durations.
   *
   * WHY THE CARD SHOWS THIS RATHER THAN THE UNIT'S OWN TIME. `totalTime` is
   * authored on the learning unit and defaults to 45 — production's own
   * `add-new-learningunit` writes `totalTime: 45` literally — so every unit
   * nobody has edited claims 45 minutes. The workflow is the plan a teacher
   * actually built for this class, and its steps carry the minutes they wrote. A
   * card saying 45 beside a workflow of 20 + 15 is reporting a default.
   *
   * A DEPARTURE FROM PRODUCTION, which shows `totalTime` on its card and does not
   * read the workflow at all.
   *
   * AFTER THE CARDS RENDER, and only for units that HAVE a workflow — the
   * classroom's own entry says which without a read, so a programme of six units
   * where two have been started costs two reads rather than six. A card shows the
   * unit's own time until its workflow lands, and keeps it if the read fails.
   */
  private async resolveWorkflowMinutes(programme: ClassroomProgramme): Promise<void> {
    const entries = (programme.workflowIds ?? []).filter(entry => entry.workflowId);

    if (entries.length === 0) {
      return;
    }

    const totals = await Promise.all(
      entries.map(async entry => {
        try {
          const workflow = await this.workflows.get(entry.workflowId);

          return {
            learningUnitId: entry.learningUnitId,
            minutes: workflowMinutes(workflow?.workflowSteps ?? [])
          };
        } catch {
          /* A refused or missing workflow leaves the card on the unit's own
             time, which is what it is already showing. */
          return { learningUnitId: entry.learningUnitId, minutes: 0 };
        }
      })
    );

    const byUnit = new Map(totals.map(total => [total.learningUnitId, total.minutes]));

    this.units.update(units =>
      units.map(unit => ({
        ...unit,
        workflowMinutes: byUnit.get(unit.docId) ?? 0
      }))
    );
  }

  /**
   * What the card shows.
   *
   * THE WORKFLOW WINS WHERE IT HAS ONE. Zero means either no workflow or a
   * workflow whose steps carry no durations at all, and both fall back to the
   * unit's authored time rather than showing '0 min'.
   */
  cardMinutes(unit: ClassroomUnit): number {
    return unit.workflowMinutes > 0 ? unit.workflowMinutes : unit.minutes;
  }

  /**
   * Exchanges each unit's stored path for a download URL.
   *
   * In parallel, and failures are simply absent from the map — a unit with no
   * image, a path that no longer exists and a bucket this app may not read are
   * the same thing to a card: there is nothing to show, so it shows the code.
   */
  private async resolveThumbnails(): Promise<void> {
    const withPaths = this.units().filter(unit => unit.imagePath !== '');

    if (withPaths.length === 0) {
      return;
    }

    const resolved = await Promise.all(
      withPaths.map(async unit => ({
        docId: unit.docId,
        url: await this.links.urlFor(unit.imagePath)
      }))
    );

    const urls: Record<string, string> = {};

    for (const entry of resolved) {
      if (entry.url) {
        urls[entry.docId] = entry.url;
      }
    }

    this.imageUrls.set(urls);
  }

  /** The thumbnail to draw, or '' for the code placeholder. */
  thumbnailFor(docId: string): string {
    return this.brokenImages()[docId] ? '' : (this.imageUrls()[docId] ?? '');
  }

  /** An image that resolved but would not load. Falls back for good. */
  onImageError(docId: string): void {
    this.brokenImages.update(current => ({ ...current, [docId]: true }));
  }

  languageName(code: string): string {
    return languageLabel(code);
  }

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }
}

/**
 * The total minutes a workflow's steps add up to.
 *
 * `workflowStepDuration` IS `number | string`, and the stored values are why this
 * coerces rather than adds: measured across production's 238 template steps it
 * holds a number in 221, the empty string in 6 and null in 11. `Number('')` and
 * `Number(null)` are both 0, but `Number(undefined)` is NaN — and one NaN would
 * make the whole total NaN and the card read 'NaN min'.
 */
export function workflowMinutes(steps: readonly WorkflowStep[]): number {
  return steps.reduce((total, step) => {
    const minutes = Number(step.workflowStepDuration);

    return total + (Number.isFinite(minutes) && minutes > 0 ? minutes : 0);
  }, 0);
}

/**
 * What the card's chip says about scheduling.
 *
 * The dates live on the CLASSROOM's programme entry, in `workflowIds`, keyed by
 * learningUnitId — not on the programme and not on the unit. A unit with neither
 * an openAt nor a closeAt is 'Not scheduled', which is production's own wording
 * and the state most units are in.
 */
function scheduleLabel(programme: ClassroomProgramme, learningUnitId: string): string {
  const workflow = (programme.workflowIds ?? []).find(
    entry => entry.learningUnitId === learningUnitId
  );

  if (!workflow) {
    return '';
  }

  const opens = asDate(workflow.openAt);
  const closes = asDate(workflow.closeAt);

  if (!opens && !closes) {
    return '';
  }

  // THE MONTH, which is what production's chip shows — 'May', 'June', 'July'.
  // A date range was more precise and read as noise in a chip that sits under
  // the unit's name; the month is the granularity a class is planned at.
  return opens || closes;
}

/**
 * A Timestamp, or production's empty string, as a month name.
 *
 * Production's chip reads 'May' rather than a date, so the day is deliberately
 * dropped. Locale-aware, so it follows the browser rather than hardcoding
 * English month names.
 */
function asDate(value: unknown): string {
  const millis = (value as { toMillis?: () => number } | null)?.toMillis?.();

  if (typeof millis !== 'number') {
    return '';
  }

  return new Date(millis).toLocaleDateString(undefined, { month: 'long' });
}

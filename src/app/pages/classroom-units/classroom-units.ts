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
  LearningUnit
} from '../../models/teaching.model';
import { ClassroomService } from '../../services/classroom.service';
import { LearningUnitService } from '../../services/learning-unit.service';
import { ProgrammeService } from '../../services/programme.service';

/** One card on this page: a learning unit, plus what the classroom says about it. */
export interface ClassroomUnit {
  docId: string;
  code: string;
  name: string;
  language: string;
  minutes: number;
  /** Storage path of the unit's thumbnail, or '' — see the note on the card. */
  imagePath: string;
  /** Empty when the classroom has no open/close dates for this unit. */
  scheduled: string;
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

  readonly classroom = signal<Classroom | null>(null);
  readonly units = signal<ClassroomUnit[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');

  /** Which programme's units are showing. From the query string. */
  readonly programmeId = signal('');

  readonly search = signal('');
  readonly language = signal('');

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

  /** Every language the listed units are in, for the filter. */
  readonly languageOptions = computed(() => {
    const seen = new Set<string>();

    for (const unit of this.units()) {
      if (unit.language) {
        seen.add(unit.language);
      }
    }

    return [...seen].sort((a, b) => a.localeCompare(b));
  });

  readonly visibleUnits = computed(() => {
    const query = this.search().trim().toLowerCase();
    const language = this.language();

    return this.units().filter(unit => {
      if (language !== '' && unit.language !== language) {
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
        void this.load(params.get('classroomId') ?? '');
      });
  }

  private async load(classroomId: string): Promise<void> {
    // Reset first: the previous classroom's units must not linger while this
    // one is read, or a slow read shows the wrong list under the right name.
    this.loading.set(true);
    this.error.set('');
    this.units.set([]);

    try {
      const classroom = await this.classrooms.get(classroomId);

      this.classroom.set(classroom);

      if (!classroom) {
        this.error.set('That classroom no longer exists.');

        return;
      }

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
          imagePath: unit.learningUnitPreviewImage || unit.learningUnitImage || '',
          scheduled: scheduleLabel(programme, unit.docId)
        }))
    );
  }

  languageName(code: string): string {
    return languageLabel(code);
  }

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }
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

  if (opens && closes) {
    return `${opens} – ${closes}`;
  }

  return opens ? `From ${opens}` : `Until ${closes}`;
}

/** A Timestamp, or production's empty string, as 'd MMM'. */
function asDate(value: unknown): string {
  const millis = (value as { toMillis?: () => number } | null)?.toMillis?.();

  if (typeof millis !== 'number') {
    return '';
  }

  return new Date(millis).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short'
  });
}

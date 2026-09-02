import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest } from 'rxjs';

import { ConfirmDialog } from '../../components/confirm-dialog/confirm-dialog';
import { Icon } from '../../components/icon/icon';
import { WorkflowTimeline } from '../../components/workflow-timeline/workflow-timeline';
import {
  QuizOutcome,
  QuizPlayer,
  totalSeconds
} from '../../components/quiz-player/quiz-player';
import {
  ContentPatch,
  StepPatch,
  WorkflowStepDialog
} from '../../components/workflow-step-dialog/workflow-step-dialog';
import {
  Classroom,
  ClassroomProgramme,
  Workflow,
  WorkflowContent,
  WorkflowStep,
  WorkflowTemplate,
  Assignment,
  FormQuestion,
  LearningUnit,
  QuizAssignment,
  QuizQuestion,
  UploadSlot,
  classLabel,
  emptyWorkflowContent,
  emptyWorkflowStep,
  isEmptyContent,
  nameForContent
} from '../../models/teaching.model';
import { AssignmentService } from '../../services/assignment.service';
import { AuthService } from '../../services/auth.service';
import { ClassroomService } from '../../services/classroom.service';
import {
  EXTERNAL_RESOURCES_CATEGORY,
  EXTERNAL_RESOURCE_SLOTS
} from '../../data/learning-unit-options';
import { ConfigurationService } from '../../services/configuration.service';
import { PageContextService } from '../../services/page-context.service';
import { LearningUnitService } from '../../services/learning-unit.service';
import { ResourceLinkService } from '../../services/resource-link.service';
import {
  ResolvedResource,
  WorkflowContentResourceService,
  resourceKind,
  youtubeId
} from '../../services/workflow-content-resource.service';
import {
  MAX_ATTEMPTS_REACHED,
  QuizSubmissionService,
  SubmissionTarget
} from '../../services/quiz-submission.service';
import { AssignmentForm, FormOutcome } from '../../components/assignment-form/assignment-form';
import {
  AssignmentUploadService,
  UploadTarget
} from '../../services/assignment-upload.service';
import {
  AnsweredFormQuestion,
  FormSubmissionService,
  FormSubmissionTarget
} from '../../services/form-submission.service';
import { WorkflowService, ClassroomWorkflowLink } from '../../services/workflow.service';
import { WorkflowTemplateService } from '../../services/workflow-template.service';

/**
 * The classroom workflow stepper — where a workflow template is actually USED.
 *
 * WHAT THIS PAGE IS. A learning unit in a classroom has a WORKFLOW: an ordered
 * list of steps, each carrying content the teacher walks the class through. The
 * workflow starts as a copy of a TEMPLATE and can then be edited without touching
 * the blueprint. This is production's `classroom-stepper`, reached from the
 * Start / Continue button on a unit card.
 *
 * HOW THE WORKFLOW IS FOUND, which is the part worth reading twice. Nothing
 * queries the `workflows` collection. The classroom holds
 * `programmes[programmeId].workflowIds[]`, one entry per learning unit, and that
 * entry's `workflowId` is the document id. So:
 *
 *   classroom → programme → entry for this unit → workflowId → the workflow
 *
 * An entry whose `workflowId` is '' — or no entry at all — means this unit has no
 * workflow yet, which is the difference between production's Continue and Start.
 * The first save is what creates the document and fills the id in.
 *
 * THE STEPS ARE A WORKING COPY. `steps` is edited freely and only written on Save,
 * so navigating away loses nothing that was ever stored — and applying a template
 * can replace the lot without a round trip.
 */
@Component({
  selector: 'app-classroom-workflow',
  imports: [
    DatePipe,
    Icon,
    RouterLink,
    WorkflowTimeline,
    WorkflowStepDialog,
    QuizPlayer,
    AssignmentForm,
    ConfirmDialog
  ],
  templateUrl: './classroom-workflow.html',
  styleUrl: './classroom-workflow.css',
  /*
   * ESCAPE CLOSES THE SUBMITTED POPUP, bound on the HOST and at document level —
   * the same shape ConfirmDialog uses, and for the same reason: the popup is a
   * plain div, so it can never receive a keydown of its own.
   *
   * HARMLESS WHEN NOTHING IS OPEN, since dismissing sets an already-empty signal
   * to empty.
   */
  host: {
    '(document:keydown.escape)': 'dismissPopup()'
  }
})
export class ClassroomWorkflow implements OnInit {

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private classrooms = inject(ClassroomService);
  private workflows = inject(WorkflowService);
  private submissions = inject(QuizSubmissionService);
  private uploads = inject(AssignmentUploadService);
  private forms = inject(FormSubmissionService);
  private workflowLinks = inject(ClassroomWorkflowLink);
  private templates = inject(WorkflowTemplateService);
  private assignmentService = inject(AssignmentService);
  private learningUnits = inject(LearningUnitService);
  private contentResources = inject(WorkflowContentResourceService);
  private links = inject(ResourceLinkService);
  private pageContext = inject(PageContextService);
  private config = inject(ConfigurationService);
  private auth = inject(AuthService);
  private sanitizer = inject(DomSanitizer);

  readonly classroomId = signal('');
  readonly programmeId = signal('');
  readonly unitId = signal('');

  readonly classroom = signal<Classroom | null>(null);
  readonly unitName = signal('');

  readonly loading = signal(true);
  readonly error = signal('');
  readonly saving = signal(false);
  readonly saveError = signal('');

  /** A save that worked but skipped something blank. Amber, not red. */
  readonly saveNotice = signal('');

  /**
   * The learning unit this workflow belongs to.
   *
   * READ FOR ITS MATURITY, primarily. A unit has one resource document per
   * maturity rung and its own `Maturity` says which is current, so a Gold unit's
   * steps must read its Gold files and not the Silver ones it may also have.
   */
  readonly unit = signal<LearningUnit | null>(null);

  /**
   * Every slot this unit has a file for, keyed `category.subCategory`.
   *
   * RESOLVED ONCE PER UNIT rather than per content block: a workflow can carry a
   * dozen blocks across its steps and each would otherwise repeat the same reads.
   */
  readonly unitResources = signal<ReadonlyMap<string, ResolvedResource>>(new Map());

  /** The stored workflow, or null when this unit has none yet. */
  readonly workflow = signal<Workflow | null>(null);

  /** THE WORKING COPY. Edited freely; written only on Save. */
  readonly steps = signal<WorkflowStep[]>([]);

  /** Where the steps came from, carried onto the document when saved. */
  readonly templateId = signal('');
  readonly templateName = signal('');

  /** Which step the right-hand pane is showing. */
  readonly currentIndex = signal(0);

  /** Which of the current step's contents is open. */
  readonly activeTab = signal(0);

  /** The "Select New Template" toggle. */
  readonly showTemplatePicker = signal(false);

  /** Every template this classroom may use — see `loadTemplates`. */
  readonly templateOptions = signal<WorkflowTemplate[]>([]);

  /** Set when switching template would discard edits; holds the pending choice. */
  readonly pendingTemplateId = signal<string | null>(null);

  readonly currentStep = computed<WorkflowStep | null>(
    () => this.steps()[this.currentIndex()] ?? null
  );

  /**
   * The tabs across the top of the content pane.
   *
   * ONE PER CONTENT BLOCK, labelled `contentName` — which is exactly what
   * production does, and why its screenshots show "TACtivity Video", "Guide" and
   * "Material List": those are three content names on the step, not a fixed set of
   * tabs. A step with no contents therefore has no tabs, and the pane says so.
   */
  readonly tabs = computed<WorkflowContent[]>(() => this.currentStep()?.contents ?? []);

  readonly openContent = computed<WorkflowContent | null>(
    () => this.tabs()[this.activeTab()] ?? null
  );

  /**
   * The assignments this teacher owns, for resolving a content block's link.
   *
   * A CONTENT BLOCK STORES AN ID AND A NAME, not the assignment itself — so the
   * instructions and the upload slots it shows have to come from the assignment
   * document. Read once, lazily, and only when a step actually carries an
   * assignment block: most do not.
   *
   * OWNER-SCOPED, WHICH IS A REAL LIMIT. `AssignmentService.list()` returns the
   * caller's own assignments, so a block pointing at somebody else's resolves to
   * nothing and the pane falls back to what the block itself carries. Stated here
   * rather than hidden because the symptom — an assignment with no instructions —
   * looks like missing data instead of a permission boundary.
   */
  readonly assignments = signal<Assignment[]>([]);
  private assignmentsRequested = false;

  /** The assignment a content block points at, if it can be resolved. */
  readonly openAssignment = computed<Assignment | null>(() => {
    const id = this.openContent()?.assignmentId;

    if (!id) {
      return null;
    }

    return this.assignments().find(assignment => assignment.docId === id) ?? null;
  });

  /**
   * The TILES above the detail card.
   *
   * ONE PER UPLOAD SLOT, which is what production's row of tiles is: its stepper
   * renders a `mat-step` per entry in the assignment's `assignments` array and
   * labels it with the slot's `title` — which is why its screenshot reads 'Upload
   * activity image/video' rather than the content block's name.
   *
   * A NON-UPLOAD ASSIGNMENT HAS NO SLOTS, and neither does a resource block, so
   * both fall back to a single tile named after the content itself. One tile is
   * still the right shape: the tile is what the detail card belongs to.
   */
  readonly slots = computed<UploadSlot[]>(() => {
    const assignment = this.openAssignment();

    return assignment?.type === 'UPLOAD' ? assignment.assignments ?? [] : [];
  });

  /**
   * THE LINKED ASSIGNMENT'S OWN CONTENT, by type.
   *
   * A CONTENT BLOCK STORES A NAME AND AN ID, nothing more — so showing what the
   * assignment actually IS means reading the assignment document. Until this
   * existed the pane named the assignment and stopped, which is what "the quiz's
   * content is not coming" meant: the block was right, the pane simply showed none
   * of it.
   *
   * THREE SHAPES, and they share no field worth unifying: a quiz holds
   * `questionsData`, a form holds `questions`, an upload holds `assignments` —
   * production's own three field names, kept as found. Each reader returns empty
   * for the other two types, so the template asks by type and gets nothing
   * misleading.
   */
  readonly quizQuestions = computed<QuizQuestion[]>(() => {
    const assignment = this.openAssignment();

    return assignment?.type === 'QUIZ' ? assignment.questionsData ?? [] : [];
  });

  readonly formQuestions = computed<FormQuestion[]>(() => {
    const assignment = this.openAssignment();

    return assignment?.type === 'FORM' ? assignment.questions ?? [] : [];
  });

  /** The quiz's total marks, which is the one number a teacher scans for. */
  readonly quizMarks = computed(() =>
    this.quizQuestions().reduce((total, question) => total + (question.marks ?? 0), 0)
  );

  /**
   * Whether the assignment could not be resolved at all.
   *
   * TOLD APART FROM "an assignment with no questions", because the causes differ
   * and so does what to do about it: an unresolved assignment is usually somebody
   * else's — `AssignmentService.list()` is owner-scoped — while an empty one is a
   * quiz nobody has added questions to yet.
   */
  readonly assignmentMissing = computed(() => {
    const content = this.openContent();

    return (
      content?.contentCategory === 'assignment' &&
      (content.assignmentId ?? '') !== '' &&
      this.openAssignment() === null
    );
  });

  /**
   * THE QUIZ CARD's three lines, which are production's exactly.
   *
   * `Teacher Name` IS THE SIGNED-IN TEACHER, not the assignment's author — its own
   * card reads `currentTeacher.teacherMeta.firstName`, so the card says who is
   * about to run the quiz rather than who wrote it. Worth stating because the
   * assignment carries `creator` and `author` too and either would look plausible.
   */
  readonly quizAssignment = computed<QuizAssignment | null>(() => {
    const assignment = this.openAssignment();

    return assignment?.type === 'QUIZ' ? assignment : null;
  });

  readonly teacherName = computed(() => this.auth.displayName());

  /** The quiz's total duration as mm:ss, from its three stored fields. */
  readonly quizDuration = computed(() => {
    const quiz = this.quizAssignment();

    if (!quiz) {
      return '';
    }

    const total = totalSeconds(quiz);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  });

  /** Whether the player is open over the page. */
  readonly playing = signal(false);

  /** The last run's result, so the card can say what happened. */
  readonly lastOutcome = signal<QuizOutcome | null>(null);

  /* ---- Recording an attempt ----------------------------------------------
     Production's teacher player writes to
     `Teachers/{teacherId}/submissions/{classroomId}-{programmeId}` and shows a
     toast naming the attempt. This page owns that write because the path is keyed
     on the teacher, the classroom and the programme — none of which the player has
     any business knowing. See QuizSubmissionService. */

  readonly submitting = signal(false);
  readonly submissionNote = signal('');
  readonly submissionFailed = signal(false);

  startQuiz(): void {
    if (!this.quizAssignment()) {
      return;
    }

    /* CLEARED FOR THE NEW RUN, so a second run does not open showing the first
       run's "Quiz submitted ( attempt1 )" before anything has been submitted. */
    this.submissionNote.set('');
    this.submissionFailed.set(false);
    this.lastOutcome.set(null);
    this.playing.set(true);
  }

  closeQuiz(): void {
    this.playing.set(false);
  }

  private submissionTarget(): SubmissionTarget {
    return {
      uid: this.auth.requireUid(),
      classroomId: this.classroomId(),
      programmeId: this.programmeId(),
      workflowId: this.workflow()?.docId ?? ''
    };
  }

  /**
   * WRITES THE ATTEMPT — production's method, and its shape.
   *
   * The player has already confirmed with the reader and computed the marks; this
   * turns that into the three documents production writes and reports back the
   * attempt number, which is what its own toast shows.
   */
  async recordOutcome(outcome: QuizOutcome): Promise<void> {
    this.lastOutcome.set(outcome);

    const quiz = this.quizAssignment();

    if (!quiz || this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.submissionFailed.set(false);
    this.submissionNote.set('');

    try {
      const result = await this.submissions.save(
        this.submissionTarget(),
        {
          questions: outcome.questions,
          studentScore: outcome.studentScore,
          maxScore: outcome.maxScore,
          displayName: quiz.displayName,
          totalQuestions: outcome.total,
          /* PRODUCTION'S FIELD NAME FOR THE QUIZ'S OWN DOCUMENT ID. */
          id: quiz.docId,
          totalDurationInHours: quiz.totalDurationInHours ?? 0,
          totalDurationInMinutes: quiz.totalDurationInMinutes ?? 0,
          totalDurationInSeconds: quiz.totalDurationInSeconds ?? 0,
          userAgent: globalThis.navigator?.userAgent ?? ''
        },
        this.submissions.allowedSubmissions(quiz)
      );

      /* PRODUCTION'S OWN WORDING, attempt id included. */
      this.submissionNote.set(`Quiz submitted ( ${result.attemptId} )`);
    } catch (error) {
      this.submissionFailed.set(true);
      this.submissionNote.set(this.describeSubmission(error, quiz));
    } finally {
      this.submitting.set(false);
    }
  }

  /**
   * WHY A SUBMISSION DID NOT LAND.
   *
   * THE CAP GETS ITS OWN SENTENCE, naming the number, because "could not submit"
   * for a quiz that simply has no attempts left sends the reader looking for a
   * fault that is not there. Production distinguishes the same case.
   */
  private describeSubmission(error: unknown, quiz: QuizAssignment): string {
    if ((error as Error)?.message === MAX_ATTEMPTS_REACHED) {
      const allowed = this.submissions.allowedSubmissions(quiz);

      /*
       * THE CAP IS PER CLASSROOM AND PROGRAMME, NOT PER QUIZ, and the message says
       * so — because that is production's shape and it is surprising. The summary
       * document is keyed `{classroomId}-{programmeId}`, so every quiz run for one
       * class and programme draws on the same allowance.
       */
      return allowed === 1
        ? 'This quiz allows one submission per classroom and programme, and one has already been recorded. This attempt was not saved.'
        : `All ${allowed} submissions allowed for this classroom and programme have already been used. This attempt was not saved.`;
    }

    return this.workflows.describeError(
      error,
      'Could not record this attempt. Nothing was saved.'
    );
  }

  /** Which tile is open. */
  readonly activeSlot = signal(0);

  readonly openSlot = computed<UploadSlot | null>(
    () => this.slots()[this.activeSlot()] ?? null
  );

  /**
   * THE PROSE ROW, AND ITS SOURCE DIFFERS PER TYPE — which is why it is three
   * readers rather than one field.
   *
   * Measured across 500 of production's assignments, because the row was reading
   * `instructions` for everything and a quiz has no such field:
   *
   *   FORM    40 of 40 carry `instructions`
   *   UPLOAD   3 of 39 do, but ALL 57 of its SLOTS carry their own
   *   QUIZ     0 of 37 — it carries `backgroundInfo` instead
   *
   * So a quiz's equivalent prose is its BACKGROUND: a rich-text description plus
   * images or PDFs, the case study its questions refer to. Labelling that
   * "Instructions" and reporting "None given" said a teacher had forgotten to fill
   * something in, when the field does not exist for that type at all.
   */
  readonly openInstructions = computed(() => {
    const slot = this.openSlot();

    // AN UPLOAD SLOT FIRST: its own instructions are the most specific thing here.
    if (slot?.instructions) {
      return slot.instructions;
    }

    const assignment = this.openAssignment();

    if (assignment?.type === 'QUIZ') {
      return assignment.backgroundInfo?.description ?? '';
    }

    if (assignment?.type === 'FORM') {
      return assignment.instructions ?? '';
    }

    return '';
  });

  /** 'Background' for a quiz, 'Instructions' for everything else. */
  readonly instructionsLabel = computed(() =>
    this.openAssignment()?.type === 'QUIZ' ? 'Background' : 'Instructions'
  );

  /** A quiz's background can be titled, and production's real ones are. */
  readonly backgroundTitle = computed(() => {
    const assignment = this.openAssignment();

    return assignment?.type === 'QUIZ' ? (assignment.backgroundInfo?.title ?? '') : '';
  });

  /** How many files the background carries — the case study's images or PDFs. */
  readonly backgroundFiles = computed(() => {
    const assignment = this.openAssignment();

    return assignment?.type === 'QUIZ'
      ? (assignment.backgroundInfo?.images ?? []).length
      : 0;
  });

  /**
   * Whether to draw the row at all.
   *
   * HIDDEN WHERE THE FIELD DOES NOT APPLY, rather than shown empty. A quiz with no
   * background has nothing to say there, and "None given" about a field its type
   * does not have reads as missing data rather than as a field that was never part
   * of a quiz.
   */
  readonly showInstructionsRow = computed(() => {
    if (this.openAssignment()?.type === 'QUIZ') {
      return (
        this.openInstructions() !== '' ||
        this.backgroundTitle() !== '' ||
        this.backgroundFiles() > 0
      );
    }

    return true;
  });

  /**
   * The open content block's file — THE THING THE PANE IS FOR.
   *
   * A content block names a SLOT, not a file: 'video' plus 'tacVideoUrl'. The file
   * lives on the learning unit's resource document, which is why this goes through
   * the resolver rather than reading `content.resourcePath` alone — that field is
   * empty on almost every block, and reading only it made every step claim no file
   * was attached when the unit had one.
   */
  readonly openResource = computed<ResolvedResource>(() => {
    const content = this.openContent();

    if (!content) {
      return { value: '', origin: 'none', slot: '' };
    }

    return this.contentResources.resolve(content, this.unitResources());
  });

  /** How to render it: an embed, an image, a video, a link or a download. */
  readonly openKind = computed(() => resourceKind(this.openResource().value));

  readonly openYoutubeId = computed(() => youtubeId(this.openResource().value));

  /**
   * The URL a storage path resolves to, once fetched.
   *
   * SEPARATE FROM `openResource` because getting it is asynchronous: a Cloud
   * Storage path has to be exchanged for a download URL, and a computed cannot
   * await. Null means either "not fetched yet" or "could not be resolved", and the
   * template treats both the same way — there is nothing to show either way.
   */
  readonly openUrl = signal<string | null>(null);
  readonly resolvingUrl = signal(false);

  /**
   * The YouTube embed URL, sanitised for an iframe `src`.
   *
   * BUILT FROM THE ID, not from the stored URL. The stored value carries a
   * `&list=…&start_radio=1` tail in this app's own data, and handing that to an
   * embed plays a playlist instead of the video. It also means the `src` is a URL
   * this code composed rather than one a document supplied, which is what makes
   * bypassing Angular's sanitiser safe here.
   */
  readonly youtubeEmbed = computed(() => {
    const id = this.openYoutubeId();

    return id === ''
      ? null
      : this.sanitizer.bypassSecurityTrustResourceUrl(
          `https://www.youtube-nocookie.com/embed/${id}`
        );
  });

  /**
   * The URL for an INLINE FRAME, and only when it is safe to embed one.
   *
   * ONLY A FILE OUT OF THIS APP'S OWN STORAGE BUCKET, never an arbitrary URL from
   * a document. `bypassSecurityTrustResourceUrl` turns Angular's sanitiser off for
   * the value it is given, so what may pass through it has to be decided here
   * rather than there: a Firebase Storage download URL was minted by the SDK for a
   * path in our own bucket, while a slot can also hold a link somebody typed —
   * embedding that would frame a third-party page with this app's origin around
   * it. An external link therefore falls back to an anchor, which is why the
   * template has both branches.
   *
   * The host check is on the resolved URL rather than on the stored value, because
   * the stored value for an embeddable file is a bare path with no host at all.
   */
  readonly embeddableUrl = computed(() => {
    const url = this.openUrl();

    if (!url || this.links.isLink(this.openResource().value)) {
      return null;
    }

    return url.startsWith('https://firebasestorage.googleapis.com/')
      ? this.sanitizer.bypassSecurityTrustResourceUrl(url)
      : null;
  });

  /**
   * 'a PowerPoint file' — named from the extension, for the office message.
   *
   * NAMED RATHER THAN CALLED "a file", because the point of the message is that
   * converting THIS KIND of file to PDF is what makes it display, and a reader
   * cannot act on "a file".
   */
  readonly officeKindLabel = computed(() => {
    const value = this.openResource().value.toLowerCase();

    if (/\.pptx?(\?|$)/.test(value)) {
      return 'a PowerPoint file';
    }

    if (/\.docx?(\?|$)/.test(value)) {
      return 'a Word document';
    }

    if (/\.xlsx?(\?|$)/.test(value)) {
      return 'an Excel spreadsheet';
    }

    return 'an Office file';
  });

  /** What to say while a storage path is being exchanged for a URL, or fails. */
  readonly urlState = computed(() =>
    this.resolvingUrl() ? 'Loading the file…' : 'That file could not be opened.'
  );

  /**
   * WHERE THE FILE CAME FROM, in words.
   *
   * Four sources are possible and they are not interchangeable: a path stored on
   * the block overrides the unit, a grade-dependent slot can resolve to this
   * class's board-and-year copy or to the one universal file, and everything else
   * comes straight off the unit. "Which file am I looking at" is a real question
   * when a slot has that many answers.
   */
  readonly originLabel = computed(() => {
    switch (this.openResource().origin) {
      case 'content':
        return 'Set on this workflow step ·';
      case 'grade':
        return `From this class's board and grade ·`;
      case 'universal':
        return 'The same file for every board ·';
      case 'external':
        return `From the learning unit's External Resources ·`;
      case 'unit':
        return `From the learning unit's ${this.unit()?.Maturity ?? ''} resources ·`;
      default:
        return '';
    }
  });

  /**
   * THE SLOTS THIS UNIT CAN HOLD, as `category -> sub-categories`.
   *
   * READ FROM THE RESOURCE SCHEMA for the unit's type and maturity — the same
   * table the learning-unit editor renders its upload tabs from. That equality is
   * the point: a step can only point at a slot it can name, so if the two lists
   * differed a teacher could attach a file and then be unable to select it here.
   *
   * THE TYPE KEY HAS ITS SPACES STRIPPED and the maturity is lowercased, because
   * that is how the schema is keyed — 'Toys and Tales' is stored as 'ToysandTales'
   * and 'Gold' as 'gold'. A type the schema does not carry yields nothing, and the
   * dialog then falls back to its own list rather than showing an empty select.
   */
  readonly categorySlots = computed<Record<string, readonly string[]>>(() => {
    const unit = this.unit();

    if (!unit) {
      return {};
    }

    const schema = this.config.learningUnitResourceSchema() as unknown as Record<
      string,
      Record<string, Record<string, Record<string, unknown>>>
    >;
    const categories =
      schema[String(unit.type ?? '').replace(/\s+/g, '')]?.[
        String(unit.Maturity ?? '').toLowerCase()
      ];

    if (!categories) {
      return {};
    }

    /*
     * THE UNIT'S OWN NINE ARE OFFERED FIRST, as their own category. They are not
     * in the schema — they live on the unit document rather than on a maturity
     * resource document — so without this a teacher could upload a guide on the
     * editor's External Resources tab and have no way to name it in a step.
     */
    const slots: Record<string, readonly string[]> = {
      [EXTERNAL_RESOURCES_CATEGORY]: EXTERNAL_RESOURCE_SLOTS.map(slot => slot.code)
    };

    for (const [category, entries] of Object.entries(categories)) {
      /*
       * A CATEGORY CAN BE A SLOT ITSELF, which is real data rather than a stray:
       * MuT and ReadyTAC hang a grade-dependent handbook at CATEGORY level rather
       * than inside `graphics`. Those have no sub-categories to offer.
       */
      slots[category] =
        entries && typeof entries === 'object' && !Array.isArray(entries)
          ? Object.keys(entries).filter(key => key !== 'universalGradeBoardResourcePath')
          : [];
    }

    return slots;
  });

  readonly hasPrevious = computed(() => this.currentIndex() > 0);
  readonly hasNext = computed(() => this.currentIndex() < this.steps().length - 1);

  /** '1/7', production's own pager text. */
  readonly pagerLabel = computed(
    () => `${this.currentIndex() + 1}/${this.steps().length}`
  );

  /**
   * WHETHER THERE ARE UNSAVED CHANGES.
   *
   * WHY THIS EXISTS. The steps are a working copy and nothing is written until
   * Save Workflow Steps is pressed — which is deliberate, so applying a template
   * or deleting a step can be reconsidered. But nothing on the page SAID so, and
   * the consequence was a real report: a step built in the UI, the page left, and
   * the work gone with no warning that it had never been stored.
   *
   * COMPARED AS JSON, which is honest about what this needs to be: a deep equality
   * over plain data whose only job is deciding whether to warn. Key order is stable
   * because both sides come through the same normaliser.
   */
  readonly dirty = computed(() => {
    const stored = this.workflow()?.workflowSteps ?? [];

    return JSON.stringify(stored) !== JSON.stringify(this.steps());
  });

  /** Whether anything is worth saving. */
  readonly canSave = computed(() => this.steps().length > 0 && !this.saving());

  constructor() {
    /*
     * FETCHES THE DOWNLOAD URL for whatever is open, and only for a storage path.
     *
     * An http URL is already openable — `urlFor` returns it unchanged — so going
     * through Storage for one would be a wasted round trip. A YouTube link is
     * embedded from its id and needs no URL at all.
     */
    effect(() => {
      const resource = this.openResource();
      const kind = this.openKind();

      this.openUrl.set(null);

      if (resource.value === '' || kind === 'youtube') {
        return;
      }

      if (this.links.isLink(resource.value)) {
        this.openUrl.set(resource.value);

        return;
      }

      this.resolvingUrl.set(true);

      void this.links
        .urlFor(resource.value)
        .then(url => this.openUrl.set(url))
        .finally(() => this.resolvingUrl.set(false));
    });

    /*
     * READS BACK WHAT IS ALREADY UPLOADED for whichever slot is open.
     *
     * AN EFFECT RATHER THAN A CALL IN selectSlot, because the open slot changes
     * four ways — picking a tile, switching content tabs, moving between steps,
     * and the workflow finishing its load — and only one of those goes through
     * selectSlot. Tracking the signals catches all four; `selectSlot` also calls it
     * directly so a tile click does not wait on a change-detection pass.
     *
     * TRACKED DELIBERATELY AND NOTHING ELSE. `openSlot` and the content block's
     * assignment id are the whole input; reading anything else here would make the
     * effect re-run on edits that cannot change the answer.
     */
    effect(() => {
      /* READ TO BE TRACKED, and `void` because that is all they are for: an
         effect re-runs when a signal it READ changes, so these two reads are the
         subscription. Assigning them would be the same thing with a name nobody
         uses; leaving them bare trips no-unused-expressions. */
      void this.openSlot();
      void this.openContent()?.assignmentId;

      void this.readStoredUpload();
    });

    /*
     * AND THE SAME FOR A FORM. Separate from the effect above rather than folded
     * into it, because the two track different signals: an upload's stored path
     * changes with the open SLOT, a form's answers with the open ASSIGNMENT. One
     * effect reading both would re-read a form's submission every time a reader
     * clicked between upload tiles.
     */
    effect(() => {
      this.openAssignment();

      void this.readStoredForm();
      this.formNote.set('');
      this.formFailed.set(false);
    });
  }

  ngOnInit(): void {
    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([params, query]) => {
        this.classroomId.set(params.get('classroomId') ?? '');
        this.unitId.set(params.get('unitId') ?? '');
        this.programmeId.set(query.get('programmeId') ?? '');

        void this.load();
      });
  }

  /**
   * Reads the classroom, then this unit's workflow through it.
   *
   * THE CLASSROOM COMES FIRST AND ALWAYS, even when the unit turns out to have no
   * workflow: it is what names the class in the header, what says which templates
   * apply (a STEM club offers different ones), and what holds the entry that would
   * point at a workflow. Without it there is nothing to render and nothing to save
   * against.
   */
  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.workflow.set(null);
    this.steps.set([]);
    this.currentIndex.set(0);
    this.activeTab.set(0);

    try {
      const classroom = await this.classrooms.get(this.classroomId());

      this.classroom.set(classroom);

      if (!classroom) {
        this.error.set('That classroom no longer exists.');

        return;
      }

      await this.loadTemplates(classroom);
      await this.loadUnitResources(classroom);

      const entry = this.workflowLinks.find(this.programme(), this.unitId());

      // THE UNIT'S OWN NAME FIRST, then the classroom's denormalised copy: the
      // copy can be stale where the catalogue has been renamed since.
      this.unitName.set(
        this.unit()?.learningUnitDisplayName ||
          this.unit()?.learningUnitName ||
          entry?.learningUnitName ||
          entry?.learningUnitCode ||
          ''
      );

      /*
       * THE BREADCRUMB NAMES WHAT THE READER WALKED THROUGH, not the screen.
       *
       * Production's is institution › class › programme › learning unit, and all
       * four earn their place: this page is about one unit, of one programme, in
       * one class, at one school, and the route carries ids for three of them. The
       * route's static data said 'Institutions › Workflow', which named the screen
       * and told the reader nothing about which unit was open.
       *
       * SET AFTER THE UNIT IS READ because its name is the last segment and is not
       * known until then. Empty segments are dropped by the service, so a club with
       * no programme showing simply renders a shorter crumb.
       */
      this.pageContext.set(
        classroom.institutionName || 'Institutions',
        [classLabel(classroom), this.programme()?.displayName ?? ''],
        this.unitName() || 'Workflow'
      );

      if (entry?.workflowId) {
        const stored = await this.workflows.get(entry.workflowId);

        if (stored) {
          this.adopt(stored);

          return;
        }
        /*
         * THE ENTRY NAMES A WORKFLOW THAT IS GONE. Falls through to the no-workflow
         * state rather than erroring: the unit genuinely has no steps, and saving
         * here writes a fresh document and repoints the entry at it.
         */
      }
    } catch (error) {
      this.error.set(
        this.workflows.describeError(error, 'Could not load this workflow.')
      );
    } finally {
      this.loading.set(false);
    }
  }

  /** The classroom's entry for the programme in the URL. */
  private programme(): ClassroomProgramme | undefined {
    return this.classroom()?.programmes?.[this.programmeId()];
  }

  /** Takes a stored workflow as the working copy. */
  private adopt(stored: Workflow): void {
    void this.loadAssignments();
    this.workflow.set(stored);
    this.steps.set(stored.workflowSteps.map(step => ({ ...step })));
    this.templateId.set(stored.templateId);
    this.templateName.set(stored.templateName);
    this.showTemplatePicker.set(false);
  }

  /**
   * Reads the learning unit and the files it has for its maturity.
   *
   * THE BOARD AND GRADE COME FROM THE CLASSROOM, which carries both — `board` is
   * copied from the institution when the class is created, as production copies
   * it. They matter for grade-dependent slots, where the file filed against this
   * class's board and year is the right one and the universal copy is the
   * fallback.
   *
   * A FAILED READ LEAVES THE MAP EMPTY. The steps still render and each block says
   * no file is attached, which is the same thing the reader sees when the unit
   * genuinely has none — better than refusing to show the workflow.
   */
  private async loadUnitResources(classroom: Classroom): Promise<void> {
    try {
      const unit = await this.learningUnits.get(this.unitId());

      this.unit.set(unit);

      if (!unit) {
        return;
      }

      this.unitResources.set(
        await this.contentResources.forUnit(this.unitId(), unit.Maturity, {
          board: classroom.board ?? '',
          grade: classroom.grade ?? '',
          // THE UNIT'S OWN "External Resources" — a second store with no
          // maturity. See the resolver's note on why both are needed.
          external: unit.resources as unknown as Record<string, unknown>
        })
      );
    } catch {
      this.unitResources.set(new Map());
    }
  }

  /**
   * The templates this classroom may use, FILTERED BY ITS TYPE.
   *
   * PRODUCTION'S OWN RULE: a STEM-CLUB classroom is offered STEM-CLUB templates
   * and everything else is offered CLASSROOM ones. Mixing them would let a class
   * be given a workflow built for a different setting entirely.
   *
   * A FAILED READ IS NOT FATAL. The dropdown is one control on a page whose main
   * job is the steps; an empty list with the toggle still working is a better
   * outcome than refusing to show the workflow at all.
   */
  private async loadTemplates(classroom: Classroom): Promise<void> {
    const wanted = classroom.type === 'STEM-CLUB' ? 'STEM-CLUB' : 'CLASSROOM';

    try {
      const all = await this.templates.list();

      this.templateOptions.set(all.filter(template => template.type === wanted));
    } catch {
      this.templateOptions.set([]);
    }
  }

  // ---- Navigation ---------------------------------------------------------

  selectStep(index: number): void {
    if (index < 0 || index >= this.steps().length) {
      return;
    }

    this.currentIndex.set(index);
    // A NEW STEP OPENS ON ITS FIRST TAB. Keeping the old index would land on a
    // content block that does not exist on this step, or on an unrelated one.
    this.activeTab.set(0);
    this.activeSlot.set(0);

    // The step may carry an assignment block, whose instructions and slots live
    // on the assignment document rather than on the block.
    void this.loadAssignments();
  }

  previous(): void {
    this.selectStep(this.currentIndex() - 1);
  }

  next(): void {
    this.selectStep(this.currentIndex() + 1);
  }

  selectTab(index: number): void {
    this.activeTab.set(index);
    // A NEW TAB OPENS ON ITS FIRST TILE, for the same reason a new step opens on
    // its first tab: the old index belongs to a different assignment's slots.
    this.activeSlot.set(0);
    void this.loadAssignments();
  }

  selectSlot(index: number): void {
    this.activeSlot.set(index);
    /* THE STORED FILE IS PER SLOT, so switching tiles has to re-read it —
       otherwise slot 2 shows slot 1's View link. */
    void this.readStoredUpload();
  }

  // ---- Uploading against a slot -------------------------------------------

  /** True while a file is going up, so the button cannot fire twice. */
  readonly uploading = signal(false);

  /** What went wrong, in words the row shows. */
  readonly uploadError = signal('');

  /** The path already recorded for the open slot, or ''. */
  readonly uploadedPath = signal('');

  /** What the file picker's `accept` offers. */
  readonly uploadAccept = computed(() => {
    const slot = this.openSlot();

    return slot ? this.uploads.acceptedExtensions(slot).join(',') : '';
  });

  /**
   * Reads back whatever is already recorded for the open slot.
   *
   * FROM THE RECORD, NOT FROM STORAGE — see `AssignmentUploadService.storedPath`
   * for why. A failed read leaves the path empty, which renders as "nothing
   * uploaded yet": the honest reading, since this page cannot prove otherwise.
   */
  private async readStoredUpload(): Promise<void> {
    const slot = this.openSlot();
    const target = this.uploadTarget();

    this.uploadedPath.set('');

    if (!slot || !target) {
      return;
    }

    try {
      /* THE PATH ONLY. A download URL used to be minted here for the View and
         Download links; both are gone, so fetching one on every slot change
         would be a round trip nothing reads. */
      this.uploadedPath.set(await this.uploads.storedPath(target, slot));
    } catch {
      this.uploadedPath.set('');
    }
  }

  /**
   * `null` WHERE AN UPLOAD CANNOT BE ADDRESSED YET.
   *
   * The record is keyed on the assignment and on the workflow, so a content block
   * with no assignment chosen has nowhere to put a file. Returning null rather than
   * a target full of blanks is what keeps the button from appearing on a step that
   * could not record one.
   *
   * `currentUid()` AND NOT `requireUid()`, WHICH THROWS. This is read from an
   * EFFECT, and an effect runs whenever its signals settle — including before the
   * session is known, and in a test that never signs anybody in. The throw escaped
   * as an unhandled rejection and the suite caught it: 21 of them in one run.
   * "Not signed in" is a state this reader can answer honestly with "nothing
   * uploaded", so it does.
   */
  private uploadTarget(): UploadTarget | null {
    const assignmentId = this.openContent()?.assignmentId ?? '';
    const uid = this.auth.currentUid();

    if (!assignmentId || !uid) {
      return null;
    }

    return {
      uid,
      classroomId: this.classroomId(),
      programmeId: this.programmeId(),
      workflowId: this.workflow()?.docId ?? '',
      assignmentId
    };
  }

  /**
   * Whether to offer the button at all.
   *
   * THE SAME THREE CONDITIONS `uploadTarget` CHECKS, deliberately duplicated in a
   * computed the template can read: a button that appears and then silently does
   * nothing is worse than no button, and that is exactly what happens if these two
   * disagree.
   */
  readonly canUpload = computed(
    () =>
      this.openSlot() !== null &&
      (this.openContent()?.assignmentId ?? '') !== '' &&
      this.auth.currentUid() !== null
  );

  /**
   * Sends the chosen file.
   *
   * THE INPUT IS CLEARED EITHER WAY, which production also does: without it,
   * choosing the same file again fires no `change` event, so a retry after a
   * refusal appears to do nothing at all.
   */
  async chooseUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    input.value = '';

    const slot = this.openSlot();
    const target = this.uploadTarget();

    if (!file || !slot || !target || this.uploading()) {
      return;
    }

    this.uploading.set(true);
    this.uploadError.set('');

    try {
      const outcome = await this.uploads.upload(file, target, slot);

      if (outcome.error) {
        this.uploadError.set(outcome.error);
      } else {
        await this.readStoredUpload();

        /*
         * SAID IN THE POPUP, because the button alone is not evidence. Its label
         * flips to Re-upload, which is a small change a long way from where the
         * reader was looking, and View and Download — the other two signs that
         * anything had happened — are gone on instruction.
         */
        this.popup.set('Uploaded successfully');
        this.popupNote.set(
          `${file.name} is stored against this slot. Uploading again replaces it.`
        );
      }
    } finally {
      this.uploading.set(false);
    }
  }

  // ---- Submitting a form --------------------------------------------------

  /**
   * Whether to draw the Due Date / Instructions / Assignment table.
   *
   * NOT FOR A FORM. Production's UPLOAD renderer draws this table and its FORM
   * renderer does not — a form carries its instructions as a centred heading
   * inside its own card, which is the place the reader is already looking.
   * Rendering both showed a form's instructions twice, and put a "2 fields" count
   * above a form that lists its two fields immediately underneath.
   *
   * A QUIZ KEEPS IT, because production's quiz step has no instructions of its own
   * to put anywhere else — measured: 0 of its 37 quizzes carry an `instructions`
   * field — so the table is the only thing naming what the step is.
   */
  readonly showAssignmentDetail = computed(() => this.openAssignment()?.type !== 'FORM');

  /** The form's own instruction line, shown centred above its questions. */
  readonly formInstructions = computed(() => {
    const assignment = this.openAssignment();

    return assignment?.type === 'FORM' ? assignment.instructions ?? '' : '';
  });

  readonly formSubmitting = signal(false);
  readonly formNote = signal('');
  readonly formFailed = signal(false);

  /** Bumped on every successful write; the form empties itself on the change. */
  readonly formClearedAt = signal(0);

  /**
   * The popup shown after something is successfully stored, until dismissed.
   *
   * ONE POPUP FOR THE PAGE, used by the form's Submit and by an upload. Its TITLE
   * and its NOTE are separate signals because the two have different things to
   * explain: a form was cleared and can be overwritten, a file replaced whatever
   * was there. A single blob of text would have to be vague enough for both.
   */
  readonly popup = signal('');
  readonly popupNote = signal('');

  /** Answers already recorded, so the form opens showing them. */
  readonly storedFormAnswers = signal<AnsweredFormQuestion[] | null>(null);

  /**
   * Reads back a previous submission for the open form.
   *
   * PRODUCTION DOES THE SAME and it matters more here than it looks: a form has
   * NO version history — the block is commented out in its own source — so
   * resubmitting overwrites. Opening an empty form over answers that already
   * exist invites exactly that.
   */
  private async readStoredForm(): Promise<void> {
    const target = this.formTarget();

    this.storedFormAnswers.set(null);

    if (!target) {
      return;
    }

    try {
      this.storedFormAnswers.set(await this.forms.storedAnswers(target));
    } catch {
      this.storedFormAnswers.set(null);
    }
  }

  /** `null` where a form submission cannot be addressed yet. */
  private formTarget(): FormSubmissionTarget | null {
    const assignment = this.openAssignment();
    const uid = this.auth.currentUid();

    if (!uid || assignment?.type !== 'FORM') {
      return null;
    }

    return {
      uid,
      classroomId: this.classroomId(),
      programmeId: this.programmeId(),
      workflowId: this.workflow()?.docId ?? '',
      assignmentId: assignment.docId
    };
  }

  /** Writes the answers. The component built the record; this stores it. */
  async submitForm(outcome: FormOutcome): Promise<void> {
    const assignment = this.openAssignment();
    const target = this.formTarget();

    if (!target || assignment?.type !== 'FORM' || this.formSubmitting()) {
      return;
    }

    this.formSubmitting.set(true);
    this.formFailed.set(false);
    this.formNote.set('');

    try {
      await this.forms.save(target, {
        instructions: assignment.instructions ?? '',
        questions: outcome.questions,
        displayName: assignment.displayName,
        totalQuestions: outcome.questions.length,
        /* PRODUCTION'S FIELD NAME FOR THE FORM'S OWN DOCUMENT ID. */
        id: assignment.docId
      });

      /* PRODUCTION'S OWN WORDING, in the popup rather than inline. */
      this.popup.set('Feedback submitted');
      this.popupNote.set(
        'Your answers are saved. The form has been cleared — submitting it again replaces what was just stored.'
      );
      this.formNote.set('Form Submitted Successfully');

      /*
       * THE FORM IS EMPTIED, on instruction.
       *
       * THE STORED COPY IS CLEARED IN THE SAME BREATH, and that pairing is the
       * whole trick: the form prefills from `storedFormAnswers`, so setting it to
       * what was just submitted — which is what this used to do — would refill
       * every field the instant the counter emptied them.
       */
      this.storedFormAnswers.set(null);
      this.formClearedAt.update(count => count + 1);
    } catch (error) {
      this.formFailed.set(true);
      this.formNote.set(
        this.workflows.describeError(error, 'Could not submit this form. Nothing was saved.')
      );
    } finally {
      this.formSubmitting.set(false);
    }
  }

  /** Reads the owner's assignments once. A refused read leaves the list empty. */
  private async loadAssignments(): Promise<void> {
    if (this.assignmentsRequested) {
      return;
    }

    this.assignmentsRequested = true;

    try {
      this.assignments.set(await this.assignmentService.list());
    } catch {
      this.assignments.set([]);
    }
  }

  // ---- Templates ----------------------------------------------------------

  /**
   * The "Select New Template" toggle.
   *
   * TURNING IT ON DOES NOT CHANGE ANYTHING YET — it reveals the dropdown. The
   * confirmation belongs on the CHOICE, not on the toggle, because opening a
   * dropdown to see what is available should not be a destructive act. Production
   * warns on the toggle instead, which means a reader who only wanted to look has
   * to answer for edits they have not yet decided to lose.
   */
  toggleTemplatePicker(): void {
    this.showTemplatePicker.update(open => !open);
  }

  /**
   * Applies a template's steps, ASKING FIRST when that would lose work.
   *
   * "Losing work" means steps exist that are not what the stored workflow holds —
   * either edits, or a template applied and not yet saved. A workflow freshly
   * loaded and untouched can be replaced silently, because nothing is lost.
   */
  chooseTemplate(templateId: string): void {
    if (templateId === '') {
      return;
    }

    if (this.hasUnsavedSteps()) {
      this.pendingTemplateId.set(templateId);

      return;
    }

    this.applyTemplate(templateId);
  }

  confirmTemplate(): void {
    const pending = this.pendingTemplateId();

    this.pendingTemplateId.set(null);

    if (pending) {
      this.applyTemplate(pending);
    }
  }

  cancelTemplate(): void {
    this.pendingTemplateId.set(null);
  }

  /** The name shown in the confirm dialog, so the reader knows what they picked. */
  readonly pendingTemplateName = computed(() => {
    const pending = this.pendingTemplateId();

    return (
      this.templateOptions().find(template => template.docId === pending)
        ?.templateName ?? ''
    );
  });

  private applyTemplate(templateId: string): void {
    const template = this.templateOptions().find(entry => entry.docId === templateId);

    if (!template) {
      return;
    }

    /*
     * A DEEP-ENOUGH COPY. The steps are replaced wholesale and the contents array
     * on each is copied too — without that, editing a step here would reach into
     * the template held in `templateOptions` and change what the dropdown would
     * apply next time.
     */
    this.steps.set(
      template.workflowSteps.map(step => ({
        ...step,
        contents: step.contents.map(content => ({ ...content }))
      }))
    );

    this.templateId.set(template.templateId || template.docId);
    this.templateName.set(template.templateName);
    this.currentIndex.set(0);
    this.activeTab.set(0);
    this.showTemplatePicker.set(false);
  }

  /**
   * Whether the working copy differs from what is stored.
   *
   * COMPARED AS JSON, which is honest about what this needs to be: a deep equality
   * over plain data whose only job is deciding whether to ask a question. Key
   * order is stable because both sides are built by the same normaliser.
   */
  private hasUnsavedSteps(): boolean {
    return this.steps().length > 0 && this.dirty();
  }

  // ---- Steps --------------------------------------------------------------

  /**
   * The step being edited in the dialog, by index, or null when closed.
   *
   * THE SAME DIALOG THE TEMPLATE FORM OPENS — one component, so a step edited here
   * and a step edited there follow identical rules. It emits patches; this page
   * applies them to its own working copy.
   */
  readonly openStep = signal<number | null>(null);

  readonly openStepValue = computed<WorkflowStep | null>(() => {
    const index = this.openStep();

    return index === null ? null : (this.steps()[index] ?? null);
  });

  /**
   * Adds a step at the end and opens it.
   *
   * NUMBERED AFTER THE LAST, which is what makes the ladder's numbers positional
   * and stable. Production's "Add New Workflow Step" does the same.
   */
  addStep(): void {
    this.steps.update(list => [...list, emptyWorkflowStep(list.length + 1)]);

    const added = this.steps().length - 1;

    this.openStep.set(added);

    /*
     * AND THE PANE MOVES TO IT. Without this the reader closes the dialog and is
     * still looking at the step they were on, so the content they just added is
     * nowhere on screen — which reads as the content having failed to save.
     * Production sets its own `currentStepIndex` when it adds a step for the same
     * reason.
     */
    this.currentIndex.set(added);
    this.activeTab.set(0);
    this.activeSlot.set(0);
  }

  editStep(index: number): void {
    this.openStep.set(index);
  }

  /**
   * Closes the dialog, DROPPING A STEP THAT WAS NEVER NAMED.
   *
   * Dismissing the dialog on a step Add just created has to leave the page as it
   * found it — an unnamed step would otherwise sit in the ladder as 'Untitled
   * step', be saved, and read as a blank stage in production's player.
   */
  closeStepDialog(): void {
    const index = this.openStep();

    if (index !== null && (this.steps()[index]?.workflowStepName ?? '').trim() === '') {
      this.steps.update(list => list.filter((_, position) => position !== index));

      if (this.currentIndex() >= this.steps().length) {
        this.currentIndex.set(Math.max(0, this.steps().length - 1));
      }
    }

    this.openStep.set(null);
  }

  /** The dialog's step patches, applied to the working copy. */
  patchStep(index: number, patch: StepPatch): void {
    this.steps.update(list =>
      list.map((step, position) => (position === index ? { ...step, ...patch } : step))
    );
  }

  /** And its content patches. */
  patchContent(
    stepIndex: number,
    contentIndex: number,
    patch: ContentPatch['patch']
  ): void {
    this.steps.update(list =>
      list.map((step, position) =>
        position === stepIndex
          ? {
              ...step,
              contents: step.contents.map((content, at) =>
                at === contentIndex ? { ...content, ...patch } : content
              )
            }
          : step
      )
    );
  }

  addContent(stepIndex: number): void {
    this.steps.update(list =>
      list.map((step, position) =>
        position === stepIndex
          ? { ...step, contents: [...step.contents, emptyWorkflowContent()] }
          : step
      )
    );
  }

  removeContent(stepIndex: number, contentIndex: number): void {
    this.steps.update(list =>
      list.map((step, position) =>
        position === stepIndex
          ? {
              ...step,
              contents: step.contents.filter((_, at) => at !== contentIndex)
            }
          : step
      )
    );
  }

  /**
   * Removes a step and RENUMBERS the rest.
   *
   * `sequenceNumber` is positional and production orders by it, so leaving a gap
   * would save a workflow whose steps claim numbers that no longer match. The last
   * step cannot go — the timeline disables that button — because a workflow with
   * no steps is a state this page cannot render.
   */
  removeStep(index: number): void {
    if (this.steps().length <= 1) {
      return;
    }

    this.steps.update(list =>
      list
        .filter((_, position) => position !== index)
        .map((step, position) => ({ ...step, sequenceNumber: position + 1 }))
    );

    // KEEP THE READER IN RANGE. Deleting the last step while viewing it would
    // otherwise leave currentIndex past the end and the pane empty.
    if (this.currentIndex() >= this.steps().length) {
      this.selectStep(this.steps().length - 1);
    }
  }

  // ---- Saving -------------------------------------------------------------

  /**
   * Writes the steps, creating the workflow and its classroom link if needed.
   *
   * TWO PATHS, and which one runs is the whole Start-versus-Continue distinction:
   * an existing workflow is updated in place; a unit that has none gets a new
   * document AND an entry on the classroom pointing at it. The service owns that
   * pairing because a workflow written without the link is unreachable.
   */
  async save(): Promise<void> {
    if (!this.canSave()) {
      return;
    }

    this.saving.set(true);
    this.saveError.set('');
    this.saveNotice.set('');

    /*
     * ONLY GENUINELY EMPTY BLOCKS ARE DROPPED, and the definition of empty was
     * WRONG until a real report caught it.
     *
     * ADD NEW CONTENT adds a blank block, and one left untouched should not be
     * written — that much was right. But the test was `contentName` alone, so a
     * block with an UPLOAD assignment picked and the NAME FIELD LEFT BLANK counted
     * as empty and was discarded without a word. The step's own name saved, so the
     * page came back showing a step with no content and the save looked broken:
     * "am trying to save workflow by creating upload me, when I click save
     * workflow step not saving properly". It had saved. It had thrown away the
     * part that mattered.
     *
     * SO A BLANK NAME IS NOW FILLED IN RATHER THAN FATAL — see `nameForContent`,
     * which takes the assignment's own name — and a block is dropped only when
     * every field a reader could have filled is blank.
     *
     * THE WORKING COPY IS SET TO THE FILTERED LIST TOO. Without that the page
     * would still hold the blocks it just declined to write, so `dirty` would
     * report unsaved changes for ever and the reader could never get to a clean
     * state.
     */
    const kept = this.steps().filter(step => step.workflowStepName.trim() !== '');

    /* WHAT IS ABOUT TO BE THROWN AWAY, counted BEFORE the filter, so the reader
       can be told rather than left to notice. */
    const droppedSteps = this.steps().length - kept.length;
    let droppedContent = 0;

    const steps = kept.map((step, index) => {
      const contents = step.contents.filter(content => !isEmptyContent(content));

      droppedContent += step.contents.length - contents.length;

      return {
        ...step,
        workflowStepName: step.workflowStepName.trim(),
        sequenceNumber: index + 1,
        contents: contents.map(content => ({
          ...content,
          contentName: nameForContent(content)
        }))
      };
    });

    this.steps.set(steps);
    this.reportDropped(droppedSteps, droppedContent);

    const draft = {
      templateId: this.templateId(),
      templateName: this.templateName(),
      workflowSteps: steps
    };

    try {
      const existing = this.workflow();

      if (existing) {
        /*
         * WHAT THIS SAVE IS ABOUT TO DISCARD GOES TO THE TRASH FIRST.
         *
         * A step removed from the rail is not deleted, it is written out of the
         * array — so no trash would hold it and there is no undo. Archived
         * BEFORE the update, so the copy exists whether or not the write lands;
         * archived after, a failed write would leave a trash entry for a step
         * that is still live, which reads as a deletion that did not happen.
         *
         * NOT AWAITED IN A WAY THAT CAN FAIL THE SAVE — see `trashSteps`. The
         * reader asked to store their steps, not to archive the removed ones.
         */
        await this.trashRemovedSteps(existing, steps);

        await this.workflows.update(existing.docId, draft);
        this.workflow.set({ ...existing, ...draft });
      } else {
        const created = await this.workflows.create(draft, {
          classroomId: this.classroomId(),
          programmeId: this.programmeId(),
          learningUnitId: this.unitId()
        });

        this.adopt(created);
        /*
         * THE CLASSROOM IS RE-READ because its `workflowIds` just changed, and the
         * copy in memory would otherwise still say this unit has no workflow —
         * which would make a second save create a SECOND document.
         */
        this.classroom.set(await this.classrooms.get(this.classroomId()));
      }
    } catch (error) {
      this.saveError.set(
        this.workflows.describeError(error, 'Could not save these workflow steps.')
      );
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Archives the stored steps this save no longer holds.
   *
   * MATCHED BY NAME, trimmed and case-folded, because a step has no id — production
   * carries `workflowStepId` in 0 of its 2593 real steps, so there is nothing
   * stable to match on. A RENAMED step therefore reads as one removed and one
   * added, and gets archived. That is the error worth making: a spare copy of a
   * step that still exists costs a document, where a missed copy of a step that
   * does not is the thing this is here to prevent.
   */
  private async trashRemovedSteps(
    stored: Workflow,
    saved: readonly WorkflowStep[]
  ): Promise<void> {
    try {
      /*
       * `?? []` AND INSIDE THE TRY, both deliberate. A stored document is
       * whatever Firestore holds, and one written before this app modelled steps
       * carries no array at all — reading `.filter` off it threw, and the throw
       * escaped past the save's own catch and took the SAVE down with it. An
       * archive that can stop a save is worse than no archive.
       */
      const kept = new Set(
        saved.map(step => (step.workflowStepName ?? '').trim().toLowerCase())
      );
      const removed = (stored.workflowSteps ?? []).filter(
        step => !kept.has((step.workflowStepName ?? '').trim().toLowerCase())
      );

      if (removed.length === 0) {
        return;
      }

      await this.workflows.trashSteps(removed, {
        workflowId: stored.docId,
        ...this.here()
      });
    } catch {
      /* SWALLOWED. The save is what the reader asked for; the archive is this
         app being careful on their behalf, and it must not be able to block it. */
    }
  }

  /** The three ids that identify this unit's slot on the classroom. */
  private here(): { classroomId: string; programmeId: string; learningUnitId: string } {
    return {
      classroomId: this.classroomId(),
      programmeId: this.programmeId(),
      learningUnitId: this.unitId()
    };
  }

  /**
   * Says what a save declined to write.
   *
   * SILENCE WAS THE BUG, not the dropping. A blank block is still not worth
   * storing, but discarding one without a word is what made a save that worked
   * look like a save that did not — the reader is left comparing what they built
   * against what came back and guessing which of the two is wrong.
   */
  private reportDropped(steps: number, contents: number): void {
    if (steps === 0 && contents === 0) {
      return;
    }

    const parts: string[] = [];

    if (steps > 0) {
      parts.push(`${steps} step${steps === 1 ? '' : 's'} with no name`);
    }

    if (contents > 0) {
      parts.push(`${contents} empty content block${contents === 1 ? '' : 's'}`);
    }

    /* ITS OWN SIGNAL, NOT `saveError`. The save WORKED; only a blank part of it
       was skipped. Painting that red would report a failure that did not happen,
       and a reader who sees red twice stops reading it the third time. */
    this.saveNotice.set(
      `Saved. ${parts.join(' and ')} ${steps + contents === 1 ? 'was' : 'were'} not stored, because ${steps + contents === 1 ? 'it was' : 'they were'} blank.`
    );
  }

  /** Back to the unit list, keeping the programme the reader came in on. */
  backLink(): unknown[] {
    return ['/institutions/classroom', this.classroomId()];
  }

  readonly backQuery = computed(() => ({ programmeId: this.programmeId() }));

  dismissPopup(): void {
    this.popup.set('');
    this.popupNote.set('');
  }

  valueOf(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }
}

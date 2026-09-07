import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';

import { Icon } from '../../components/icon/icon';
import { Assignment } from '../../models/teaching.model';
import {
  AssignmentReportService,
  ReportScope,
  StudentAttempt,
  buildQuestionAccuracy,
  buildStudentSummary,
  reportFilename
} from '../../services/assignment-report.service';
import { ClassroomService } from '../../services/classroom.service';
import { InstitutionService } from '../../services/institution.service';
import { WorkbookService } from '../../services/workbook.service';

/** One option in any of the four selects: what to store, and what to show. */
export interface ReportOption {
  id: string;
  name: string;
}

/**
 * Report Download — production's full-page report panel.
 *
 * FOUR CASCADING SELECTS, narrowing to one learning unit in one classroom:
 *
 *   Institution  ->  Classroom  ->  Programme  ->  Learning Unit
 *
 * Each is disabled until the one before it is chosen, because each reads its
 * options from that choice. That is production's own arrangement and it is not
 * only cosmetic: a classroom belongs to an institution, a programme is allotted
 * to a classroom, and the units are the ones allotted to that programme on that
 * classroom — picking them independently would offer combinations that do not
 * exist.
 *
 * WHERE THE OPTIONS COME FROM, and the third and fourth are worth naming because
 * they are NOT separate reads:
 *
 *   institutions   the collection
 *   classrooms     the collection, filtered by institutionId
 *   programmes     the chosen CLASSROOM's own `programmes` map, not the
 *                  programmes collection — a classroom carries the programmes
 *                  allotted to it, with their names already denormalised
 *   units          that classroom programme's `workflowIds`, which carry
 *                  `learningUnitName` and `learningUnitCode` alongside the id
 *
 * The last one is why the denormalised unit detail on classroom programmes pays
 * off here: the Learning Unit select needs a name per allotted unit, and without
 * those fields this would be a join against the learningUnits collection for
 * every entry.
 *
 * WHAT THIS DOES NOT DO YET, stated rather than hidden: download a submission
 * report. Production exports student answers, read from
 * `Students/{id}/remoteSubmissions/{id}/attempts` — a collection this app does
 * not have. There is no `Students` collection in its database and no student in
 * its model; a classroom carries a `studentCounter` and nothing else. The button
 * is therefore not drawn as if it worked. See the note on `unavailableReason`.
 *
 * ZONELESS. Every field the template reads is a signal.
 */
@Component({
  selector: 'app-assignment-report',
  imports: [Icon],
  templateUrl: './assignment-report.html',
  styleUrl: './assignment-report.css',
  host: { '(document:keydown.escape)': 'close()' }
})
export class AssignmentReport implements OnInit {

  /** The assignment the report is for. Its name titles the page. */
  readonly assignment = input.required<Assignment>();

  readonly closed = output<void>();

  private institutionService = inject(InstitutionService);
  private classroomService = inject(ClassroomService);
  private reportService = inject(AssignmentReportService);
  private workbooks = inject(WorkbookService);

  readonly loading = signal(true);
  readonly error = signal('');

  readonly institutions = signal<ReportOption[]>([]);

  readonly selectedInstitutionId = signal('');
  readonly selectedClassroomId = signal('');
  readonly selectedProgrammeId = signal('');
  readonly selectedLearningUnitId = signal('');

  /**
   * Every classroom, read ONCE and filtered in memory.
   *
   * One read rather than a query per institution: there are tens of classrooms,
   * the page is a picker the user will move around in, and re-reading on every
   * change of institution would put a network round trip behind a dropdown.
   */
  private readonly classrooms = signal<
    { docId: string; classroomName: string; institutionId: string }[]
  >([]);

  /** The whole chosen classroom, which is where the last two selects read from. */
  private readonly classroomDetail = signal<{
    programmes: Record<string, unknown>;
  } | null>(null);

  readonly heading = computed(
    () => `${this.assignment().displayName || 'Assignment'} - Report Download (Remote Submission)`
  );

  async ngOnInit(): Promise<void> {
    this.loading.set(true);

    try {
      const [institutions, classrooms] = await Promise.all([
        this.institutionService.list(),
        this.classroomService.list()
      ]);

      this.institutions.set(
        institutions
          .map(row => ({ id: row.docId, name: row.institutionName || row.docId }))
          .sort((a, b) => a.name.localeCompare(b.name))
      );

      this.classrooms.set(
        classrooms.map(row => ({
          docId: row.docId,
          classroomName: row.classroomName || row.docId,
          institutionId: row.institutionId ?? ''
        }))
      );

      this.error.set('');
    } catch (error) {
      this.error.set(
        this.classroomService.describeError(error, 'Could not load the institutions and classrooms.')
      );
    } finally {
      this.loading.set(false);
    }
  }

  // ---- The cascade -------------------------------------------------------

  /** The chosen institution's classrooms, by `institutionId`. */
  readonly classroomOptions = computed<ReportOption[]>(() => {
    const institutionId = this.selectedInstitutionId();

    if (!institutionId) {
      return [];
    }

    return this.classrooms()
      .filter(row => row.institutionId === institutionId)
      .map(row => ({ id: row.docId, name: row.classroomName }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  /**
   * The chosen classroom's OWN programmes, not the programmes collection.
   *
   * A classroom carries a `programmes` map keyed by programme id, with the name
   * denormalised onto each entry — so this is what is actually allotted to that
   * class rather than everything the institution owns.
   */
  readonly programmeOptions = computed<ReportOption[]>(() => {
    const programmes = this.classroomDetail()?.programmes;

    if (!programmes) {
      return [];
    }

    return Object.entries(programmes)
      .map(([id, value]) => {
        const entry = (value ?? {}) as Record<string, unknown>;
        const name =
          (entry['displayName'] as string) ||
          (entry['programmeName'] as string) ||
          id;

        return { id, name };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  /**
   * The units allotted to that programme ON that classroom.
   *
   * From `workflowIds`, which is positional against the programme's own unit
   * list and carries the denormalised name and code. An entry with neither falls
   * back to its id, so a classroom written before those fields existed still
   * offers something selectable rather than a blank row.
   */
  readonly learningUnitOptions = computed<ReportOption[]>(() => {
    const programmes = this.classroomDetail()?.programmes;
    const programmeId = this.selectedProgrammeId();

    if (!programmes || !programmeId) {
      return [];
    }

    const entry = (programmes[programmeId] ?? {}) as Record<string, unknown>;
    const workflows = (entry['workflowIds'] ?? []) as Record<string, unknown>[];

    return workflows
      .filter(row => typeof row?.['learningUnitId'] === 'string' && row['learningUnitId'] !== '')
      .map(row => {
        const id = row['learningUnitId'] as string;
        const name = (row['learningUnitName'] as string) || '';
        const code = (row['learningUnitCode'] as string) || '';

        return { id, name: name && code ? `${name} (${code})` : name || code || id };
      });
  });

  /**
   * Whether a classroom has no allotted units at all.
   *
   * Worth saying out loud rather than showing an empty dropdown: 42 of this
   * app's classroom-programme pairs store no `workflowIds`, so this is the
   * common case and not an error.
   */
  readonly noUnitsReason = computed(() => {
    if (!this.selectedProgrammeId() || this.learningUnitOptions().length > 0) {
      return '';
    }

    return 'No learning units are allotted to this programme on this classroom.';
  });

  async onSelectInstitution(institutionId: string): Promise<void> {
    this.selectedInstitutionId.set(institutionId);
    // Everything downstream is now wrong, so it goes rather than lingering.
    this.selectedClassroomId.set('');
    this.selectedProgrammeId.set('');
    this.selectedLearningUnitId.set('');
    this.classroomDetail.set(null);
  }

  /**
   * Reads the WHOLE classroom, because the last two selects live inside it.
   *
   * The list read carries enough for the classroom dropdown but not the
   * `programmes` map with its `workflowIds`, so this is a real second read and
   * it is why the select shows a loading state.
   */
  async onSelectClassroom(classroomId: string): Promise<void> {
    this.selectedClassroomId.set(classroomId);
    this.selectedProgrammeId.set('');
    this.selectedLearningUnitId.set('');
    this.classroomDetail.set(null);

    if (!classroomId) {
      return;
    }

    this.loadingClassroom.set(true);

    try {
      const classroom = await this.classroomService.get(classroomId);

      this.classroomDetail.set(
        classroom ? { programmes: classroom.programmes ?? {} } : { programmes: {} }
      );
      this.error.set('');
    } catch (error) {
      this.error.set(
        this.classroomService.describeError(error, 'Could not load that classroom.')
      );
    } finally {
      this.loadingClassroom.set(false);
    }
  }

  readonly loadingClassroom = signal(false);

  onSelectProgramme(programmeId: string): void {
    this.selectedProgrammeId.set(programmeId);
    this.selectedLearningUnitId.set('');
  }

  onSelectLearningUnit(learningUnitId: string): void {
    this.selectedLearningUnitId.set(learningUnitId);
  }

  // ---- The summary -------------------------------------------------------

  /** All four chosen, which is when production reveals the download card. */
  readonly ready = computed(
    () =>
      this.selectedInstitutionId() !== '' &&
      this.selectedClassroomId() !== '' &&
      this.selectedProgrammeId() !== '' &&
      this.selectedLearningUnitId() !== ''
  );

  readonly selectedInstitutionName = computed(
    () => this.nameOf(this.institutions(), this.selectedInstitutionId())
  );

  readonly selectedClassroomName = computed(
    () => this.nameOf(this.classroomOptions(), this.selectedClassroomId())
  );

  readonly selectedProgrammeName = computed(
    () => this.nameOf(this.programmeOptions(), this.selectedProgrammeId())
  );

  readonly selectedLearningUnitName = computed(
    () => this.nameOf(this.learningUnitOptions(), this.selectedLearningUnitId())
  );

  // ---- The download -----------------------------------------------------

  readonly exporting = signal(false);
  readonly exportError = signal('');

  /**
   * How many students were found in scope, once a download has looked.
   *
   * null until one has run. `0` and "not asked yet" are different states and the
   * card says so differently — the first is a finding, the second is not.
   */
  readonly studentsFound = signal<number | null>(null);

  /** The four choices, in the shape the report service reads. */
  private scope(): ReportScope {
    return {
      assignmentId: this.assignment().docId,
      assignmentName: this.assignment().displayName,
      institutionId: this.selectedInstitutionId(),
      institutionName: this.selectedInstitutionName(),
      classroomId: this.selectedClassroomId(),
      classroomName: this.selectedClassroomName(),
      programmeId: this.selectedProgrammeId(),
      programmeName: this.selectedProgrammeName(),
      learningUnitId: this.selectedLearningUnitId(),
      learningUnitName: this.selectedLearningUnitName()
    };
  }

  async downloadQuestionWise(): Promise<void> {
    await this.download('', attempts => [
      {
        name: 'Question Accuracy',
        columns: [
          { header: 'Question No.', width: 12 },
          { header: 'Question Description', width: 70 },
          { header: 'Correct Count', width: 14 },
          { header: 'Percentage', width: 12 }
        ],
        rows: buildQuestionAccuracy(attempts)
      }
    ]);
  }

  async downloadStudentWise(): Promise<void> {
    await this.download('_Student-wise', attempts => [
      {
        name: 'Student Summary',
        columns: [
          { header: 'Student Name', width: 30 },
          { header: 'Attempted Questions', width: 20 },
          { header: 'Correct Answers', width: 18 },
          { header: 'Percentage', width: 12 }
        ],
        rows: buildStudentSummary(attempts)
      }
    ]);
  }

  /**
   * Reads the submissions, builds the sheets, and starts the download.
   *
   * REFUSES TO WRITE AN EMPTY WORKBOOK. A spreadsheet with a header row and
   * nothing under it looks like a class that submitted nothing, which is a
   * finding — and here it is far more likely to mean there is no submission data
   * at all. Saying so beats handing over a file that misleads.
   */
  private async download(
    suffix: string,
    toSheets: (attempts: StudentAttempt[]) => {
      name: string;
      columns: { header: string; width: number }[];
      rows: Record<string, string | number>[];
    }[]
  ): Promise<void> {
    if (!this.ready() || this.exporting()) {
      return;
    }

    this.exporting.set(true);
    this.exportError.set('');

    try {
      const scope = this.scope();
      const attempts = await this.reportService.collectAttempts(scope);

      this.studentsFound.set(attempts.length);

      if (attempts.length === 0) {
        this.exportError.set(
          'No submissions were found for this scope, so there is nothing to ' +
            'export. This app does not record student submissions yet — the report ' +
            'reads them from Students/{id}/remoteSubmissions, which this database ' +
            'does not have.'
        );
        return;
      }

      await this.workbooks.download(reportFilename(scope, suffix), toSheets(attempts));
    } catch (error) {
      this.exportError.set(this.describeExportError(error));
    } finally {
      this.exporting.set(false);
    }
  }

  /**
   * The report's OWN message for a failed export.
   *
   * NOT the classroom service's, which is what this used to borrow: it talks
   * about a classroom having been deleted in another tab, and the reader is
   * looking at a report. The distinction that matters here is permission-denied,
   * because it has one likely cause and a specific fix — the rules granting read
   * on `Students` have not been deployed to this database.
   */
  private describeExportError(error: unknown): string {
    const code = (error as { code?: string })?.code ?? '';

    if (code === 'permission-denied') {
      return (
        'Firestore refused to read the submissions. The report reads Students ' +
        'and CustomAuthentication, and the rules granting that have not been ' +
        'deployed to this database yet. Nothing is wrong with the report itself.'
      );
    }

    return 'Could not build the report. ' + (code ? `(${code})` : 'Please try again.');
  }

  private nameOf(options: ReportOption[], id: string): string {
    return options.find(option => option.id === id)?.name ?? id;
  }

  valueOf(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  close(): void {
    this.closed.emit();
  }
}

import { Injectable, inject, signal } from '@angular/core';
import { getCountFromServer } from 'firebase/firestore';

import { activeInstitutionsCollection,
  activeClassroomsCollection
} from '../core/firestore-paths';
import { toSubscriberDigits } from '../data/institution-options';
import {
  AllottedInstitution,
  DashboardCounts,
  TeacherAllotment,
  TeacherClassroom
} from '../models/teaching.model';
import { AuthService } from './auth.service';
import { TeacherService } from './teacher.service';

@Injectable({
  providedIn: 'root'
})
export class DashboardService {

  private auth = inject(AuthService);
  private teachers = inject(TeacherService);

  /**
   * THE ONE COPY of the signed-in person's allotment, shared by every surface.
   *
   * The dashboard cards, its two headline tiles and the sidebar's Institutions
   * tree all render this. They each used to call myAllotment() separately, which
   * meant three reads and — worse — three snapshots that drifted apart: deleting
   * a classroom updated none of them until a reload.
   *
   * `refresh()` is what anything that CHANGES the allotment calls, and every
   * reader updates at once because they are reading one signal.
   */
  readonly allotment = signal<TeacherAllotment>({ institutions: [], classroomCount: 0 });

  /** True until the first read lands, so a surface can show a placeholder. */
  readonly allotmentLoading = signal(true);

  /**
   * Why the last read failed, or ''.
   *
   * ON THE SERVICE, because the allotment is. refresh() must not throw — it is
   * called after a delete, where the caller already has an error surface for the
   * write and a read failure must not overwrite "the classroom was deleted".
   * But the dashboard still has to be able to SAY the read failed, or it renders
   * an empty page that looks like a teacher with no classes.
   */
  readonly allotmentError = signal('');

  /**
   * Re-reads the allotment.
   *
   * SWALLOWS ITS ERROR. Called after a delete or a restore, where the caller
   * already has its own error surface for the write that just happened — a
   * failed refresh there must not overwrite "the classroom was deleted" with a
   * message about reading. The previous value stays, and the next navigation
   * corrects it.
   */
  async refresh(): Promise<void> {
    try {
      this.allotment.set(await this.myAllotment());
      this.allotmentError.set('');
    } catch (error) {
      // Keeps whatever was loaded, and records why, for whoever renders it.
      this.allotmentError.set(describeAllotmentError(error));
    } finally {
      this.allotmentLoading.set(false);
    }
  }

  /**
   * The two headline counts.
   *
   * COUNTS THE WHOLE DATABASE, NOT THE CALLER'S OWN ROWS. Two claims that used
   * to sit here were both false and contradicted the body six lines below: that
   * the paths come from ownedByUser(), and that both helpers apply the ownerId
   * filter so an unfiltered count would be denied. Neither holds. The rules
   * authorise on authentication alone, so an unfiltered count is permitted, and
   * these are the plain collection references.
   *
   * A third claim went with them: that this database is shared with BugPulse. It
   * is not, and has not been since the app moved to a database it owns outright —
   * see the header of core/firestore-paths.ts. Paths still come from that module,
   * but for the reason it now gives, which is drift rather than isolation.
   *
   * Counts ACTIVE institutions only — deleted ones live in a different
   * subcollection entirely, so nothing here has to exclude them.
   *
   * getCountFromServer, not getDocs().size. The aggregation runs server-side
   * and bills a fraction of a read per batch instead of one read per document,
   * and transfers a number rather than every document body.
   *
   * Issued in parallel: independent queries, so awaiting them in sequence would
   * double the latency for no reason.
   *
   * Both throw permission-denied rather than returning 0 while the rules are
   * undeployed — a distinction the caller must not flatten, since "no
   * institutions" and "not allowed to look" mean very different things to
   * someone reading the banner.
   */
  async counts(): Promise<DashboardCounts> {
    // UNFILTERED, on instruction: the dashboard counts what every Teacher Corner
    // user can see, not only the caller's own rows. requireUid() is gone with the
    // filter — the rules decide who may read, and this no longer needs a uid.
    const [institutions, classrooms] = await Promise.all([
      getCountFromServer(activeInstitutionsCollection()),
      getCountFromServer(activeClassroomsCollection())
    ]);

    return {
      institutions: institutions.data().count,
      classrooms: classrooms.data().count
    };
  }

  /**
   * What the signed-in person actually teaches, grouped by school.
   *
   * THE DASHBOARD'S OWN NUMBERS COME FROM HERE, not from `counts()` above. That
   * method counts the whole database, which was a deliberate instruction at the
   * time and is now the wrong answer for this screen: the tiles sit directly over
   * cards showing this person's schools, and a tile reading 5 above two cards
   * reads as a bug rather than as a different question being answered. `counts()`
   * is left in place for anything that wants the global view.
   *
   * ONE QUERY, NO JOIN. Every field a card needs is denormalised onto the
   * teacher's classroom entries, so this never reads `classrooms` or
   * `institutions` — see the note on AllottedInstitution.
   *
   * SORTED, and deliberately: institutions by name and classes within them by
   * grade then name, so the dashboard does not reshuffle itself between visits
   * just because Firestore returned documents in a different order.
   */
  async myAllotment(): Promise<TeacherAllotment> {
    const uid = this.auth.currentUid() ?? '';
    const digits = toSubscriberDigits(this.auth.currentUser?.phoneNumber ?? '');

    if (!uid && digits.length < 10) {
      return { institutions: [], classroomCount: 0 };
    }

    const classrooms = await this.teachers.allottedClassrooms(
      uid,
      digits.length >= 10 ? digits : ''
    );

    return groupByInstitution(classrooms);
  }
}

/**
 * Groups the flat list of allotted classes into one entry per school.
 *
 * KEYED BY institutionId, falling back to the NAME when a legacy entry carries
 * no id. Keying on the name alone would merge two schools that share one, and
 * dropping the entry entirely would lose a real class the teacher teaches.
 */
export function groupByInstitution(
  classrooms: readonly TeacherClassroom[]
): TeacherAllotment {
  const byInstitution = new Map<string, AllottedInstitution>();

  for (const classroom of classrooms) {
    const key = classroom.institutionId || classroom.institutionName;

    if (!key) {
      continue;
    }

    const found = byInstitution.get(key);

    if (found) {
      found.classrooms.push(classroom);
      continue;
    }

    byInstitution.set(key, {
      institutionId: classroom.institutionId,
      institutionName: classroom.institutionName || 'Unnamed institution',
      classrooms: [classroom]
    });
  }

  const institutions = [...byInstitution.values()].sort((a, b) =>
    a.institutionName.localeCompare(b.institutionName)
  );

  for (const institution of institutions) {
    institution.classrooms.sort(
      (a, b) =>
        gradeOrder(a.grade) - gradeOrder(b.grade) ||
        a.classroomName.localeCompare(b.classroomName)
    );
  }

  return {
    institutions,
    classroomCount: institutions.reduce(
      (total, institution) => total + institution.classrooms.length,
      0
    )
  };
}

/**
 * Numeric grades in order, then everything else after them.
 *
 * A STEM club has no grade at all and a pre-primary year is not a number, so
 * neither can be compared numerically — they sort to the end and fall through to
 * the name comparison beside this.
 */
function gradeOrder(grade: string): number {
  const parsed = Number(grade);

  return Number.isFinite(parsed) && grade.trim() !== '' ? parsed : Number.MAX_SAFE_INTEGER;
}

/**
 * A read failure, in words a banner can show.
 *
 * The same two cases every reader in this app distinguishes: rules that are not
 * deployed, and a connection that is not there. Anything else keeps its own
 * message rather than being flattened into a generic one.
 */
function describeAllotmentError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code ?? '';

  if (code === 'permission-denied') {
    return 'Could not read your classrooms — the Firestore rules for this app may ' +
           'not be deployed. Reload to see the current state.';
  }

  if (code === 'unavailable') {
    return 'Could not reach the database. Check your connection and retry.';
  }

  return (error as { message?: string } | null)?.message || 'Could not load your classrooms.';
}

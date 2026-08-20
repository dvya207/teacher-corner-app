import { Injectable, inject } from '@angular/core';
import { getCountFromServer } from 'firebase/firestore';

import { activeInstitutionsCollection,
  activeClassroomsCollection
} from '../core/firestore-paths';
import { DashboardCounts } from '../models/teaching.model';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root'
})
export class DashboardService {

  private auth = inject(AuthService);

  /**
   * The two headline counts.
   *
   * Paths come from ownedByUser(), never from a hand-built reference. This
   * database is shared with BugPulse, and core/firestore-paths.ts is the single
   * choke point that keeps every reference inside Teacher Corner's collections.
   *
   * Counts ACTIVE institutions only — deleted ones live in a different
   * subcollection entirely, so nothing here has to exclude them.
   *
   * Both helpers apply the ownerId filter. That is required, not merely tidy:
   * the rules read resource.data, and Firestore rejects any query it cannot
   * prove will only return permitted documents. An unfiltered count is denied.
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
}

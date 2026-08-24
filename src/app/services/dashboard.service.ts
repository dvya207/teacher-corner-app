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
}

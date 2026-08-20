import { Injectable, computed, inject, signal } from '@angular/core';
import {
  Timestamp,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from 'firebase/firestore';

import { db } from '../core/firebase';
import {
  newNotificationDoc,
  notificationDoc,
  recentNotifications
} from '../core/firestore-paths';
import {
  NotificationAction,
  NotificationDraft,
  NotificationModule,
  TeacherNotification
} from '../models/teaching.model';
import { AuthService } from './auth.service';

/* ==========================================================================
   The wording

   Composed HERE, once, rather than at each of the twelve call sites, and stored
   on the document rather than derived at read time. A notification is a LOG
   ENTRY: what it said when it was written is what it should still say later, so
   re-wording the app must not silently re-word its own history.
   ========================================================================== */

/** The heading, e.g. "Institution added". */
export function notificationTitle(
  module: NotificationModule,
  action: NotificationAction
): string {
  const noun = { institution: 'Institution', classroom: 'Classroom', programme: 'Programme' }[module];

  // The assignment and status verbs are whole phrases, so "Classroom programme
  // assigned" and "Programme status changed" read as sentences rather than as a
  // noun with a word appended.
  const verb: Record<NotificationAction, string> = {
    // 'added' for an institution and 'created' for the other two, matching the
    // wording each module's own UI uses for the same act.
    created: module === 'institution' ? 'added' : 'created',
    updated: 'updated',
    deleted: 'deleted',
    restored: 'restored',
    verified: 'verified',
    unverified: 'unverified',
    assigned: 'programme assigned',
    unassigned: 'programme removed',
    status: 'status changed'
  };

  return `${noun} ${verb[action]}`;
}

/**
 * Builds a draft for one event.
 *
 * `subject` is the name the user sees in the table — an institution's name, a
 * classroom's title, a programme's display name — so the feed reads as a record
 * of what THEY did rather than a list of document ids.
 */
export function notificationFor(
  module: NotificationModule,
  action: NotificationAction,
  subject: string,
  targetId: string,
  detail = ''
): NotificationDraft {
  const idField = {
    institution: 'institutionId',
    classroom: 'classroomId',
    programme: 'programmeId'
  }[module];

  const named = subject.trim() || 'Untitled';

  return {
    module,
    action,
    title: notificationTitle(module, action),
    description: detail ? `${named} — ${detail}` : named,
    [idField]: targetId
  } as NotificationDraft;
}

/** Fills in fields a stored notification may predate. */
export function normaliseNotification(
  docId: string,
  data: Record<string, unknown>
): TeacherNotification {
  return {
    ...data,
    id: docId,
    module: (data['module'] as NotificationModule | undefined) ?? 'institution',
    action: (data['action'] as NotificationAction | undefined) ?? 'updated',
    title: (data['title'] as string | undefined) ?? '',
    description: (data['description'] as string | undefined) ?? '',
    read: data['read'] === true
  } as TeacherNotification;
}

/**
 * The signed-in teacher's notification feed.
 *
 * ONE IN-MEMORY COPY, shared by everything that reads it. The topbar bell and
 * the pages that write to it are on opposite sides of the app, so the feed lives
 * here as a signal: a page logs an event, the signal gains an entry, and the
 * bell's unread count updates with no listener and no reload.
 *
 * NOT A onSnapshot LISTENER, matching every other read in this app, which is
 * one-shot. The cost is that a feed written in another tab is not seen until the
 * next load; the gain is no subscription to tear down on sign-out, and no second
 * source of truth for a component to disagree with.
 *
 * LOGGING NEVER FAILS THE ACTION IT DESCRIBES. Every write here is best-effort:
 * if the notification cannot be stored, the institution that was just saved is
 * still saved, and the user is not shown an error about a side effect they did
 * not ask for. See log() for how that is contained.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {

  private auth = inject(AuthService);

  private readonly entries = signal<TeacherNotification[]>([]);

  /** Newest first, as the query returns them. */
  readonly feed = computed(() => this.entries());

  readonly unreadCount = computed(() => this.entries().filter(entry => !entry.read).length);

  /** True once a load has completed, so the panel can tell empty from unloaded. */
  readonly loaded = signal(false);

  /**
   * Loads the feed for the signed-in teacher.
   *
   * Swallows its own failure into an empty feed: the bell is furniture, and a
   * failed read of it must not put an error banner on whatever page is open.
   */
  async load(): Promise<void> {
    const uid = this.auth.currentUid();

    if (!uid) {
      this.entries.set([]);
      this.loaded.set(true);
      return;
    }

    try {
      const snapshot = await getDocs(recentNotifications(uid));

      this.entries.set(
        snapshot.docs.map(document => normaliseNotification(document.id, document.data()))
      );
    } catch {
      this.entries.set([]);
    } finally {
      this.loaded.set(true);
    }
  }

  /**
   * Appends one notification.
   *
   * The local signal is updated FIRST and unconditionally, so the bell reflects
   * what just happened even if the write is slow or fails. That is the right way
   * round for a log of the user's own actions: they know what they did, and a
   * feed that omits it looks broken, while a feed that shows an entry that failed
   * to persist self-corrects on the next load.
   */
  async log(draft: NotificationDraft): Promise<void> {
    const uid = this.auth.currentUid();

    if (!uid) {
      return;
    }

    const reference = newNotificationDoc(uid);
    const local: TeacherNotification = {
      ...draft,
      id: reference.id,
      read: false,
      createdAt: Timestamp.now()
    };

    this.entries.update(current => [local, ...current]);

    try {
      await setDoc(reference, {
        ...draft,
        read: false,
        createdAt: serverTimestamp()
      });
    } catch {
      // Deliberately silent. A notification is a side effect of an action that
      // has already succeeded; surfacing this would report a failure for
      // something the user did not ask for and cannot act on.
    }
  }

  /** Marks one entry read. */
  async markRead(id: string): Promise<void> {
    const uid = this.auth.currentUid();

    this.entries.update(current =>
      current.map(entry => (entry.id === id ? { ...entry, read: true } : entry))
    );

    if (!uid) {
      return;
    }

    try {
      await updateDoc(notificationDoc(uid, id), { read: true });
    } catch {
      // Same reasoning as log(): the local state is already correct.
    }
  }

  /**
   * Marks the whole feed read, in ONE batch rather than a write per entry.
   *
   * Only the unread ones are touched, so a full panel of already-read entries
   * costs no writes at all.
   */
  async markAllRead(): Promise<void> {
    const uid = this.auth.currentUid();
    const unread = this.entries().filter(entry => !entry.read);

    this.entries.update(current => current.map(entry => ({ ...entry, read: true })));

    if (!uid || unread.length === 0) {
      return;
    }

    try {
      const batch = writeBatch(db);

      for (const entry of unread) {
        batch.update(notificationDoc(uid, entry.id), { read: true });
      }

      await batch.commit();
    } catch {
      // As above.
    }
  }

  /** Clears the in-memory feed. Called on sign-out so nothing leaks to the next user. */
  reset(): void {
    this.entries.set([]);
    this.loaded.set(false);
  }
}

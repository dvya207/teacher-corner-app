import { Injectable } from '@angular/core';
import { ref, uploadBytesResumable } from 'firebase/storage';

import { storage } from '../core/firebase';

/** What went wrong, in words a row can show. */
export type UploadFailure = 'denied' | 'failed';

export interface UploadResult {
  /** The stored path, on success. */
  path?: string;
  error?: UploadFailure;
  /**
   * What was actually sent, when it was refused.
   *
   * The Storage rule checks contentType and size, and a refusal says only
   * "unauthorized" — so without these the message can do no better than "check
   * the file type and size", which is exactly the moment you most want to know
   * WHICH of the two it was.
   */
  contentType?: string;
  sizeMb?: number;
}

/**
 * Putting a file into Cloud Storage against a learning unit.
 *
 * THE PATH IS PRODUCTION'S: `learningUnits/{learningUnitDocId}/{fileName}`,
 * keeping the file's own name — its documents read
 * 'learningUnits/0Jgsn66ZQvGZ4eCKBMSN/TABP20EPENV10 Seed Dispersal Models_0.pptx'.
 * What is stored on the unit is that path, never a download URL: a URL carries a
 * token that can be revoked, and ResourceLinkService mints one on demand.
 *
 * THIS WILL BE DENIED until the bucket's rules grant it. helix-staging-india has
 * ONE bucket shared by several apps, and its live ruleset covers
 * bugpulse_attachments, posts, assignments and contests — there is no
 * learningUnits path in it. A denial is reported rather than thrown, so the row
 * can say what happened instead of the page breaking.
 */
@Injectable({
  providedIn: 'root'
})
export class ResourceUploadService {

  /**
   * Where a unit's files live.
   *
   * `folder` is for the grade-dependent ones, which production files a level
   * deeper: learningUnits/{docId}/GradeDependentResources/{fileName}.
   */
  pathFor(learningUnitDocId: string, fileName: string, folder = ''): string {
    const middle = folder ? `${folder}/` : '';

    return `learningUnits/${learningUnitDocId}/${middle}${fileName}`;
  }

  /**
   * RESUMABLE, and it reports progress. Both matter, and neither did before.
   *
   * This used `uploadBytes`, which sends the whole file as ONE request with no
   * progress events of any kind. The Storage rules cap a video at 500 MB, so
   * that was up to half a gigabyte going up behind a button whose label read a
   * flat "Uploading…" from the first byte to the last — nothing to tell the user
   * it was moving, and no way to tell a slow upload from a hung one. A dropped
   * connection also restarted the entire transfer from zero.
   *
   * `uploadBytesResumable` chunks it, resumes after a network blip, and emits
   * `state_changed` with bytesTransferred, which is what `onProgress` forwards.
   * This is also what production does — its Images tab reads
   * `bytesTransferred / totalBytes` off `ref.put(...).snapshotChanges()`.
   *
   * A resumable upload additionally sends its size in the initial handshake, so
   * a file over the rule's cap is refused BEFORE the bytes go up rather than
   * after — the single-shot version uploaded the whole thing and then learned it
   * was too big.
   *
   * `onProgress` is optional so the three callers that do not show a bar are
   * unaffected, and it fires once with 0 before any byte moves, so a slot can
   * show "0%" immediately instead of an empty label.
   */
  async upload(
    learningUnitDocId: string,
    file: File,
    folder = '',
    onProgress?: (percent: number) => void
  ): Promise<UploadResult> {
    const path = this.pathFor(learningUnitDocId, file.name, folder);

    try {
      const task = uploadBytesResumable(ref(storage, path), file, {
        contentType: file.type
      });

      if (onProgress) {
        onProgress(0);

        // The error and completion paths are handled by awaiting the task
        // itself, so this listener only ever reports progress. Its unsubscribe
        // is not kept: the task is finished by the time this method returns, and
        // Storage releases the listener with it.
        task.on('state_changed', snapshot => {
          const percent = snapshot.totalBytes === 0
            ? 0
            : Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);

          onProgress(percent);
        });
      }

      await task;

      return { path };
    } catch (error) {
      const code = (error as { code?: string } | null)?.code ?? '';

      return {
        error: code.includes('unauthorized') ? 'denied' : 'failed',
        contentType: file.type || '(none reported by the browser)',
        sizeMb: Math.round((file.size / (1024 * 1024)) * 10) / 10
      };
    }
  }
}

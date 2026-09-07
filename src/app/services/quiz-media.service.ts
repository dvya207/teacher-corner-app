import { Injectable } from '@angular/core';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';

import { storage } from '../core/firebase';

/** What an inline insertion needs: a URL to render, and the path that backs it. */
export interface InlineMedia {
  url: string;
  path: string;
}

/**
 * Uploads a file for inline use inside a quiz's rich text.
 *
 * SEPARATE FROM ResourceUploadService, which builds every path around a learning
 * unit document id — `learningUnits/{docId}/…`. A quiz is not a learning unit, and
 * bending that API would put quiz media under a learning unit that does not exist.
 *
 * `quizzer_resources/` is PRODUCTION'S OWN FOLDER, read from its data: a real quiz
 * question references `quizzer_resources/Observation Sheet Template.pdf`, and a
 * case-study image sits under `quizzer-casestudy-resources/`. Writing somewhere
 * else would work for this app and leave production's own tooling unable to find
 * the file.
 *
 * A DOWNLOAD URL IS RETURNED, not just the path, and that is required rather than
 * convenient: the value stored is HTML, and an `<img src>` has to be a URL the
 * browser can fetch. Production stores full firebasestorage URLs with tokens
 * inside `questionTitle` for exactly this reason.
 */
@Injectable({ providedIn: 'root' })
export class QuizMediaService {

  /** Production's folder for quiz media. */
  private readonly folder = 'quizzer_resources';

  /**
   * Uploads and returns the URL to embed.
   *
   * THE NAME IS PREFIXED, not used raw. Two teachers uploading `diagram.png`
   * would otherwise overwrite one another's file — and the first would find its
   * image silently replaced inside a quiz it had already published. The original
   * name is kept after the prefix so the file is still recognisable in the bucket.
   */
  async upload(file: File, onProgress?: (percent: number) => void): Promise<InlineMedia> {
    const path = `${this.folder}/${this.uniquePrefix()}-${this.safeName(file.name)}`;
    const task = uploadBytesResumable(ref(storage, path), file, { contentType: file.type });

    if (onProgress) {
      onProgress(0);
      task.on('state_changed', snapshot => {
        onProgress(
          snapshot.totalBytes === 0
            ? 0
            : Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
        );
      });
    }

    await task;

    return { url: await getDownloadURL(task.snapshot.ref), path };
  }

  /**
   * Random enough for a filename, and not a timestamp.
   *
   * Two uploads inside the same millisecond are unlikely but not impossible, and
   * a collision here overwrites somebody's file rather than failing loudly.
   */
  private uniquePrefix(): string {
    return Math.random().toString(36).slice(2, 10);
  }

  /**
   * Strips what a Storage path cannot carry.
   *
   * A '/' in a filename would create a folder, and a '#' or '?' truncates the URL
   * that comes back. Everything else is left alone so the name stays readable.
   */
  private safeName(name: string): string {
    return name.replace(/[/\\#?]+/g, '-').trim() || 'file';
  }
}

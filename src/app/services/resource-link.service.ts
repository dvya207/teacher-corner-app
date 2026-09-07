import { Injectable } from '@angular/core';
import { getDownloadURL, ref } from 'firebase/storage';

import { storage } from '../core/firebase';

/**
 * Opening what a resource slot points at.
 *
 * A slot holds one of two things and they need different handling:
 *
 *   A LINK   'https://youtu.be/…' — opens as it is.
 *   A PATH   'learningUnits/{docId}/guide.pdf' — a location in Cloud Storage,
 *            which has to be exchanged for a download URL before a browser can
 *            show it. The path is stored rather than the URL because a download
 *            URL carries a token that can be revoked.
 *
 * READ ONLY. Nothing here uploads; this is the half of Storage that lets View
 * work, and it is deliberately all this app can do with the bucket.
 */
@Injectable({
  providedIn: 'root'
})
export class ResourceLinkService {

  /** True for something already openable, so no round trip is needed. */
  isLink(value: string): boolean {
    return /^https?:\/\//i.test(String(value ?? '').trim());
  }

  /**
   * The URL a slot's value opens at, or null if it cannot be resolved.
   *
   * Null rather than a throw: a missing file and a bucket this app may not read
   * are the same thing to the caller — there is nothing to show — and the button
   * that called this has to say so rather than break the page.
   */
  async urlFor(value: string): Promise<string | null> {
    const path = String(value ?? '').trim();

    if (path === '') {
      return null;
    }

    if (this.isLink(path)) {
      return path;
    }

    try {
      return await getDownloadURL(ref(storage, path));
    } catch {
      return null;
    }
  }

  /**
   * Opens it in a new tab.
   *
   * `noopener` because the opened page gets a handle on this one otherwise, and
   * these URLs point at buckets and video sites rather than anything this app
   * controls.
   */
  async open(value: string): Promise<boolean> {
    const url = await this.urlFor(value);

    if (!url) {
      return false;
    }

    window.open(url, '_blank', 'noopener');

    return true;
  }
}

import { Component, input, output } from '@angular/core';

import { Icon, IconName } from '../icon/icon';

/**
 * One destructive-action confirmation, for every list page.
 *
 * The markup was already duplicated three times — Institutions, Classrooms and
 * Programme each carry their own copy of the same overlay, card, icon badge and
 * Cancel/Delete pair — and the shared `.confirm-*` rules in `styles.css` exist
 * precisely because those copies were drifting. This is the other half of that
 * fix: the rules were centralised there, the STRUCTURE is centralised here, so
 * the next page that needs a confirmation inherits both.
 *
 * Everything that varies between callers is an input; nothing about the write
 * itself lives here. The dialog reports `confirmed` and `cancelled` and the page
 * owns the Firestore call, its busy state and its error surface — the same
 * division the form modal already uses.
 *
 * `heading` rather than `title`: `title` on a component host would collide with
 * the global HTML attribute of that name, which every other button in this app
 * uses for its tooltip.
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [Icon],
  templateUrl: './confirm-dialog.html',
  // Escape cancels. Bound on the host as a document listener for the same
  // reason the form modal does it: the backdrop is deliberately not focusable,
  // so it can never receive a keydown of its own.
  host: {
    '(document:keydown.escape)': 'cancelled.emit()'
  }
})
export class ConfirmDialog {

  readonly heading = input.required<string>();

  /** The line under the heading. Omitted when the heading says it all. */
  readonly message = input('');

  /** A consequence that has to be READ, not absorbed — rendered amber. */
  readonly warning = input('');

  readonly icon = input<IconName>('trash');

  readonly confirmLabel = input('Confirm');
  readonly cancelLabel = input('Cancel');

  /** Shown on the confirm button while the caller's write is in flight. */
  readonly busyLabel = input('Working…');

  /**
   * Owned by the CALLER, not by this component.
   *
   * The page already tracks which row is busy, and a second copy here could
   * disagree with it — so the dialog renders that state rather than keeping it.
   */
  readonly busy = input(false);

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
}

import { Component, computed, input } from '@angular/core';

/**
 * The ThinkTac logo.
 *
 * This renders the OFFICIAL artwork from public/assets/logo/, not a
 * hand-drawn approximation. The mark is a spiral of navy and cyan dots around
 * a cyan centre, which is not something to reproduce by eye — an earlier
 * version of this component drew concentric rings and was visibly wrong.
 *
 * The four files are the vendor's two SVGs (colour + white) re-cropped via
 * their viewBox only:
 *
 *   thinktac-logo-{colour,white}.svg   full lockup, tight — no dead margin,
 *                                      so `size` is exactly the rendered height
 *   thinktac-mark-{colour,white}.svg   square, mark only, for a collapsed rail
 *
 * The paths and fills are untouched, so these stay pixel-identical to the
 * artwork the live site serves.
 */
@Component({
  selector: 'app-logo',
  template: `
    <img
      class="logo"
      [src]="src()"
      [style.height.px]="size()"
      [alt]="alt()"
      draggable="false"
    />
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
    }

    /* width:auto so the aspect ratio follows the height alone. The lockup is
       ~4.3:1 and the mark is 1:1, so a caller sets one number and gets the
       right box either way. */
    .logo {
      display: block;
      width: auto;
      user-select: none;
    }
  `
})
export class Logo {

  /** 'dark' for light backgrounds, 'light' for the purple sidebar. */
  readonly variant = input<'dark' | 'light'>('dark');

  /** Rendered HEIGHT in px. Width follows from the artwork's aspect ratio. */
  readonly size = input(34);

  /** Mark only, no wordmark. For the collapsed sidebar rail. */
  readonly compact = input(false);

  /**
   * Empty where a wrapping link already carries an aria-label, so the logo is
   * not announced twice.
   */
  readonly alt = input('ThinkTac');

  readonly src = computed(() => {
    const tone = this.variant() === 'light' ? 'white' : 'colour';
    const kind = this.compact() ? 'mark' : 'logo';

    return `assets/logo/thinktac-${kind}-${tone}.svg`;
  });
}

import { Component, input } from '@angular/core';

export type IconName =
  | 'grid' | 'settings' | 'classroom' | 'programme' | 'book'
  | 'users' | 'star' | 'chart' | 'building'
  | 'bell' | 'search' | 'chevron-left' | 'chevron-down' | 'logout' | 'login'
  | 'mail' | 'lock' | 'eye' | 'eye-off' | 'plus' | 'check' | 'google'
  | 'trophy' | 'clipboard' | 'box' | 'edit' | 'arrow-right' | 'close' | 'check-mail'
  | 'trash' | 'plus-circle' | 'minus' | 'bank' | 'restore' | 'check-circle' | 'map-pin' | 'venus' | 'translate'
  | 'grip' | 'list' | 'download';

/**
 * Every icon in the app, in one place.
 *
 * The alternative — pasting SVG into each template — meant the same path
 * duplicated across the sidebar, the topbar and the hero, with stroke widths
 * drifting apart between copies. Here one set of attributes on the wrapping
 * <svg> applies to all of them, so the whole set stays optically consistent.
 *
 * Google is the one exception: it is a four-colour brand mark, so it renders
 * its own filled paths instead of inheriting stroke and currentColor.
 */
@Component({
  selector: 'app-icon',
  template: `
    @if (name() === 'google') {
      <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.5 5.5 0 0 1-2.4 3.6v3h3.87c2.26-2.09 3.56-5.17 3.56-8.84Z"/>
        <path fill="#34A853" d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.87-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.28v3.09A12 12 0 0 0 12 24Z"/>
        <path fill="#FBBC05" d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.28a12 12 0 0 0 0 10.76l3.99-3.09Z"/>
        <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.62l3.99 3.09C6.22 6.87 8.87 4.75 12 4.75Z"/>
      </svg>
    } @else {
      <svg
        [attr.width]="size()"
        [attr.height]="size()"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        [attr.stroke-width]="strokeWidth()"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        @switch (name()) {
          @case ('grid') {
            <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
            <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
            <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
            <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
          }
          @case ('settings') {
            <circle cx="12" cy="12" r="3.1" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.1 4.7a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03Z" />
          }
          @case ('classroom') {
            <path d="M3 10.5 12 3.5l9 7" />
            <path d="M5 9.8V20h14V9.8" />
            <path d="M9.5 20v-5.2h5V20" />
          }
          @case ('programme') {
            <rect x="3" y="4" width="18" height="14" rx="2.2" />
            <path d="M8 21h8M12 18v3" />
            <path d="M7.5 13.5v-3M11 13.5v-5.5M14.5 13.5v-2M18 13.5v-4" />
          }
          @case ('book') {
            <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H10a2.5 2.5 0 0 1 2 1 2.5 2.5 0 0 1 2-1h4.5A1.5 1.5 0 0 1 20 4.5v13a1.5 1.5 0 0 1-1.5 1.5H14a2.5 2.5 0 0 0-2 1 2.5 2.5 0 0 0-2-1H5.5A1.5 1.5 0 0 1 4 17.5Z" />
            <path d="M12 4v16" />
          }
          @case ('users') {
            <path d="M16.5 20v-1.8a3.6 3.6 0 0 0-3.6-3.6H6.6A3.6 3.6 0 0 0 3 18.2V20" />
            <circle cx="9.75" cy="7.4" r="3.4" />
            <path d="M21 20v-1.8a3.6 3.6 0 0 0-2.7-3.48M15.6 4.2a3.6 3.6 0 0 1 0 6.97" />
          }
          @case ('star') {
            <path d="m12 3.5 2.7 5.47 6.05.88-4.38 4.26 1.04 6.02L12 17.28l-5.41 2.85 1.04-6.02L3.25 9.85l6.05-.88Z" />
          }
          @case ('chart') {
            <path d="M3 3v16.5A1.5 1.5 0 0 0 4.5 21H21" />
            <path d="m7 15 3.6-4.2 3.2 2.6L19 7" />
          }
          @case ('building') {
            <rect x="4" y="3" width="16" height="18" rx="2" />
            <path d="M9 21v-3.6h6V21" />
            <path d="M8.5 7h1.2M14.3 7h1.2M8.5 10.6h1.2M14.3 10.6h1.2M8.5 14.2h1.2M14.3 14.2h1.2" />
          }
          @case ('bell') {
            <path d="M18 8.6a6 6 0 1 0-12 0c0 6-2 7.4-2 7.4h16s-2-1.4-2-7.4Z" />
            <path d="M13.7 19.5a2 2 0 0 1-3.4 0" />
          }
          @case ('search') {
            <circle cx="11" cy="11" r="7.2" />
            <path d="m20.5 20.5-4.2-4.2" />
          }
          @case ('chevron-left') {
            <path d="m14.5 5.5-6 6.5 6 6.5" />
          }
          @case ('chevron-down') {
            <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
          }
          @case ('logout') {
            <path d="M9.5 20H5.6A1.6 1.6 0 0 1 4 18.4V5.6A1.6 1.6 0 0 1 5.6 4h3.9" />
            <path d="m15.5 16.5 4.5-4.5-4.5-4.5M20 12H9.5" />
          }
          @case ('restore') {
            <path d="M3.6 12a8.4 8.4 0 1 0 2.5-6" />
            <path d="M3.4 4.2v5h5" />
            <path d="M12 8.2V12l2.8 1.7" />
          }
          @case ('trash') {
            <path d="M4 6.5h16M9.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.5" />
            <path d="M6.5 6.5 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-12.5" />
            <path d="M10.4 10.2v6.4M13.6 10.2v6.4" />
          }
          @case ('plus-circle') {
            <circle cx="12" cy="12" r="8.6" />
            <path d="M12 8.2v7.6M8.2 12h7.6" />
          }
          @case ('minus') {
            <path d="M5.5 12h13" />
          }
          @case ('bank') {
            <path d="M3.4 9.4 12 4.4l8.6 5" />
            <path d="M5.4 9.9v8.3M9.5 9.9v8.3M14.5 9.9v8.3M18.6 9.9v8.3" />
            <path d="M3.2 20.4h17.6" />
          }
          @case ('trophy') {
            <path d="M7.5 4h9v5.2a4.5 4.5 0 0 1-9 0Z" />
            <path d="M7.5 5.6H5.2a2.2 2.2 0 0 0 0 4.4h.9M16.5 5.6h2.3a2.2 2.2 0 0 1 0 4.4h-.9" />
            <path d="M12 13.7V17M8.8 20h6.4M9.6 20a2.4 2.4 0 0 1 2.4-3 2.4 2.4 0 0 1 2.4 3" />
          }
          @case ('clipboard') {
            <rect x="5" y="4.6" width="14" height="16" rx="2.2" />
            <path d="M9 4.6a1.6 1.6 0 0 1 1.6-1.6h2.8A1.6 1.6 0 0 1 15 4.6v1.2H9Z" />
            <path d="m8.8 12.4 1.9 1.9 3.6-3.8" />
          }
          @case ('box') {
            <path d="M20.5 8.2v7.6a1.6 1.6 0 0 1-.85 1.42l-6.9 3.6a1.6 1.6 0 0 1-1.5 0l-6.9-3.6a1.6 1.6 0 0 1-.85-1.42V8.2" />
            <path d="m3.7 7.5 7.55-3.9a1.6 1.6 0 0 1 1.5 0l7.55 3.9-8.3 4.3Z" />
            <path d="M12 11.8v8.6" />
          }
          @case ('edit') {
            <path d="M11 5.5H6.4A1.9 1.9 0 0 0 4.5 7.4v10.2a1.9 1.9 0 0 0 1.9 1.9h10.2a1.9 1.9 0 0 0 1.9-1.9V13" />
            <path d="M17.2 3.9a1.9 1.9 0 0 1 2.7 2.7L12.6 14 9 15l1-3.6Z" />
          }
          @case ('grip') {
            <path d="M9 6.5h.01M9 12h.01M9 17.5h.01M15 6.5h.01M15 12h.01M15 17.5h.01" />
          }
          @case ('list') {
            <!-- The other half of the Learning Units view toggle. Paired with
                 'grid' above, so the two must read as one control: same 7.5-unit
                 rhythm, rows instead of squares. -->
            <path d="M4 6.5h2.5M4 12h2.5M4 17.5h2.5" />
            <path d="M10 6.5h10M10 12h10M10 17.5h10" />
          }
          @case ('download') {
            <path d="M12 3.5v11M7.8 10.4 12 14.6l4.2-4.2" />
            <path d="M4.5 17v1.9A1.6 1.6 0 0 0 6.1 20.5h11.8a1.6 1.6 0 0 0 1.6-1.6V17" />
          }
          @case ('arrow-right') {
            <path d="M4.5 12h14M13 6.5l5.5 5.5L13 17.5" />
          }
          @case ('close') {
            <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
          }
          @case ('check-mail') {
            <rect x="3" y="5" width="18" height="14" rx="2.2" />
            <path d="m3.8 6.6 7.3 5.3a1.5 1.5 0 0 0 1.8 0l7.3-5.3" />
            <path d="m9.2 14.6 1.7 1.7 3.6-3.6" />
          }
          @case ('login') {
            <path d="M14.5 4h3.9A1.6 1.6 0 0 1 20 5.6v12.8a1.6 1.6 0 0 1-1.6 1.6h-3.9" />
            <path d="m9.5 16.5 4.5-4.5-4.5-4.5M14 12H3.5" />
          }
          @case ('check') {
            <circle cx="12" cy="12" r="9" />
            <path d="m8 12.2 2.75 2.75L16.2 9.5" />
          }
          @case ('venus') {
            <!-- Gender Types. The Venus symbol: ring over a cross. -->
            <circle cx="12" cy="9" r="5" />
            <path d="M12 14v7" />
            <path d="M8.8 18h6.4" />
          }
          @case ('translate') {
            <!-- Medium of Instruction and Type of School both carry this in the
                 reference: two overlapping cards, a letter on one and a script
                 glyph on the other. Drawn in this set's stroke idiom rather than
                 copied from any vendor's brand mark. -->
            <rect x="2.6" y="2.6" width="12" height="12" rx="2.4" />
            <path d="M5.6 11.2 8.6 5.6l3 5.6" />
            <path d="M6.6 9.4h4" />
            <rect x="9.4" y="9.4" width="12" height="12" rx="2.4" />
            <path d="M12.2 12.6h6" />
            <path d="M15.2 12.6v.9c0 2.4-1.3 4.3-3 5.1" />
            <path d="M13.4 15.1c.5 1.9 1.9 3.3 3.8 3.9" />
          }
          @case ('map-pin') {
            <!-- Every field on the Address tab carries this, which is what makes
                 that tab read as one group at a glance. -->
            <path d="M20 10.2c0 5.8-8 11.8-8 11.8s-8-6-8-11.8a8 8 0 0 1 16 0Z" />
            <circle cx="12" cy="10" r="3" />
          }
          @case ('check-circle') {
            <!-- The open-ring confirmation mark: the ring stops short between
                 1 and 2 o'clock and the tick runs out through the gap. Distinct
                 from 'check' above, which closes the ring and keeps the tick
                 inside it — that one reads better at the 14–16px inline sizes it
                 is used at, this one at the 30px+ a success panel wants. -->
            <path d="M21.8 10A10 10 0 1 1 17 3.34" />
            <path d="m9 11 3 3 10-10" />
          }
          @case ('mail') {
            <rect x="3" y="5" width="18" height="14" rx="2.2" />
            <path d="m3.8 6.6 7.3 5.3a1.5 1.5 0 0 0 1.8 0l7.3-5.3" />
          }
          @case ('lock') {
            <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
            <path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9" />
          }
          @case ('eye') {
            <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
            <circle cx="12" cy="12" r="3" />
          }
          @case ('eye-off') {
            <path d="M10 5.98A9.6 9.6 0 0 1 12 5.8c6 0 9.5 6.2 9.5 6.2a17.4 17.4 0 0 1-2.55 3.4M6.3 7.7A17 17 0 0 0 2.5 12S6 18.2 12 18.2a9.4 9.4 0 0 0 3.9-.83" />
            <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
            <path d="m3.5 3.5 17 17" />
          }
          @case ('plus') {
            <path d="M12 5.5v13M5.5 12h13" />
          }
        }
      </svg>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
  `
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(20);
  readonly strokeWidth = input(1.8);
}

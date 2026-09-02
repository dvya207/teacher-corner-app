import {
  Component,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';

import { Icon } from '../icon/icon';
import { QuizMediaService } from '../../services/quiz-media.service';

/** One toolbar button: the command to run and what to show. */
interface Mark {
  command: string;
  value?: string;
  label: string;
  title: string;
  /** Rendered in a heavier weight, so a bold button looks bold. */
  style?: string;
}

/** One option of the header or size select. */
interface Choice {
  value: string;
  label: string;
}

/**
 * Rich text over `contenteditable`, with production's toolbar.
 *
 * THE FULL SET, matching the reference button for button: bold, italic,
 * underline, strike; a HEADER select and a SIZE select; ordered and bulleted
 * lists; outdent and indent; blockquote and code block; subscript and
 * superscript; text colour and highlight; alignment; IMAGE and PDF insertion; and
 * clear formatting.
 *
 * WHY NOT QUILL, which is what production uses. The stored value is plain HTML
 * either way, so anything that produces HTML is compatible — and Quill would add
 * a dependency, its own stylesheet, and a wrapper to bridge its Delta model back
 * to the HTML string these fields hold. What it would buy is a nicer colour
 * picker; what it would cost is a second rendering model for the same data.
 *
 * `document.execCommand` is deprecated and has no replacement for this job. Every
 * browser still implements it for contenteditable, and the alternative is
 * hand-writing selection and range manipulation for fourteen commands.
 *
 * `styleWithCSS` IS TURNED ON before each command. Without it Chrome emits legacy
 * `<font size>` and `<font color>` tags, which are valid HTML but not what
 * production's Quill output looks like, and which are harder for anything else to
 * restyle later.
 *
 * ZONELESS. The value is a signal input and changes are emitted, so the parent
 * owns the state and this component holds none of it.
 */
@Component({
  selector: 'app-rich-text',
  imports: [Icon],
  templateUrl: './rich-text.html',
  styleUrl: './rich-text.css'
})
export class RichText {

  readonly value = input('');
  readonly placeholder = input('');
  /** Rows of height, so a question title can be shorter than a case study. */
  readonly minHeight = input(160);

  /**
   * Whether the Image and PDF buttons are offered.
   *
   * They upload to Cloud Storage, so they are only correct where that is wanted.
   * Defaulted ON, because the two fields using this component — a case-study
   * description and a question title — both carry media in production's data.
   */
  readonly allowMedia = input(true);

  /**
   * A ONE-ROW TOOLBAR: the four marks and clear-formatting, nothing else.
   *
   * Production uses the full toolbar for a quiz question and a SHORT one for an
   * upload slot's instructions, and the difference is not decoration — a slot's
   * instructions are a sentence or two telling a student what file to send, so
   * headings, alignment and code blocks are controls that only get in the way.
   *
   * The full bar is still the default, because the fields that had this component
   * first are the ones that need it.
   */
  readonly compact = input(false);

  readonly changed = output<string>();

  private media = inject(QuizMediaService);

  private readonly surface = viewChild<ElementRef<HTMLDivElement>>('surface');

  /** Whether the surface holds nothing, so the placeholder can show. */
  readonly empty = signal(true);

  /** Upload progress, 0–100, or null when nothing is uploading. */
  readonly uploading = signal<number | null>(null);

  readonly uploadError = signal('');

  readonly marks: Mark[] = [
    { command: 'bold', label: 'B', title: 'Bold', style: 'font-weight:700' },
    { command: 'italic', label: 'I', title: 'Italic', style: 'font-style:italic' },
    { command: 'underline', label: 'U', title: 'Underline', style: 'text-decoration:underline' },
    { command: 'strikeThrough', label: 'S', title: 'Strikethrough', style: 'text-decoration:line-through' }
  ];

  /** Production's header select: H1, H2, H3, Normal. */
  readonly headers: Choice[] = [
    { value: 'p', label: 'Normal' },
    { value: 'h1', label: 'H1' },
    { value: 'h2', label: 'H2' },
    { value: 'h3', label: 'H3' }
  ];

  /**
   * Production's size select, with ITS OWN four names.
   *
   * Quill's are Small / Normal / Large / Huge, and the values are the CSS keywords
   * execCommand('fontSize') maps to under styleWithCSS — 2, 3, 5, 7 on the legacy
   * 1–7 scale.
   */
  readonly sizes: Choice[] = [
    { value: '2', label: 'Small' },
    { value: '3', label: 'Normal' },
    { value: '5', label: 'Large' },
    { value: '7', label: 'Huge' }
  ];

  readonly lists: Mark[] = [
    { command: 'insertOrderedList', label: '1.', title: 'Numbered list' },
    { command: 'insertUnorderedList', label: '•', title: 'Bulleted list' },
    { command: 'outdent', label: '⇤', title: 'Decrease indent' },
    { command: 'indent', label: '⇥', title: 'Increase indent' }
  ];

  readonly blocks: Mark[] = [
    { command: 'formatBlock', value: 'blockquote', label: '❝', title: 'Quote' },
    { command: 'formatBlock', value: 'pre', label: '</>', title: 'Code block' },
    { command: 'subscript', label: 'x₂', title: 'Subscript' },
    { command: 'superscript', label: 'x²', title: 'Superscript' }
  ];

  readonly aligns: Mark[] = [
    { command: 'justifyLeft', label: '⯇', title: 'Align left' },
    { command: 'justifyCenter', label: '≡', title: 'Align centre' },
    { command: 'justifyRight', label: '⯈', title: 'Align right' }
  ];

  constructor() {
    /*
     * WRITES THE INCOMING VALUE INTO THE DOM, but only when it differs.
     *
     * contenteditable is not a controlled input: assigning innerHTML on every
     * keystroke would move the caret to the start after each character. The guard
     * is what makes this safe — the parent's value and the DOM agree while typing,
     * so nothing is written back, and an external change (opening an existing
     * question) does land.
     */
    effect(() => {
      const incoming = this.value();
      const element = this.surface()?.nativeElement;

      if (element && element.innerHTML !== incoming) {
        element.innerHTML = incoming;
      }

      this.empty.set(this.isBlank(incoming));
    });
  }

  /**
   * Runs a formatting command on the current selection.
   *
   * `preventDefault` on mousedown rather than a click handler: clicking a button
   * moves focus out of the editable surface first, and the selection is lost
   * before the command can act on it.
   */
  apply(mark: Mark, event: Event): void {
    event.preventDefault();
    this.run(mark.command, mark.value);
  }

  /** The header and size selects, which carry their value on the element. */
  applyValue(command: string, value: string): void {
    this.run(command, value);
  }

  /**
   * Text and highlight colour, from a native colour input.
   *
   * `<input type="color">` rather than a palette popover: it is the platform's own
   * picker, it works with the keyboard, and a hand-rolled grid of swatches would
   * offer fewer colours than production's while being more code.
   */
  applyColour(command: 'foreColor' | 'hiliteColor', value: string): void {
    this.run(command, value);
  }

  onInput(): void {
    this.emit();
  }

  /**
   * PASTES AS PLAIN TEXT.
   *
   * A paste from a word processor carries its own fonts, colours and sizes, and
   * pasting that into a field production renders inside its own styles produces
   * text that looks broken in the app and cannot be fixed from this toolbar.
   */
  onPaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text/plain') ?? '';

    event.preventDefault();
    document.execCommand('insertText', false, text);
    this.emit();
  }

  /**
   * Uploads the chosen file and inserts it at the caret.
   *
   * IMAGE becomes an `<img>`; a PDF becomes a link. Production embeds a PDF with
   * its own delete control, which needs a widget inside the contenteditable and
   * the machinery to keep it out of the text model — a link is honest about what
   * it is, opens the file, and can be removed like any other content.
   *
   * The caret is captured BEFORE the upload. An upload takes seconds, focus is
   * long gone by the time it resolves, and `insertHTML` with no selection appends
   * to the end of the document — which is not where the user was typing.
   */
  async insertMedia(kind: 'image' | 'pdf', event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    // Cleared immediately, so choosing the same file twice fires again.
    input.value = '';

    if (!file) {
      return;
    }

    const element = this.surface()?.nativeElement;
    const range = this.captureRange();

    this.uploadError.set('');
    this.uploading.set(0);

    try {
      const { url } = await this.media.upload(file, percent => this.uploading.set(percent));

      element?.focus();
      this.restoreRange(range);

      const html =
        kind === 'image'
          ? `<img src="${this.escape(url)}" alt="${this.escape(file.name)}" />`
          : `<p><a href="${this.escape(url)}" target="_blank" rel="noopener">` +
            `${this.escape(file.name)}</a></p>`;

      document.execCommand('insertHTML', false, html);
      this.emit();
    } catch {
      // Named rather than swallowed: an upload that fails silently looks like a
      // button that does nothing, and the file is usually the reason (too large,
      // or a type the bucket's rules refuse).
      this.uploadError.set(`Could not upload ${file.name}.`);
    } finally {
      this.uploading.set(null);
    }
  }

  private run(command: string, value?: string): void {
    const element = this.surface()?.nativeElement;

    if (!element) {
      return;
    }

    element.focus();

    /* CSS rather than <font> tags — see the class note. Set before every command
       because other editors on the page can flip it back. */
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(command, false, value);
    this.emit();
  }

  /** The caret, so it can be put back after an await. */
  private captureRange(): Range | null {
    const selection = window.getSelection();

    return selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
  }

  private restoreRange(range: Range | null): void {
    if (!range) {
      return;
    }

    const selection = window.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  /** A URL and a filename both go into an attribute, so both need escaping. */
  private escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private emit(): void {
    const html = this.surface()?.nativeElement.innerHTML ?? '';

    this.empty.set(this.isBlank(html));
    this.changed.emit(html);
  }

  /**
   * Whether the HTML amounts to nothing.
   *
   * An "empty" contenteditable is rarely an empty string: browsers leave '<br>',
   * '<p><br></p>' or '<div><br></div>' behind, and a placeholder shown only for ''
   * would never appear again once the user had typed and deleted.
   *
   * AN IMAGE COUNTS AS CONTENT. Stripping every tag would call a title holding
   * only a diagram empty — and production has questions exactly like that — so
   * `<img>` is checked for before the tags come off.
   */
  private isBlank(html: string): boolean {
    if (/<img\b/i.test(html)) {
      return false;
    }

    return html.replace(/<br\s*\/?>|<\/?[a-z][^>]*>|&nbsp;|\s/gi, '') === '';
  }
}

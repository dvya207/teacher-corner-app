import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ConfirmDialog } from './confirm-dialog';

/**
 * ConfirmDialog — the shared destructive-action confirmation.
 *
 * WHY THIS EXISTS. This component is the last thing standing between a click on
 * a trash icon and a Firestore write, and it is shared, so a regression here is
 * a regression on every page that adopts it. The failure modes worth pinning are
 * all silent ones: a Cancel that emits `confirmed`, a backdrop that swallows the
 * click meant to dismiss it, a card click that dismisses it anyway, or a confirm
 * button still live while the caller's write is in flight — which is how one
 * double-click becomes two deletes.
 *
 * No services and no Firebase: every input is a value and every output is an
 * event, which is the whole point of having lifted the write out of here.
 */
describe('ConfirmDialog', () => {

  let fixture: ComponentFixture<ConfirmDialog>;
  let confirmed: number;
  let cancelled: number;

  /** Renders the dialog with the Learning Units wording as the default case. */
  function render(inputs: Record<string, unknown> = {}): void {
    fixture = TestBed.createComponent(ConfirmDialog);

    fixture.componentRef.setInput('heading', 'Delete Version');
    fixture.componentRef.setInput('message', 'Are you sure you want to delete this version?');

    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }

    confirmed = 0;
    cancelled = 0;
    fixture.componentInstance.confirmed.subscribe(() => confirmed++);
    fixture.componentInstance.cancelled.subscribe(() => cancelled++);

    fixture.detectChanges();
  }

  function query<T extends HTMLElement>(selector: string): T {
    const found = fixture.nativeElement.querySelector(selector) as T | null;

    if (!found) {
      throw new Error(`No element matched ${selector}`);
    }

    return found;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ConfirmDialog] }).compileComponents();
  });

  it('renders the heading and message it was given', () => {
    render();

    expect(query('.confirm-card h2').textContent?.trim()).toBe('Delete Version');
    expect(query('.confirm-card p').textContent?.trim())
      .toBe('Are you sure you want to delete this version?');
  });

  it('omits the message and the warning when neither was given', () => {
    render({ message: '' });

    expect(fixture.nativeElement.querySelector('.confirm-card p')).toBeNull();
    expect(fixture.nativeElement.querySelector('.confirm-warn')).toBeNull();
  });

  it('renders a warning separately from the message', () => {
    render({ warning: 'This cannot be undone.' });

    expect(query('.confirm-warn').textContent?.trim()).toBe('This cannot be undone.');
  });

  it('emits confirmed only from the confirm button', () => {
    render({ confirmLabel: 'Confirm' });

    const confirm = query<HTMLButtonElement>('.btn-danger');
    expect(confirm.textContent?.trim()).toBe('Confirm');

    confirm.click();

    expect(confirmed).toBe(1);
    expect(cancelled).toBe(0);
  });

  it('emits cancelled from the cancel button', () => {
    render();

    query<HTMLButtonElement>('.btn-ghost').click();

    expect(cancelled).toBe(1);
    expect(confirmed).toBe(0);
  });

  it('emits cancelled from a click on the backdrop', () => {
    render();

    query('.confirm-overlay').click();

    expect(cancelled).toBe(1);
  });

  /* A click inside the card must NOT fall through to the backdrop — otherwise
     selecting the message text closes the dialog. */
  it('does not emit cancelled from a click inside the card', () => {
    render();

    query('.confirm-card').click();

    expect(cancelled).toBe(0);
    expect(confirmed).toBe(0);
  });

  it('emits cancelled on Escape', () => {
    render();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(cancelled).toBe(1);
  });

  /* The busy state is the caller's, and this is what the dialog owes it: a
     button that cannot be pressed a second time, saying so. */
  it('disables the confirm button and shows the busy label while busy', () => {
    render({ busy: true, busyLabel: 'Deleting…' });

    const confirm = query<HTMLButtonElement>('.btn-danger');

    expect(confirm.disabled).toBe(true);
    expect(confirm.textContent?.trim()).toBe('Deleting…');

    confirm.click();

    expect(confirmed).toBe(0);
  });

  /* Cancel stays live while the write is in flight: it is the only way out if
     the caller's promise never settles. */
  it('leaves cancel enabled while busy', () => {
    render({ busy: true });

    const cancel = query<HTMLButtonElement>('.btn-ghost');

    expect(cancel.disabled).toBe(false);

    cancel.click();

    expect(cancelled).toBe(1);
  });

  it('names the dialog for a screen reader and marks it modal', () => {
    render();

    const card = query('.confirm-card');

    expect(card.getAttribute('role')).toBe('alertdialog');
    expect(card.getAttribute('aria-modal')).toBe('true');
    expect(card.getAttribute('aria-label')).toBe('Delete Version');
  });
});

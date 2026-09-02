import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { getDoc } from 'firebase/firestore';

import { workflowTemplateDoc } from '../../core/firestore-paths';
import {
  WorkflowStep,
  WorkflowTemplate,
  WorkflowTemplateDraft
} from '../../models/teaching.model';
import {
  WorkflowTemplateService,
  normaliseWorkflowTemplate
} from '../../services/workflow-template.service';
import { ConfigurationService } from '../../services/configuration.service';
import { WorkflowTemplateForm } from './workflow-template-form';

/**
 * The routed shell around the workflow-template form.
 *
 * WHY A WRAPPER RATHER THAN MAKING THE FORM ROUTED. The form is presentational —
 * it takes a template and emits a draft, reads nothing and writes nothing — and
 * that is what its 31 tests exercise. Putting the router and the service inside it
 * would mean every one of those tests needed a router harness to assert something
 * about a dropdown.
 *
 * OUTSIDE THE SHELL, deliberately: this route is a sibling of the shell's
 * children rather than one of them, so the page fills the viewport with no sidebar
 * and no topbar — which is what production's create view does.
 *
 * WHICH IS WHY IT LOADS THE CONFIGURATION ITSELF. `ConfigurationService.load()` is
 * called from the shell, and this page has no shell — so a cold arrival here (a
 * refresh mid-build, a pasted link, a bookmark) left every Configuration-driven
 * list on this page silently showing its shipped fallback instead of the document.
 * That is the failure mode the whole fallback design makes invisible: the
 * dropdowns are populated and correct-looking, so nothing appears wrong until the
 * document says something the constant does not. Two lists on this form read
 * Configuration today — Workflow Type and, in default mode, Subject.
 *
 * NAVIGATING FROM THE LIST HID IT, because the list IS inside the shell, so the
 * load had already happened. Only a direct arrival was affected.
 *
 * ONE DIFFERENCE FROM PRODUCTION, and it is an improvement rather than an
 * oversight: production swaps the view without changing the URL, so a refresh
 * mid-build lands back on the list and the browser's Back button leaves the app.
 * This is a real route, so both work.
 */
@Component({
  selector: 'app-workflow-template-page',
  imports: [WorkflowTemplateForm],
  template: `
    @if (loading()) {
      <p class="wt-page-state">Loading…</p>
    } @else if (loadError()) {
      <p class="wt-page-state is-error" role="alert">{{ loadError() }}</p>
    } @else {
      <app-workflow-template-form
        [template]="template()"
        [saving]="saving()"
        [error]="saveError()"
        (submitted)="save($event)"
        (closed)="back()"
      />
    }
  `,
  styles: `
    .wt-page-state {
      margin: 0;
      padding: 64px 28px;
      font-size: 14px;
      color: var(--ink-500);
    }

    .wt-page-state.is-error {
      color: var(--danger);
    }
  `
})
export class WorkflowTemplatePage implements OnInit {

  private service = inject(WorkflowTemplateService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private configuration = inject(ConfigurationService);

  /**
   * The document id, from the route. Absent means create.
   *
   * READ FROM THE SNAPSHOT rather than bound as a route input: this app does not
   * enable `withComponentInputBinding`, and switching it on globally would start
   * binding every route parameter to any component input that happens to share
   * its name. A local read costs one line and changes nothing else.
   *
   * The snapshot is enough because the two routes load this component fresh —
   * there is no navigation between /new and /:docId/edit that would reuse it.
   */
  readonly docId = signal<string | undefined>(
    this.route.snapshot.paramMap.get('docId') ?? undefined
  );

  readonly template = signal<WorkflowTemplate | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal('');
  readonly saving = signal(false);
  readonly saveError = signal('');

  /**
   * Loads the template being edited, or nothing at all for a create.
   *
   * READ BY ID rather than filtered out of a list: arriving here by URL is the
   * whole point of a route, and the list may not have been loaded at all.
   */
  async ngOnInit(): Promise<void> {
    /*
     * BEFORE THE EARLY RETURN, so a CREATE gets it too — and not awaited, because
     * the form renders from its seeded fallbacks and swaps to the document's values
     * when the read lands. `load()` is idempotent, so arriving here from the shell
     * costs nothing.
     */
    void this.configuration.load();

    const id = this.docId();

    if (!id) {
      return;
    }

    this.loading.set(true);

    try {
      const snapshot = await getDoc(workflowTemplateDoc(id));

      if (!snapshot.exists()) {
        this.loadError.set('That workflow template no longer exists.');
        return;
      }

      this.template.set(normaliseWorkflowTemplate(snapshot.id, snapshot.data()));
      this.loadError.set('');
    } catch (error) {
      this.loadError.set(
        this.service.describeError(error, 'Could not load that workflow template.')
      );
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Creates or updates, then returns to the list.
   *
   * The list re-reads on its own ngOnInit, so navigating back is enough to show
   * the change — no need to pass anything between the two.
   */
  async save(draft: WorkflowTemplateDraft): Promise<void> {
    if (this.saving()) {
      return;
    }

    this.saving.set(true);
    this.saveError.set('');

    try {
      const existing = this.template();

      if (existing) {
        /*
         * WHAT THIS SAVE DISCARDS IS ARCHIVED FIRST.
         *
         * A step removed in the rail is not deleted, it is written out of the
         * `workflowSteps` array — so nothing was deleted, no trash held it, and
         * the rail has no undo. Before the update, so the copy exists whether or
         * not the write lands; after it, a failed write would leave a trash entry
         * for a step that is still live.
         */
        await this.trashRemovedSteps(existing, draft.workflowSteps);

        await this.service.update(existing.docId, draft);
      } else {
        await this.service.create(draft);
      }

      await this.back();
    } catch (error) {
      this.saveError.set(
        this.service.describeError(error, 'Could not save the workflow template.')
      );
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Archives the stored steps this save no longer holds.
   *
   * MATCHED BY NAME, trimmed and case-folded, because a step has no id —
   * `workflowStepId` appears in 0 of production's 2593 real steps. A RENAMED step
   * therefore reads as one removed and one added, and gets archived. That is the
   * error worth making: a spare copy of a step that still exists costs a document,
   * where a missed copy of one that does not is what this is here to prevent.
   */
  private async trashRemovedSteps(
    existing: WorkflowTemplate,
    saved: readonly WorkflowStep[]
  ): Promise<void> {
    try {
      /*
       * `?? []` AND INSIDE THE TRY, both deliberate. A stored document is
       * whatever Firestore holds, and one written before this app modelled steps
       * carries no array at all — reading `.filter` off it threw, and the throw
       * escaped past the save's own catch and took the SAVE down with it. An
       * archive that can stop a save is worse than no archive.
       */
      const kept = new Set(
        saved.map(step => (step.workflowStepName ?? '').trim().toLowerCase())
      );
      const removed = (existing.workflowSteps ?? []).filter(
        step => !kept.has((step.workflowStepName ?? '').trim().toLowerCase())
      );

      if (removed.length === 0) {
        return;
      }

      await this.service.trashSteps(removed, {
        templateId: existing.docId,
        templateName: existing.templateName
      });
    } catch {
      /* SWALLOWED. The save is what the reader asked for; the archive is this app
         being careful on their behalf and must not be able to block it. */
    }
  }

  back(): Promise<boolean> {
    return this.router.navigate(['/workflow-templates']);
  }
}

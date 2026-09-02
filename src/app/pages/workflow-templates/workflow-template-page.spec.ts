import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';

import { WorkflowTemplateDraft } from '../../models/teaching.model';
import { ConfigurationService } from '../../services/configuration.service';
import { WorkflowTemplateService } from '../../services/workflow-template.service';
import { WorkflowTemplateForm } from './workflow-template-form';
import { WorkflowTemplatePage } from './workflow-template-page';

/**
 * The routed wrapper around the workflow-template form.
 *
 * THE POINT OF THIS SUITE is the Configuration load, and it exists because the
 * absence of it was a bug that hid itself.
 *
 * This route is a SIBLING of the shell's children, not one of them, so the page
 * fills the viewport with no sidebar. `ConfigurationService.load()` is called from
 * the shell — which this page does not have. A cold arrival here therefore left
 * every Configuration-driven list on the form showing its shipped fallback rather
 * than the document, and the fallback design is precisely what made that
 * invisible: the dropdowns were populated and looked right, so nothing seemed
 * wrong until the document said something the constant did not.
 *
 * NAVIGATING FROM THE LIST HID IT FURTHER, because the list IS inside the shell,
 * so the load had already happened. Only a refresh, a pasted link or a bookmark
 * was affected — the three ways a developer is least likely to open a page they
 * are working on.
 *
 * The save and load paths are covered here too, but they fail loudly when broken.
 * This one does not, which is why it is the reason the file exists.
 */

class StubConfigurationService {
  loadCalls = 0;

  async load(): Promise<void> {
    this.loadCalls += 1;
  }
}

class StubWorkflowTemplateService {
  created: WorkflowTemplateDraft[] = [];
  updated: { docId: string; draft: WorkflowTemplateDraft }[] = [];

  async create(draft: WorkflowTemplateDraft): Promise<void> {
    this.created.push(draft);
  }

  async update(docId: string, draft: WorkflowTemplateDraft): Promise<void> {
    this.updated.push({ docId, draft });
  }

  describeError(_error: unknown, fallback: string): string {
    return fallback;
  }
}

/**
 * Mounts the page for a route with or without a `docId`.
 *
 * THE FORM IS NOT RENDERED. It is removed from `imports` and its tag allowed
 * through CUSTOM_ELEMENTS_SCHEMA, for one reason: the real form injects
 * ConfigurationService and AssignmentService and reads a dozen signals, none of
 * which this suite is about — and its own 40-odd tests already cover it. What is
 * asserted here is what the WRAPPER does.
 *
 * The schema is required rather than optional: removing a component from `imports`
 * turns its tag into an unknown element, which Angular raises as an error and not
 * a warning, so every test in the file would fail on the markup.
 */
async function mount(docId?: string): Promise<{
  fixture: ComponentFixture<WorkflowTemplatePage>;
  component: WorkflowTemplatePage;
  configuration: StubConfigurationService;
  service: StubWorkflowTemplateService;
}> {
  const configuration = new StubConfigurationService();
  const service = new StubWorkflowTemplateService();

  TestBed.configureTestingModule({
    imports: [WorkflowTemplatePage],
    providers: [
      provideRouter([]),
      { provide: ConfigurationService, useValue: configuration },
      { provide: WorkflowTemplateService, useValue: service },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: { get: () => docId ?? null } } }
      }
    ]
  });

  TestBed.overrideComponent(WorkflowTemplatePage, {
    remove: { imports: [WorkflowTemplateForm] },
    add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] }
  });

  const fixture = TestBed.createComponent(WorkflowTemplatePage);

  fixture.detectChanges();
  await fixture.whenStable();

  return { fixture, component: fixture.componentInstance, configuration, service };
}

describe('WorkflowTemplatePage', () => {

  describe('the Configuration load', () => {

    /**
     * A CREATE MUST LOAD IT TOO, which is the case the original bug missed: the
     * call has to sit BEFORE the early return that skips fetching a template,
     * because /new has no docId and would otherwise leave immediately.
     */
    it('loads the configuration when creating', async () => {
      const { configuration } = await mount();

      expect(configuration.loadCalls).toBe(1);
    });

    it('loads the configuration when editing', async () => {
      const { configuration } = await mount('wt-1');

      expect(configuration.loadCalls).toBe(1);
    });
  });

  describe('the route parameter', () => {

    it('reads no docId for a create', async () => {
      const { component } = await mount();

      expect(component.docId()).toBeUndefined();
      expect(component.template()).toBeNull();
    });

    it('reads the docId for an edit', async () => {
      const { component } = await mount('wt-1');

      expect(component.docId()).toBe('wt-1');
    });
  });

  describe('saving', () => {

    const draft: WorkflowTemplateDraft = {
      templateName: 'DGA STEM Club',
      templateType: 'custom',
      learningUnitType: '',
      maturity: '',
      subject: '',
      type: 'CLASSROOM',
      status: 'LIVE',
      workflowSteps: []
    };

    it('creates when there is no template loaded', async () => {
      const { component, service } = await mount();

      await component.save(draft);

      expect(service.created).toEqual([draft]);
      expect(service.updated).toEqual([]);
    });

    /** THE ID COMES FROM THE LOADED TEMPLATE, not from the route. */
    it('updates when one is loaded', async () => {
      const { component, service } = await mount('wt-1');

      component.template.set({ docId: 'wt-1' } as never);

      await component.save(draft);

      expect(service.updated).toEqual([{ docId: 'wt-1', draft }]);
      expect(service.created).toEqual([]);
    });

    /** A double-click must not write twice. */
    it('ignores a second save while one is in flight', async () => {
      const { component, service } = await mount();

      component.saving.set(true);
      await component.save(draft);

      expect(service.created).toEqual([]);
    });

    it('returns to the list after saving', async () => {
      const { component } = await mount();
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      await component.save(draft);

      expect(navigate).toHaveBeenCalledWith(['/workflow-templates']);
    });
  });
});

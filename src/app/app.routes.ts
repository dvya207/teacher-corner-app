import { Routes } from '@angular/router';

import { authGuard } from './guards/auth-guard';
import {
  approvalPendingGuard,
  registrationCompleteGuard,
  registrationGuard
} from './guards/registration-guard';

/**
 * Two top-level areas: the bare login page, and everything behind the shell.
 *
 * The guard sits on the parent Shell route, not on each child. One check covers
 * every page inside it, and a page added later is protected by default rather
 * than by remembering to attach it.
 *
 * `data.title` is what the topbar breadcrumb renders, `crumbRoot` overrides the
 * breadcrumb's first segment, and `search` sets the topbar placeholder — so
 * each page's chrome is declared here rather than reached for from inside the
 * component.
 *
 * EVERY PAGE IS LAZY. loadComponent rather than a top-level import: with eager
 * imports one bundle carried every page's template and stylesheet, so the login
 * screen paid for the institutions table it may never open. Each route now
 * fetches its own chunk on first navigation. The guard stays eager, because it
 * is what decides where to go at all.
 */
export const routes: Routes = [
  // '' EXACTLY: the welcome splash. It must be declared before the Shell route
  // below, which also matches '' but as a prefix — first match wins, and
  // pathMatch:'full' keeps this one from swallowing /dashboard and the rest.
  //
  // Outside the guard on purpose: this page is what covers the window before
  // there is a session to guard on, and it performs the same redirect the guard
  // would once Firebase has answered.
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./pages/welcome/welcome').then(m => m.Welcome)
  },

  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then(m => m.Login)
  },

  /*
   * Admin impersonation — signing in AS a teacher, for support.
   *
   * OUTSIDE THE SHELL, like /login: it is a sign-in form and shows no sidebar,
   * and production's /impersonation is the same full-page split layout.
   *
   * NO GUARDS AT ALL, so typing the URL always lands on this page.
   *
   * It HAD authGuard, on the reasoning that the callable needs a signed-in
   * administrator so an unguarded page could only show a refusal. That was wrong
   * about what a guard costs: a redirect to /login is indistinguishable from the
   * URL being broken, and it fires on every cold load — Firebase rehydrates the
   * session asynchronously, so even a signed-in administrator opening this link
   * in a fresh tab could be bounced. Production's page has no guard either.
   *
   * The page now resolves the session itself and says what is missing, in place,
   * rather than sending anyone elsewhere to find out. The server is still the
   * only thing deciding whether the impersonation is allowed, which is where that
   * decision belonged all along — a guard here was never the security boundary.
   *
   * NO registrationGuard either: that one sends anyone without a users/{uid}
   * profile to Create Account, and an administrator arriving here has no business
   * being routed through a teacher's registration form.
   */
  {
    path: 'impersonation',
    loadComponent: () =>
      import('./pages/impersonation/impersonation').then(m => m.Impersonation)
  },

  // Create Account, reached after sign-in by a teacher who has no profile yet.
  //
  // OUTSIDE THE SHELL: production shows no sidebar here, and there is nothing to
  // navigate to before a profile exists. Offering Institutions and Classrooms
  // first invites a half-registered account with rows already attached to it.
  //
  // TWO GUARDS. authGuard because the form reads the verified phone number off the
  // session and writes to users/{uid}. registrationCompleteGuard because a teacher
  // who has already registered would otherwise be able to come back and overwrite
  // a finished profile with a blank one; editing later is what /profile is for.
  {
    path: 'register',
    loadComponent: () => import('./pages/register/register').then(m => m.Register),
    canActivate: [authGuard, registrationCompleteGuard]
  },

  // Approval pending. Registered, signed in, and waiting for an administrator to
  // set `ApprovedStatus: true` on users/{uid}.
  //
  // Outside the shell for the same reason /register is: the app is not open yet, and
  // a sidebar offering Institutions would contradict the message. approvalPendingGuard
  // keeps out anyone not actually waiting — an approved teacher would otherwise read
  // about a request that has already been granted.
  {
    path: 'approval-page',
    loadComponent: () => import('./pages/approval/approval').then(m => m.Approval),
    canActivate: [authGuard, approvalPendingGuard]
  },

  // Outside the shell and outside the guard: by the time this renders there is
  // no session left to check, and guarding it would bounce the user to /login
  // before they ever saw the confirmation.
  {
    path: 'sign-out',
    loadComponent: () => import('./pages/sign-out/sign-out').then(m => m.SignOut)
  },

  /*
   * WORKFLOW TEMPLATE BUILDER — outside the shell, on purpose.
   *
   * A sibling of the shell branch rather than one of its children, so the page
   * fills the viewport with no sidebar and no topbar. That is what production's
   * create view does, and it is right for this one: the rail and the step editor
   * sit side by side and a template is built over several minutes.
   *
   * THE SAME GUARDS as the shell branch, because leaving them off would make this
   * the one authenticated page anybody could open.
   */
  {
    path: 'workflow-templates/new',
    loadComponent: () =>
      import('./pages/workflow-templates/workflow-template-page').then(
        m => m.WorkflowTemplatePage
      ),
    canActivate: [authGuard, registrationGuard],
    data: { title: 'Create Workflow Template' }
  },
  {
    path: 'workflow-templates/:docId/edit',
    loadComponent: () =>
      import('./pages/workflow-templates/workflow-template-page').then(
        m => m.WorkflowTemplatePage
      ),
    canActivate: [authGuard, registrationGuard],
    data: { title: 'Edit Workflow Template' }
  },

  {
    path: '',
    loadComponent: () => import('./layout/shell/shell').then(m => m.Shell),
    // authGuard decides whether there is a session; registrationGuard decides
    // whether that session has finished Create Account. Order matters: the second
    // reads the profile and needs the first to have resolved a uid.
    canActivate: [authGuard, registrationGuard],
    children: [
      {
        path: 'dashboard',
        loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.Dashboard),
        data: { title: 'Dashboard' }
      },
      {
        path: 'setup-wizard',
        loadComponent: () =>
          import('./pages/setup-wizard/setup-wizard').then(m => m.SetupWizard),
        data: { title: 'Set Up Wizard' }
      },
      {
        path: 'institutions',
        loadComponent: () =>
          import('./pages/institutions/institutions').then(m => m.Institutions),
        data: { title: 'Institutions', crumbRoot: 'Admin', search: 'Search institutions...' }
      },
      {
        path: 'classrooms',
        loadComponent: () => import('./pages/classrooms/classrooms').then(m => m.Classrooms),
        data: { title: 'Classrooms', crumbRoot: 'Admin', search: 'Search classrooms...' }
      },
      /*
       * ONE CLASSROOM'S LEARNING UNITS.
       *
       * UNDER 'institutions', NOT under 'classrooms'. It was
       * `classrooms/:classroomId`, and the consequence was in the sidebar: the
       * Admin group's Classrooms entry matches by PREFIX, so viewing one class
       * lit up the Classrooms table instead of that class's own row in the
       * Institutions tree. A class is reached THROUGH its school, and the URL now
       * says so.
       *
       * The classroom is a PATH segment and the programme a QUERY parameter,
       * following production's own URL: a classroom has one page, and which of
       * its programmes is being looked at is a view of that page rather than a
       * different one. It also means a link that loses its query string still
       * resolves — the page falls back to the first programme attached.
       */
      {
        path: 'institutions/classroom/:classroomId',
        loadComponent: () =>
          import('./pages/classroom-units/classroom-units').then(m => m.ClassroomUnits),
        // FALLBACK ONLY. The page names itself through PageContextService —
        // institution › class › programme — because none of the three is known
        // until the classroom is read. 'Institutions' rather than 'Admin',
        // because that is the section this route now lives under.
        data: {
          title: 'Classroom',
          crumbRoot: 'Institutions',
          search: 'Search learning units...'
        }
      },
      /*
       * THE WORKFLOW STEPPER — one learning unit's steps inside one classroom.
       *
       * A CHILD OF THE CLASSROOM PATH, not a sibling, because that is what it is:
       * the unit only means anything in the context of the class working through
       * it, and the URL should survive being pasted. `programmeId` rides in the
       * query string exactly as the unit list's does — a classroom can have
       * several programmes and the same unit can appear under more than one.
       *
       * INSIDE THE SHELL, unlike the workflow-template form. Production keeps its
       * sidebar here too, and the reason is the difference in task: building a
       * blueprint is a job you sit down to, while stepping through a unit is done
       * mid-lesson with the class list a click away.
       */
      {
        path: 'institutions/classroom/:classroomId/unit/:unitId',
        loadComponent: () =>
          import('./pages/classroom-workflow/classroom-workflow').then(
            m => m.ClassroomWorkflow
          ),
        data: {
          title: 'Workflow',
          crumbRoot: 'Institutions'
        }
      },
      // ProgrammePage, not Programme: the component sits alongside a Programme
      // MODEL interface of the same name, and importing both into one file is
      // the kind of collision that gets resolved with an alias nobody expects.
      {
        path: 'programme',
        loadComponent: () => import('./pages/programme/programme').then(m => m.ProgrammePage),
        data: { title: 'Programme', crumbRoot: 'Admin', search: 'Search programmes...' }

      },
      // Learning Units — the activity catalogue. RESTORED, on instruction.
      //
      // This route and its nav entry were withheld earlier, separately. The page,
      // its add/edit form, LearningUnitService, learning-unit-taxonomy.ts and the
      // learningUnits rules all stayed in the repo throughout, because the feature
      // is not self-contained — Classrooms reaches into it through
      // classroom.service.ts, classrooms.ts and edit-classroom.ts, and
      // bulk-upload-options.ts derives BULK_SUBJECTS from LEARNING_UNIT_TAXONOMY.
      // So restoring the page was this block plus one entry in shell.ts, and no
      // change at all to the page itself.
      //
      // `crumbRoot: 'Admin'` and the search placeholder match the other three admin
      // tables, which is what renders the topbar as "Admin › Learning Units".
      {
        path: 'learning-units',
        loadComponent: () =>
          import('./pages/learning-units/learning-units').then(m => m.LearningUnits),
        data: {
          title: 'Learning Units',
          crumbRoot: 'Admin',
          search: 'Search learning units...'
        }
      },
      {
        path: 'assignments',
        loadComponent: () =>
          import('./pages/assignments/assignments').then(m => m.Assignments),
        data: {
          title: 'Assignments',
          crumbRoot: 'Admin',
          search: 'Search assignments...'
        }
      },
      {
        path: 'workflow-templates',
        loadComponent: () =>
          import('./pages/workflow-templates/workflow-templates').then(
            m => m.WorkflowTemplates
          ),
        data: {
          title: 'Workflow Templates',
          crumbRoot: 'Admin',
          search: 'Search workflow templates...'
        }
      },
      // Reached from the topbar user menu, so it has no sidebar entry.
      {
        path: 'profile',
        loadComponent: () => import('./pages/profile/profile').then(m => m.Profile),
        data: { title: 'Edit Profile' }
      },
      // No '' child here any more: the top-level '' route above claims the bare
      // URL, so a redirect here would be unreachable.
    ]
  },

  // Unknown URLs go to the splash, which then routes by session state — so a
  // stale bookmark lands a signed-out visitor on /login and a signed-in one on
  // their dashboard, rather than always on one of the two.
  { path: '**', redirectTo: '' }
];

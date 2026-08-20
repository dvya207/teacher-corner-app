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
      // ProgrammePage, not Programme: the component sits alongside a Programme
      // MODEL interface of the same name, and importing both into one file is
      // the kind of collision that gets resolved with an alias nobody expects.
      {
        path: 'programme',
        loadComponent: () => import('./pages/programme/programme').then(m => m.ProgrammePage),
        data: { title: 'Programme', crumbRoot: 'Admin', search: 'Search programmes...' }

      },
      // Learning Units has NO ROUTE, on instruction.
      //
      // The code is deliberately still here: pages/learning-units/, its add/edit form,
      // LearningUnitService, learning-unit-taxonomy.ts and the learningUnits rules all
      // remain. Only the way in is gone, so /learning-units now falls through to the
      // '**' route at the bottom of this file and lands on the splash.
      //
      // KEPT RATHER THAN DELETED because the feature is not self-contained: Classrooms
      // reaches into it through classroom.service.ts, classrooms.ts and
      // edit-classroom.ts, and bulk-upload-options.ts derives BULK_SUBJECTS from
      // LEARNING_UNIT_TAXONOMY. Removing the code means untangling those first, which
      // is a refactor rather than a deletion. Restoring the page is re-adding this
      // block and one nav entry in shell.ts.
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

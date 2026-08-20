# Teacher Corner

![Angular](https://img.shields.io/badge/Angular-21-DD0031?style=flat-square&logo=angular&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)
![RxJS](https://img.shields.io/badge/RxJS-7.8-B7178C?style=flat-square&logo=reactivex&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-12-FFCA28?style=flat-square&logo=firebase&logoColor=black)
![Cloud Firestore](https://img.shields.io/badge/Cloud%20Firestore-rules%20%2B%20tests-FFA000?style=flat-square&logo=firebase&logoColor=black)
![Cloud Functions](https://img.shields.io/badge/Cloud%20Functions-gen2-4285F4?style=flat-square&logo=googlecloud&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white)

Angular 21 + Firebase teacher console. First pass: a sign-in page and a
navigable app shell.

> **Working name.** The project is called `teacher-corner` so it had somewhere
> to live. Renaming is two edits — `name` in `package.json` and the project key
> in `angular.json` — plus renaming the directory.

---

## What exists today

| Area | State |
| :-- | :-- |
| **Sign-in page** | Built. Email/password + Google, split layout with the marketing hero. |
| **App shell** | Built. Sidebar, topbar, breadcrumb, search field, user menu, collapse and mobile drawer. |
| **Sign-out page** | Built. Centred card on the brand purple, 5-second countdown, auto-redirect to `/login`. Both logout entry points route here. |
| **Dashboard** | Welcome banner and the Institutions/Classrooms counts. Nothing else yet. |
| **Classrooms** | Built. Table of classrooms and STEM clubs, stat cards, type filters, Add Classroom, Manage Programmes, and a Trash with restore. See **Classrooms** below. |
| **Programme** | Built. The programme catalogue: table, stat cards, Active/Draft filters, a Create Programme wizard, an edit modal, and a Trash with restore. See **Programmes** below. |
| **Set Up Wizard** | Routed placeholder. It navigates and highlights correctly; the page is empty. |
| **Data** | Real Firestore reads. Blocked until rules are deployed — see **Data isolation** below. |
| **Firebase config** | Live. Project `helix-staging-india`, app `Teacher Corner Dev`. |

Deliberately **not** built in this pass: the institution card grid, the
expand-to-classrooms panel, "What's new", and the pages that come before
sign-in.

---

## Data isolation

Teacher Corner uses its own dedicated Firestore database with its own rules
file. All application data lives under a single per-user root, and every
Firestore path in the app is built in one place.

| Guard | What it does |
| :-- | :-- |
| `core/firestore-paths.ts` | The **only** place a Firestore path is built. Roots every reference at the app's own tree, which callers cannot override. Rejects path separators and foreign collection names at runtime. |
| `tests/isolation.test.mjs` | Fails if any file under `src/` builds a Firestore path outside the sanctioned helpers, or calls `collection(db, …)` / `doc(db, …)` directly. |
| `firestore.rules` | This app's rules only. Deploys from here target this app's database and no other. |

```bash
npm run test:isolation
```

If it fails, **do not add an exception** — route the call through
`userCollection()` / `userDoc()` instead.

## Before sign-in will work

`src/environments/environment.ts` ships with `PENDING_FIREBASE_CLI_LOGIN`
placeholders. Until they are replaced, the login page shows an inline amber
notice and any sign-in attempt fails with `auth/invalid-api-key`.

```bash
firebase apps:sdkconfig WEB --project <your-project-id>
```

Paste the result over the `firebase` object in that file.

These values are **not secrets** — the Firebase web config is compiled into the
client bundle by design. Access control comes from Firebase Auth and the
security rules.

You will also need, in the Firebase console:

- **Email/Password** enabled under Authentication → Sign-in method
- **Google** enabled under the same, with `localhost` in Authorized domains

---

## Run it

```bash
npm install
npm start          # http://localhost:4200
npm run build      # dist/teacher-corner
npm test           # Vitest
```

---

## Structure

```
src/
├── app/
│   ├── components/
│   │   ├── icon/            every SVG icon, one component, one stroke scale
│   │   └── logo/            official ThinkTac artwork; colour/white, full/mark
│   ├── core/
│   │   └── firebase.ts      Firebase app + Auth singletons, config guard
│   ├── data/
│   │   └── mock-dashboard.ts  ALL mock data — the one file to delete later
│   ├── guards/
│   │   └── auth-guard.ts    session-aware guard on the shell route
│   ├── layout/
│   │   └── shell/           sidebar + topbar + <router-outlet>
│   ├── pages/
│   │   ├── login/           sign-in (outside the shell)
│   │   ├── sign-out/        post-logout confirmation + countdown (outside the shell)
│   │   ├── dashboard/       welcome banner + counts
│   │   ├── setup-wizard/    placeholder
│   │   ├── classrooms/      table + Add Classroom + Manage Programmes + Trash
│   │   ├── programme/       catalogue + Create wizard + edit + Trash
│   │   └── learning-units/  activity catalogue + add/edit modal + Trash
│   ├── services/
│   │   └── auth.service.ts  sign-in, sign-out, role, error messages
│   ├── app.routes.ts        route table
│   └── app.config.ts        providers
├── environments/
│   └── environment.ts       Firebase web config
└── styles.css               design tokens, reset, shared primitives
```

### Routes

| Path | Component | Guarded |
| :-- | :-- | :-- |
| `/login` | Login | — |
| `/sign-out` | SignOut | — |
| `/dashboard` | Dashboard | `authGuard` |
| `/setup-wizard` | SetupWizard | `authGuard` |
| `/classrooms` | Classrooms | `authGuard` |
| `/programme` | Programme | `authGuard` |
| `/learning-units` | LearningUnits | `authGuard` |

The guard sits on the parent `Shell` route, not on each child, so a page added
later is protected by default rather than by remembering to attach it.

---

## Classrooms

Rebuilds the `manage-classrooms` screen from ThinkTac production
(`thinktac-india-production/apps/teacher-corner2-0`), using its field names
verbatim so a row created here and one created there line up field for field.

### Firestore

```
classrooms/{docId}                            ACTIVE
classrooms/trash/DeletedClassrooms/{docId}    DELETED
programmes/{docId}                            the catalogue
```

Deletion is a **move**, exactly as it is for institutions: a deleted classroom
is not in `classrooms` with a flag set, it is not in `classrooms` at all. The
document id survives the move, so delete and restore are exact inverses, and
both halves run in one transaction so a dropped connection cannot leave the same
classroom in both places.

### What a classroom is

`type` is `'CLASSROOM'` or `'STEM-CLUB'` and decides which fields matter — a
classroom has `grade`, `section` and a composed `classroomName` ("8 B"); a club
has `stemClubName`. **One deliberate deviation from production:** production
*deletes* the fields that do not apply, this app stores them empty. Absent keys
read back as `undefined`, which the type system cannot see and which Firestore
rejects outright on the next write — a bug this codebase already paid for once
in `normaliseInstitution`.

`classroomCode` is a per-school sequence (`001`, `002`) computed from the
classrooms in hand rather than from the institution's `classroomCounter`, which
drifts whenever a classroom is deleted. It is a human-facing label, not a key,
so a rare duplicate from two tabs racing is cosmetic.

### Add Classroom unlocks in sequence

Type → Country → Pincode → Board → Search → School → Grade → Section (or STEM
Club name) → Programme. Each control stays disabled until the answer above it
exists, matching production's `unlockFormSequentially`: the school list cannot
be filtered before a board and pincode exist, and the programme list cannot be
narrowed before a school and grade are known.

Two lists are narrowed as you go — grade/section pairs already used at that
school are removed, so the form cannot offer a duplicate "8 B"; and the
programme picker shows only LIVE programmes for that school, type and grade.
That is a UI guard only. Nothing in the rules enforces uniqueness.

### Known gaps

- **Credentials** always renders `—`. `studentCredentialStoragePath` is stored
  (empty) so the schema matches production and the column starts working the
  moment an enrolment flow fills it, but no such flow exists in this app.
- **Students** always renders `0` for the same reason.
- **Search** is a page-local signal, not wired to the topbar field — the
  Institutions page has the same unconnected signal. Connecting them is a shell
  change affecting both pages.
- Manage Programmes moves rows on **click**, not drag. Production uses the CDK;
  a click needs no extra dependency and works from the keyboard.

---

## Programmes

The catalogue the classroom pickers choose from, rebuilt from production's
`programme-list` and its Create Programme wizard.

### Firestore

```
programmes/{docId}                            ACTIVE
programmes/trash/DeletedProgrammes/{docId}    DELETED
users/{uid}/counters/programmes               the code sequence
```

Flat rather than nested under its institution, because Manage Programmes offers
a "show all programmes" mode that searches across schools — a collection-group
query would be the only way to serve that from a nested shape, and it would need
its own index and rule block. Programmes are filtered **in memory** from one
owner-scoped query: Firestore requires the `ownerId` equality on every list, and
each additional `where()` on top needs a composite index.

### The code sequence

`programmeCode` is **allocated, not typed** — `P11697`, `P11698` — matching
production, which reads a counter and increments it. Allocation runs in a
transaction, because two tabs creating a programme at once would otherwise both
read the same number and the code is the one field whose purpose is being
distinct.

**The counter is per-teacher here; production's is global.** Copying production
meant a shared `Configuration/Counters` document writable by every signed-in
teacher, and Firestore rules cannot express "you may only increment this by
one" — so the tightest possible rule still lets any authenticated user put any
value in it. Under `users/{uid}/` it is owner-scoped by path, needs no new rule
block, and no other teacher can touch it. The trade is that codes are unique
within one teacher's catalogue rather than across all of them, which is
sufficient because a teacher only ever sees their own.

First use seeds the counter from the highest code already in the catalogue, so
a teacher whose programmes were imported does not start re-issuing codes that
already exist.

### Grades, ages, and ranges

A programme is scoped **by grade or by age, never both** — production's toggle,
which clears the other side when it flips. A range is **stored expanded**:
grades 4–6 is `['4','5','6']`, not its endpoints. That is production's
`getAllclsInArray`, and it is what lets the classroom picker ask a flat
`grades.includes(grade)` question instead of parsing a range at every call site.
The table re-derives `4 - 6` for display.

`programmeStatus` is `'LIVE'` or `'DEVELOPEMENT'` — **production's misspelling,
kept deliberately**, because correcting it would mean writing a status
production does not recognise. Only the label is spelled correctly. The
Active/Draft filter treats anything that is not live or active as a draft, so an
unrecognised status still lands somewhere rather than vanishing from both.

### Deleting cascades

A classroom stores a denormalised **copy** of each programme, so deleting the
catalogue entry does not remove it from the classrooms using it. Delete
therefore detaches the programme from every classroom first (`deleteField()` on
the one map key, not a rewrite of the whole map), then moves it to the trash.

That order matters: the detach is a non-atomic sweep and the trash move is one
transaction, so a failure leaves the programme live with some classrooms already
detached — which retrying fixes. The reverse order would leave classrooms
pointing at a programme that no longer exists.

**A restore does not undo the detach.** Nothing records which classrooms carried
it. The delete confirmation says so before the fact, which is what production's
does too.

### Known gaps

- **The wizard has three steps, production has five.** Steps 3 and 4 select
  Learning Units and Assignments; neither collection exists in this app.
  `learningUnitsIds` and `assignmentIds` are written empty so both steps can be
  inserted later without a migration.
- **Image** always renders `N/A`. Firebase Storage is not initialised here, so
  nothing can upload a thumbnail. `programmeImagePath` is stored regardless.
- **Renaming does not propagate.** Classrooms hold a copy of the programme name
  taken when it was attached. Production cascades a rename across classrooms,
  teachers and students; this app has no teachers or students collections, and
  the classroom half of that cascade is genuinely missing — the edit modal's
  success notice says how many classrooms still show the old name.
- The edit modal is production's **Basic Info tab only**. Its other three manage
  Learning Units, manage Assignments, and assign an institution to a programme
  that has none — which this app cannot create, since the wizard requires a
  school.
- The **school cannot be changed** on an existing programme. Moving one between
  schools would orphan it from the classrooms already carrying it.

---

## Things worth knowing before you edit

**The app is zoneless.** `zone.js` is not installed and Angular 21 defaults
`ZONELESS_ENABLED` to true, so change detection only runs when something
notifies the scheduler — a template event listener, a signal write, or an
explicit `markForCheck`. A plain field assigned inside a promise continuation
notifies nothing, so the write lands in the component and never reaches the
DOM.

The rule: **anything the template reads AND anything mutated after an `await`
must be a signal.** `Dashboard` currently uses plain fields because nothing on
it is async; the moment a real Firestore read replaces the mock counts, they
have to become signals.

**Parent routes cannot read a child's snapshot during construction.** `Shell`
derives its breadcrumb from `router.routerState.snapshot`, not from its own
injected `ActivatedRoute`. The shell is instantiated while its child route is
still activating, so `activatedRoute.firstChild.snapshot` is `undefined` at
that point and throws.

**View encapsulation is real.** A parent's stylesheet cannot style elements
inside a child component's template. The collapsed sidebar hides the wordmark
through a `[compact]` input on `Logo`, not through a CSS rule in `shell.css` —
the CSS approach silently does nothing.

**Design tokens live in `src/styles.css`.** Component stylesheets read the
variables and never restate a colour, so the palette changes in one place.

**The logo is real artwork, not a drawing.** `public/assets/logo/` holds the
vendor's own SVGs, re-cropped **via their `viewBox` only** — paths and fills
untouched, so they stay identical to what the live site serves.

| File | Use |
| :-- | :-- |
| `thinktac-logo-colour.svg` | full lockup, light backgrounds |
| `thinktac-logo-white.svg` | full lockup, the purple sidebar |
| `thinktac-mark-colour.svg` | square, mark only |
| `thinktac-mark-white.svg` | square, mark only, collapsed sidebar rail |

The mark is a spiral of navy and cyan dots around a cyan centre. Do not
redraw it — an earlier version of the `Logo` component approximated it as
concentric rings and was visibly wrong against the real thing. `size` on the
component is the **height**; width follows from the artwork.

To refresh the assets from source:

```bash
curl -O https://teachercorner.thinktac.com/assets/images/logo/thinktacLogo_noTagline_colour.svg
curl -O https://teachercorner.thinktac.com/assets/images/logo/thinktacLogo_noTagline_white.svg
# then re-crop: lockup viewBox "64.78 67.01 2269.42 527.15", mark "64.78 41.32 578.52 578.52"
```

---

## Not done yet

- The pages that come before sign-in
- Institution card grid, expand-to-classrooms, "What's new"
- Real Firestore reads behind `mock-dashboard.ts`
- A real role source — `AuthService.role()` returns a hardcoded `'Teacher'`;
  it should read a custom claim or a teachers document
- Registration and password reset
- Security rules, and any tests beyond the one smoke spec

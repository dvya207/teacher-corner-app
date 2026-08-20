# Teacher Corner

![Angular](https://img.shields.io/badge/Angular-21-DD0031?style=flat-square&logo=angular&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)
![RxJS](https://img.shields.io/badge/RxJS-7.8-B7178C?style=flat-square&logo=reactivex&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-12-FFCA28?style=flat-square&logo=firebase&logoColor=black)
![Cloud Firestore](https://img.shields.io/badge/Cloud%20Firestore-rules%20%2B%20tests-FFA000?style=flat-square&logo=firebase&logoColor=black)
![Cloud Functions](https://img.shields.io/badge/Cloud%20Functions-gen2-4285F4?style=flat-square&logo=googlecloud&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white)

Angular 21 + Firebase teacher console. Phone-OTP and Google sign-in, a
registration and approval flow, and institution, classroom, programme and
teacher management backed by Firestore.

> **Working name.** The project is called `teacher-corner` so it had somewhere
> to live. Renaming is two edits — `name` in `package.json` and the project key
> in `angular.json` — plus renaming the directory.

---

## What exists today

| Area | State |
| :-- | :-- |
| **Sign-in page** | Built. Mobile-number OTP as the primary route, Google under an "or", split layout with the marketing hero. See **Authentication** below. |
| **Pre-sign-in pages** | Built. A `/` splash, plus `/register` and `/approval-page` behind their own guards. |
| **App shell** | Built. Sidebar, topbar, breadcrumb, search field, user menu, collapse and mobile drawer. |
| **Sign-out page** | Built. Centred card on the brand purple, 5-second countdown, auto-redirect to `/login`. Both logout entry points route here. |
| **Dashboard** | Welcome banner, the Institutions/Classrooms counts, and the quick-action tiles. |
| **Institutions** | Built. Table, stat cards, Add Institution, an edit modal, and a Trash with restore. |
| **Classrooms** | Built. Table of classrooms and STEM clubs, stat cards, type filters, Add Classroom, Manage Programmes, and a Trash with restore. See **Classrooms** below. |
| **Programme** | Built. The programme catalogue: table, stat cards, Active/Draft filters, a Create Programme wizard, an edit modal, and a Trash with restore. See **Programmes** below. |
| **Set Up Wizard** | Built. The wizard itself plus Add Teachers and Bulk Upload Schools. |
| **Profile** | Built. Reachable at `/profile`; the update-profile component is shared with the shell's user menu. |
| **Data** | Real Firestore reads against the `teacher-corner-dev` database. Rules are deployed — see **Permissions** below. |
| **Firebase config** | Live. Project `helix-staging-india`, app `Teacher Corner Dev`. |

Deliberately **not** built: the institution card grid, the expand-to-classrooms
panel, and "What's new".

**Learning Units has no route.** The code is still here —
`pages/learning-units/`, `LearningUnitService`, `learning-unit-taxonomy.ts` and
the `learningUnits` rules all remain — but the way in was removed, so
`/learning-units` falls through to the `**` route. It is kept rather than
deleted because Classrooms and `bulk-upload-options.ts` reach into it, which
makes removal a refactor rather than a deletion.

---

## Data isolation

Teacher Corner owns the `teacher-corner-dev` database outright, with its own
rules file. Firestore rules are per-database and a deploy replaces the whole
ruleset, so a dedicated database is what makes the boundary structural rather
than a matter of discipline.

| Guard | What it does |
| :-- | :-- |
| `core/firestore-paths.ts` | The **only** place a Firestore path is built. Exposes `COLLECTIONS`, the trash helpers and the `ownerId`-filtered queries; validates every segment it is handed. |
| `tests/isolation.test.mjs` | Fails if any file under `src/` calls `collection(db, …)` / `doc(db, …)` directly, or names a foreign collection in a string literal. |
| `firebase.json` | Names its deploy target explicitly, so a rules deploy from here cannot reach another database. The database id is load-bearing: omitting it targets the default. |

```bash
npm run test:isolation
```

If it fails, **do not add an exception** — route the call through the helpers in
`firestore-paths.ts` instead.

---

## Collections

Top-level collections, not a per-user tree. Ownership rides on an `ownerId`
field rather than the path.

```
teacher-corner-dev
├── users/{uid}                                    teacher profile, keyed by uid
├── institutions/{id}                              ACTIVE
│   └── trash/DeletedInstitutes/{id}               deleted
├── classrooms/{id}                                ACTIVE  (classrooms + STEM clubs)
│   └── trash/DeletedClassrooms/{id}
├── programmes/{id}                                ACTIVE
│   └── trash/DeletedProgrammes/{id}
├── learningUnits/{id}                             ACTIVE  (page unrouted)
│   └── trash/DeletedLearningUnits/{id}
├── teachers/{id}                                  records ABOUT people, not identities
│   └── trash/DeletedTeachers/{id}
├── Configuration/{document}                       option vocabularies
└── OTPVerifications/{phone}                       server-owned OTP challenge
```

Deletion is a **move**, not a flag: the document is written into the trash
subcollection and removed from the active one in a single transaction, and a
restore reverses it. `trash` is a document sitting alongside the active rows,
with the deleted ones beneath it; both it and the subcollection name are pinned
in the rules rather than wildcards, so no unaudited tree can be invented.

---

## Permissions

What `firestore.rules` currently grants. `signedIn()` is `request.auth != null`
and nothing more.

| Path | read | create | update | delete |
| :-- | :-- | :-- | :-- | :-- |
| `users/{uid}` and everything below it | owner | owner | owner | owner |
| `institutions/{id}` | signed in | signed in, id ≠ `trash` | signed in | signed in |
| `classrooms/{id}` | signed in | signed in, id ≠ `trash` | signed in | signed in |
| `programmes/{id}` | signed in | signed in, id ≠ `trash` | signed in | signed in |
| `learningUnits/{id}` | signed in | signed in, id ≠ `trash` | signed in | signed in |
| `teachers/{id}` | signed in | signed in, id ≠ `trash` | signed in | signed in |
| `<collection>/trash/Deleted…/{id}` | signed in | signed in | **never** | signed in |
| `Configuration/{document}` | signed in | — | — | — |
| `OTPVerifications/{phone}` | **never** | **never** | **never** | **never** |
| anything else | **never** | **never** | **never** | **never** |

Reading the table:

- **`users/{uid}` is the only owner-scoped path.** The uid is the document id,
  so the rule is one comparison with no `get()` lookup.
- **The five data collections authorise on authentication alone.** They are not
  narrowed by `ownerId`; the field is written and the app's queries filter on
  it, but the rules do not require it. Any signed-in account can read and write
  any row. This was raised and accepted as a deliberate staging decision, and
  the `ownsExisting()` helper is kept unused in the rules file so narrowing it
  again is a substitution rather than a rewrite.
- **`id != 'trash'` is integrity, not authorization.** That id is the container
  document for deleted rows; creating a document with it would overwrite the
  container.
- **Trash grants no update.** Nothing legitimately edits a document while it is
  in the trash — `create` is what a delete does, `delete` is what a restore
  does. Restore it first.
- **The `trash` container document itself gets no rule**, so it stays
  unreadable. It holds no fields and need not exist.
- **`Configuration` is read-only to clients.** It holds the vocabulary every
  other user's forms are built from, so one client write would change what every
  teacher can select. Seeding goes through `scripts/seed-configuration.mjs` on
  the Admin SDK, which bypasses rules. `ConfigurationService` falls back to the
  built-in lists when a document is missing or empty, so a denied read degrades
  to shipped behaviour rather than empty selects.
- **`OTPVerifications` is closed to every client.** It holds `salt` and
  `hashedOtp` for a live challenge. Read access would allow lifting both and
  brute-forcing a six-digit code offline; write access would allow storing a
  hash of a chosen code and verifying against it. The functions reach it through
  the Admin SDK, which bypasses rules, so denying clients costs nothing.
- **The catch-all denies everything else**, so a new collection is closed until
  its own block is added.

```bash
npm run test:rules        # against the emulator
```

---

## Authentication

Two routes, both ending in a Firebase session.

**Mobile number + OTP — the primary route.** The login page leads with it.
`OtpService` calls two callable Gen2 functions in `asia-south1`:

| Function | What it does |
| :-- | :-- |
| `tcDevSendOtp` | Normalises the phone number, generates a code, stores `salt` + `hashedOtp` in `OTPVerifications/{phone}`, and sends the SMS through Exotel. Holds the Exotel credentials as bound secrets. Rate-limited by `requestCount` / `windowStart` on the same document. |
| `tcDevVerifyOtp` | Checks the submitted code against the stored hash and returns a **custom token**. No Exotel secrets — it sends nothing. |

The code is generated, hashed and verified entirely server-side; the client
never sees it. `AuthService.loginWithToken()` exchanges the custom token for a
session via `signInWithCustomToken`. Numbers listed in `TEST_PHONES` get the
code written to the function log and the SMS skipped — with that unset, every
number receives a real, billed SMS.

**Google — the secondary route**, offered under an "or".
`AuthService.loginWithGoogle()` uses `signInWithPopup` with a fresh
`GoogleAuthProvider` per call.

There is **no email/password sign-in.**

`AuthService.isPhoneSession()` reads `providerData` to tell the two apart, which
matters because a phone sign-in has no display name or photo of its own.
`AuthService.role()` returns a hardcoded `'Teacher'`; it sits behind a method so
the eventual custom claim or `teachers` lookup is a change to one body.

**Guards.** `authGuard` protects the shell; `registrationGuard` sits on it
alongside, with `registrationCompleteGuard` on `/register` and
`approvalPendingGuard` on `/approval-page`.

---

## Pointing it at your own project

`src/environments/environment.ts` ships with the live config for the
`Teacher Corner Dev` app in `helix-staging-india`. To run against a different
project, replace the `firebase` object:

```bash
firebase apps:sdkconfig WEB --project <your-project-id>
```

These values are **not secrets** — the Firebase web config is compiled into the
client bundle by design. Access control comes from Firebase Auth and the
security rules.

You will also need, in the Firebase console:

- **Google** enabled under Authentication → Sign-in method, with `localhost` in
  Authorized domains
- A `teacher-corner-dev` database, with `firestore.rules` deployed to it
- The OTP functions deployed, their Exotel secrets bound, and
  `functions-otp/.env` populated from `.env.example` — otherwise the mobile
  route fails and only Google works

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
│   │   ├── logo/            official ThinkTac artwork; colour/white, full/mark
│   │   └── update-profile/  shared by /profile and the shell user menu
│   ├── core/
│   │   ├── firebase.ts      Firebase app + Auth + Firestore singletons
│   │   ├── firestore-paths.ts  the ONLY place a Firestore path is built
│   │   ├── configuration.ts sheet/option vocabulary types
│   │   ├── csv.ts           CSV parsing for bulk upload
│   │   └── xlsx.ts          spreadsheet parsing for bulk upload
│   ├── data/                option lists, taxonomies, static page content
│   ├── guards/
│   │   ├── auth-guard.ts    session-aware guard on the shell route
│   │   └── registration-guard.ts  registration + approval gating
│   ├── layout/
│   │   └── shell/           sidebar + topbar + <router-outlet>
│   ├── models/
│   │   └── teaching.model.ts  institution, classroom, programme, teacher shapes
│   ├── pages/
│   │   ├── welcome/         splash at '/' (outside the shell)
│   │   ├── login/           mobile OTP + Google (outside the shell)
│   │   ├── register/        post-sign-in registration
│   │   ├── approval/        pending-approval holding page
│   │   ├── sign-out/        post-logout confirmation + countdown
│   │   ├── dashboard/       welcome banner + counts + quick-action tiles
│   │   ├── setup-wizard/    wizard + Add Teachers + Bulk Upload Schools
│   │   ├── institutions/    table + Add Institution + edit + Trash
│   │   ├── classrooms/      table + Add Classroom + Manage Programmes + Trash
│   │   ├── programme/       catalogue + Create wizard + edit + Trash
│   │   ├── learning-units/  built, but NOT routed
│   │   └── profile/         account details
│   ├── services/            auth, otp, profile, dashboard, notification, and
│   │                        one service per collection
│   ├── app.routes.ts        route table
│   └── app.config.ts        providers
├── environments/
│   └── environment.ts       Firebase web config
└── styles.css               design tokens, reset, shared primitives

functions-otp/              Gen2 callable OTP functions (own package)
tests/isolation.test.mjs    source-level path guard
tests/rules/                rules tests, against the emulator
```

### Routes

| Path | Component | Guarded |
| :-- | :-- | :-- |
| `/` | Welcome | — |
| `/login` | Login | — |
| `/sign-out` | SignOut | — |
| `/register` | Register | `authGuard`, `registrationCompleteGuard` |
| `/approval-page` | Approval | `authGuard`, `approvalPendingGuard` |
| `/dashboard` | Dashboard | `authGuard`, `registrationGuard` |
| `/setup-wizard` | SetupWizard | `authGuard`, `registrationGuard` |
| `/institutions` | Institutions | `authGuard`, `registrationGuard` |
| `/classrooms` | Classrooms | `authGuard`, `registrationGuard` |
| `/programme` | Programme | `authGuard`, `registrationGuard` |
| `/profile` | Profile | `authGuard`, `registrationGuard` |
| anything else | → `/` | — |

Every page is lazy: `loadComponent` rather than a top-level import. The guards
sit on the parent `Shell` route, not on each child, so a page added later is
protected by default rather than by remembering to attach them.

`/learning-units` is **not** registered, so it falls through to the wildcard.

---

## Classrooms

Rebuilds the `manage-classrooms` screen from ThinkTac production
(the production Teacher Corner app), using its field names
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

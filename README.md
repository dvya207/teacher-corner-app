# Teacher Corner

<!-- Centred with HTML because Markdown has no alignment of its own, and GitHub
     permits align on a <p>. Inside HTML the badges have to be <img> tags rather
     than Markdown image syntax, which is not parsed there.

     height="26" rather than shields.io's for-the-badge style: that style is much
     larger AND uppercases the text, which is a different look rather than a
     bigger one. Setting height alone scales the flat-square badge and lets the
     width follow, so nothing distorts. -->
<p align="center">
  <img alt="Angular" height="26" src="https://img.shields.io/badge/Angular-21-DD0031?style=flat-square&logo=angular&logoColor=white">
  <img alt="TypeScript" height="26" src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="RxJS" height="26" src="https://img.shields.io/badge/RxJS-7.8-B7178C?style=flat-square&logo=reactivex&logoColor=white">
  <img alt="Firebase" height="26" src="https://img.shields.io/badge/Firebase-12-FFCA28?style=flat-square&logo=firebase&logoColor=black">
  <img alt="Cloud Firestore" height="26" src="https://img.shields.io/badge/Cloud%20Firestore-FFA000?style=flat-square&logo=firebase&logoColor=black">
  <img alt="Node.js" height="26" src="https://img.shields.io/badge/Node.js-20-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white">
</p>

A web console for teachers to manage their schools, classes and programmes.

## What it does

- **Sign in** with a mobile number and a one-time code, or with Google
- **Register** an account, which an administrator then approves
- **Institutions** — add and edit schools, with a trash and restore
- **Classrooms** — classes and STEM clubs, and the programmes each one runs
- **Programmes** — a catalogue, created through a short wizard
- **Set Up Wizard** — add schools in bulk, then add teachers to their classes

Deleting is always a move to a trash rather than a flag, so anything removed can
be restored.

## Running it

```bash
npm install
npm start          # http://localhost:4200
npm run build
npm test
```

## Configuration

The app needs a Firebase project of your own. Two files to fill in:

| File | What goes in it |
| :-- | :-- |
| `src/environments/environment.ts` | Your web app config, from `firebase apps:sdkconfig WEB` |
| `functions-otp/.env` | Copy `.env.example` and fill in the SMS provider values |

In the Firebase console you will also need Google sign-in enabled, `localhost`
added to the authorised domains, and the security rules and OTP functions
deployed.

Without the OTP functions the mobile route will not work and only Google
sign-in does.

## Layout

```
src/app/
├── components/   icons, logo, shared profile editor
├── core/         app setup, data access helpers, file parsing
├── data/         option lists and static page content
├── guards/       route protection, registration and approval gating
├── layout/       the app shell — sidebar, topbar, router outlet
├── models/       the shapes the app stores
├── pages/        one folder per screen
└── services/     one per area, plus auth, profile and dashboard

functions-otp/    the send and verify functions for one-time codes
tests/            source-level guards and rules tests
```

## Pages

| Path | Notes |
| :-- | :-- |
| `/` | Splash; sends you to sign-in or the dashboard |
| `/login` | Mobile code, or Google |
| `/register`, `/approval-page` | After signing in, before the app opens |
| `/dashboard` | Counts and quick actions |
| `/institutions`, `/classrooms`, `/programme` | The main screens |
| `/setup-wizard` | Bulk school upload and adding teachers |
| `/profile` | Account details |

Every page loads on demand, and everything behind sign-in is protected by a
guard on the shell rather than page by page — so a page added later is protected
by default.

## Tests

```bash
npm test                  # unit tests
npm run test:isolation    # checks data access goes through the helpers
npm run test:rules        # security rules, against the emulator
```

## Notes for editing

**The app is zoneless.** Anything the template reads, and anything changed after
an `await`, has to be a signal — a plain field assigned in a promise will not
reach the screen.

**Component styles do not leak.** A parent stylesheet cannot reach inside a child
component, so pass an input instead of writing a CSS rule for it.

**Colours and spacing live in `src/styles.css`.** Component styles read those
variables and never restate a value.

**The logo files are supplied artwork.** Do not redraw them.

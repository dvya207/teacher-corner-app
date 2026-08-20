#!/usr/bin/env bash
#
# Provisions the `classrooms` and `programmes` collection TREES in
# helix-staging-india / teacher-corner-dev, in the same shape `institutions`
# already has.
#
# ─────────────────────────────────────────────────────────────────────────────
# THERE IS NO "CREATE COLLECTION" IN FIRESTORE, and that is why this script
# exists rather than a console click. A collection is not a thing you make; it
# is the set of documents that happen to be under a path. It appears in the
# console the moment its first document is written and disappears again when the
# last one is deleted. So "create the collection" can only mean "write a document
# into it", which is what this does.
#
# THE SHAPE, copied from institutions:
#
#   classrooms/{docId}                            ← ACTIVE
#   classrooms/trash/DeletedClassrooms/{docId}    ← DELETED
#
#   programmes/{docId}                            ← ACTIVE
#   programmes/trash/DeletedProgrammes/{docId}    ← DELETED
#
# Active documents sit DIRECTLY inside the collection — no wrapper collection,
# no container document, no `items` level. Deleted ones live under a `trash`
# SENTINEL DOCUMENT that sits alongside them, exactly as
# `institutions/trash/DeletedInstitutes` does.
#
# THE SENTINEL IS NOT WRITTEN, deliberately. Firestore serves a subcollection
# under a document that does not exist, so `classrooms/trash` stays a phantom:
# the console shows it in italics and it has no fields. Creating a real one would
# raise the question of who owns a document shared by every teacher, and the
# security rules give it no rule of its own precisely so it stays unreadable. The
# app's own code says the same — see TRASH_DOC in src/app/core/firestore-paths.ts.
#
# DELETION IS A MOVE, NOT A FLAG. There is no `active` or `deleted` boolean
# anywhere in these documents. A document's COLLECTION is what says whether it is
# live, so a query against `classrooms` cannot return a deleted row even if
# someone forgets a filter — the row is not there to return. The document id is
# preserved across the move, which is what makes delete and restore exact
# inverses.
#
# EVERY DOCUMENT CARRIES ownerId. These are top-level collections, so the rules
# have no uid in the path to compare against and read ownership off the document
# instead. A document written without it is invisible to the app AND unreadable
# through the rules — which is also why --uid is required rather than optional.
#
# WHAT IT WRITES. One active and one trashed document in each of the two trees,
# four in total, with the exact field shape src/app/models/teaching.model.ts
# declares. They are attached to a real institution of yours, so the seeded
# classroom and programme are coherent rather than dangling.
#
# The ids are fixed (`seed-…`), which makes the script idempotent — re-running
# overwrites the same four documents rather than accumulating more — and makes
# --teardown exact.
#
# WHY REST AND NOT THE FIREBASE CLI. `firebase firestore:` can delete documents
# and manage indexes; it cannot write one. The Admin SDK wrapper at
# ~/.claude/scripts/firebase/fbadmin.js has no named-database support and targets
# (default), which belongs to four other apps — pointing it here would be a bug
# with consequences. A PATCH to the document's own URL creates or replaces
# exactly that document and touches nothing else.
#
# AUTH. Needs an access token with the datastore scope:
#
#     gcloud auth application-default login
#
# RUN. Lists what it would write and changes nothing:
#
#     ./scripts/provision-collections.sh --uid <teacher-uid>
#
# Applies it, after you have read that list:
#
#     ./scripts/provision-collections.sh --uid <teacher-uid> --apply
#
# Removes exactly the four documents it wrote, and nothing else:
#
#     ./scripts/provision-collections.sh --uid <teacher-uid> --teardown --apply
#
# INSTITUTIONS ARE NOT TOUCHED. This script reads one institution to attach the
# seeds to and never writes to that collection. Its security rules are likewise
# untouched — the blocks added to firestore.rules for these two trees sit after
# the institutions blocks and do not modify them.
#
set -euo pipefail

PROJECT="helix-staging-india"
DATABASE="teacher-corner-dev"
BASE="https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/documents"

UID_ARG=""
APPLY="no"
TEARDOWN="no"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --uid)      UID_ARG="${2:-}"; shift 2 ;;
    --apply)    APPLY="yes"; shift ;;
    --teardown) TEARDOWN="yes"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$UID_ARG" ]]; then
  cat >&2 <<'USAGE'
--uid is required.

Every document in these collections carries an ownerId, because the rules read
ownership off the document rather than the path. A seed written without one is
invisible to the app and unreadable through the rules, so there is no sensible
default.

Find yours in the Firebase console under Authentication, or from the app: it is
the uid the profile page shows.

    ./scripts/provision-collections.sh --uid <teacher-uid>
USAGE
  exit 2
fi

TOKEN="$(gcloud auth application-default print-access-token 2>/dev/null || true)"
if [[ -z "$TOKEN" ]]; then
  echo "No access token. Run: gcloud auth application-default login" >&2
  exit 1
fi

echo "project  : ${PROJECT}"
echo "database : ${DATABASE}"
echo "owner    : ${UID_ARG}"
echo "action   : $([[ "$TEARDOWN" == yes ]] && echo 'TEARDOWN' || echo 'provision')"
echo "mode     : $([[ "$APPLY" == yes ]] && echo APPLY || echo 'dry run (nothing will change)')"
echo

# The four documents this script owns. Nothing outside this list is ever written
# or deleted, which is what makes --teardown safe to run without reading it first.
PATHS=(
  "classrooms/seed-classroom"
  "classrooms/trash/DeletedClassrooms/seed-classroom-trashed"
  "programmes/seed-programme"
  "programmes/trash/DeletedProgrammes/seed-programme-trashed"
)

# ---------------------------------------------------------------------------
# Teardown
# ---------------------------------------------------------------------------
if [[ "$TEARDOWN" == "yes" ]]; then
  for REL in "${PATHS[@]}"; do
    if [[ "$APPLY" != "yes" ]]; then
      echo "would delete ${REL}"
      continue
    fi

    RESULT="$(curl -sS -X DELETE -H "Authorization: Bearer ${TOKEN}" "${BASE}/${REL}")"

    # A 200 with an empty body is success. A missing document also reports
    # success, which is what makes re-running teardown harmless.
    if echo "$RESULT" | grep -q '"error"'; then
      echo "FAILED ${REL}" >&2
      echo "$RESULT" >&2
      exit 1
    fi

    echo "deleted ${REL}"
  done

  echo
  echo "Teardown $([[ "$APPLY" == yes ]] && echo 'complete' || echo 'dry run') — 4 document(s)."
  echo "The collections themselves vanish once their last document is gone."
  exit 0
fi

# ---------------------------------------------------------------------------
# Find an institution to attach the seeds to
#
# Read-only, and the ONLY thing this script does with institutions. A classroom
# and a programme both belong to a school; inventing an institutionId would
# produce two documents that reference a school that does not exist, which is
# worse than not seeding at all.
# ---------------------------------------------------------------------------
INSTITUTIONS="$(curl -sS -H "Authorization: Bearer ${TOKEN}" "${BASE}/institutions?pageSize=300")"

if echo "$INSTITUTIONS" | grep -q '"error"'; then
  echo "$INSTITUTIONS" >&2
  exit 1
fi

INSTITUTION="$(printf '%s' "$INSTITUTIONS" | OWNER="$UID_ARG" python3 -c '
import json, os, sys

owner = os.environ["OWNER"]
payload = json.load(sys.stdin)

for document in payload.get("documents", []):
    fields = document.get("fields", {})
    # The trash sentinel has no ownerId, so it is skipped by this test without
    # needing a special case — the same reason the app never sees it in a list.
    if fields.get("ownerId", {}).get("stringValue") != owner:
        continue
    print("\t".join([
        document["name"].rsplit("/", 1)[-1],
        fields.get("institutionName", {}).get("stringValue", ""),
        fields.get("board", {}).get("stringValue", ""),
    ]))
    break
')"

if [[ -z "$INSTITUTION" ]]; then
  echo "No institution owned by ${UID_ARG} was found in ${DATABASE}." >&2
  echo >&2
  echo "A classroom and a programme both belong to a school, so there is nothing" >&2
  echo "coherent to attach these to. Create one first from the app's Institutions" >&2
  echo "page, then re-run this." >&2
  exit 1
fi

IFS=$'\t' read -r INST_ID INST_NAME INST_BOARD <<< "$INSTITUTION"

echo "attaching to institution : ${INST_NAME} (${INST_ID})"
echo

# ---------------------------------------------------------------------------
# Build and write the four documents
#
# The field shapes below are src/app/models/teaching.model.ts verbatim. Every
# field is written even where it is empty — the app normalises on read precisely
# because a missing key comes back undefined, and Firestore then rejects the
# whole document on the next write that copies it.
# ---------------------------------------------------------------------------
DOCS="$(OWNER="$UID_ARG" INST_ID="$INST_ID" INST_NAME="$INST_NAME" INST_BOARD="$INST_BOARD" python3 <<'PY'
import json, os
from datetime import datetime, timezone

owner = os.environ["OWNER"]
inst_id = os.environ["INST_ID"]
inst_name = os.environ["INST_NAME"]
board = os.environ["INST_BOARD"] or "CBSE"

now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def s(value):
    return {"stringValue": value}


def i(value):
    # Firestore's REST encoding wants integers as STRINGS. Sending a JSON number
    # here silently stores a double, and the app's `studentCounter` would come
    # back as 0.0 rather than 0.
    return {"integerValue": str(value)}


def ts(value):
    return {"timestampValue": value}


def arr(values):
    return {"arrayValue": {"values": [s(v) for v in values]} if values else {}}


def m(fields):
    return {"mapValue": {"fields": fields} if fields else {}}


# One programme, referenced by the classroom below so the two seeds are
# consistent with each other — a classroom's `programmes` map is a denormalised
# COPY, not a reference, which is why the same four fields appear twice.
PROGRAMME_ID = "seed-programme"
PROGRAMME_ENTRY = {
    "programmeId": s(PROGRAMME_ID),
    "programmeName": s(f"{inst_name} 26-27 Grade 8 - Science"),
    "programmeCode": s("P10001"),
    "displayName": s(f"{inst_name} 26-27 Grade 8 - Science"),
}


def classroom(doc_id, trashed=False):
    fields = {
        "docId": s(doc_id),
        "classroomId": s(doc_id),
        "classroomCode": s("001" if not trashed else "002"),
        "type": s("CLASSROOM"),
        # The variant that does not apply is stored EMPTY, never omitted. A STEM
        # club would be the mirror of this: stemClubName set, these three empty.
        "classroomName": s("8 B" if not trashed else "8 C"),
        "stemClubName": s(""),
        "grade": s("8"),
        "section": s("B" if not trashed else "C"),
        "board": s(board),
        "institutionId": s(inst_id),
        "institutionName": s(inst_name),
        "programmes": m({PROGRAMME_ID: m(PROGRAMME_ENTRY)}),
        "studentCounter": i(0),
        "studentCredentialStoragePath": s(""),
        "ownerId": s(owner),
        "creationDate": ts(now),
        "createdAt": ts(now),
        "updatedAt": ts(now),
    }
    if trashed:
        # The ONLY field the trash adds. A restore strips exactly this and puts
        # back a document byte-identical to what was deleted.
        fields["trashAt"] = ts(now)
    return fields


def programme(doc_id, trashed=False):
    name = f"{inst_name} 26-27 Grade 8 - Science" if not trashed \
        else f"{inst_name} 26-27 Grade 8 - Maths"
    fields = {
        "docId": s(doc_id),
        "programmeId": s(doc_id),
        "programmeName": s(name),
        # Allocated from the per-teacher counter at users/{uid}/counters/programmes
        # in the app. Fixed here so the seed is reproducible.
        "programmeCode": s("P10001" if not trashed else "P10002"),
        "displayName": s(name),
        "programmeDescription": s("Seeded by scripts/provision-collections.sh"),
        "institutionId": s(inst_id),
        "institutionName": s(inst_name),
        # Grade-scoped, so the age band stays empty. A range is stored EXPANDED:
        # grades 4-6 would be ["4","5","6"], not its endpoints.
        "grades": arr(["8"]),
        "age": arr([]),
        "type": s("REGULAR"),
        # production's misspelling is the stored value for the other status;
        # LIVE is the only one the classroom pickers offer.
        "programmeStatus": s("LIVE"),
        "programmeImagePath": s(""),
        "learningUnitsIds": arr([]),
        "assignmentIds": arr([]),
        "ownerId": s(owner),
        "createdAt": ts(now),
        "updatedAt": ts(now),
    }
    if trashed:
        fields["trashAt"] = ts(now)
    return fields


documents = [
    ("classrooms/seed-classroom", classroom("seed-classroom")),
    ("classrooms/trash/DeletedClassrooms/seed-classroom-trashed",
     classroom("seed-classroom-trashed", trashed=True)),
    ("programmes/seed-programme", programme("seed-programme")),
    ("programmes/trash/DeletedProgrammes/seed-programme-trashed",
     programme("seed-programme-trashed", trashed=True)),
]

for path, fields in documents:
    print(path + "\t" + json.dumps({"fields": fields}))
PY
)"

COUNT=0
while IFS=$'\t' read -r REL BODY; do
  [[ -z "$REL" ]] && continue
  COUNT=$((COUNT + 1))

  if [[ "$APPLY" != "yes" ]]; then
    echo "would write ${REL}"
    continue
  fi

  # PATCH on the document's own URL with no updateMask: creates it if absent,
  # replaces it wholesale if present. That is what makes re-running idempotent
  # rather than additive.
  RESULT="$(curl -sS -X PATCH \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Content-Type: application/json' \
    --data "$BODY" \
    "${BASE}/${REL}")"

  if echo "$RESULT" | grep -q '"error"'; then
    echo "FAILED ${REL}" >&2
    echo "$RESULT" >&2
    exit 1
  fi

  echo "wrote ${REL}"
done <<< "$DOCS"

echo
echo "${COUNT} document(s) $([[ "$APPLY" == yes ]] && echo 'written' || echo 'would be written')."

if [[ "$APPLY" == "yes" ]]; then
  cat <<'DONE'

Both collections now exist, in the same shape as institutions:

  classrooms/seed-classroom                                    ACTIVE
  classrooms/trash/DeletedClassrooms/seed-classroom-trashed    DELETED
  programmes/seed-programme                                    ACTIVE
  programmes/trash/DeletedProgrammes/seed-programme-trashed    DELETED

`classrooms/trash` and `programmes/trash` show in the console in ITALICS. That
is correct and not a mistake — the sentinel is a phantom document that holds no
fields and is never written, exactly as institutions/trash is. Firestore serves
a subcollection under a document that does not exist.

Remove all four again with:

  ./scripts/provision-collections.sh --uid <teacher-uid> --teardown --apply
DONE
fi

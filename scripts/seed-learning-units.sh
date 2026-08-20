#!/usr/bin/env bash
#
# Seeds the `learningUnits` collection TREE in helix-staging-india /
# teacher-corner-dev with a set chosen to exercise the Add-a-New-Learning-Unit-
# or-Version feature end to end.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY A SECOND SCRIPT RATHER THAN EXTENDING provision-collections.sh
#
# That script seeds classrooms and programmes, and it CANNOT run until an
# institution owned by the same uid already exists — a classroom belongs to a
# school, so it reads one and refuses to invent it. Learning units belong to
# nobody: they are a flat catalogue keyed only on ownerId. Folding them into that
# script would make seeding the catalogue depend on having a school, which it
# does not, and would put a second unrelated concern behind that script's
# institution gate.
#
# The two scripts therefore own disjoint sets of documents and neither reads nor
# writes the other's. This one touches `learningUnits` and NOTHING else — not
# institutions, not classrooms, not programmes, not rules, not indexes.
#
# ─────────────────────────────────────────────────────────────────────────────
# THE SHAPE, the same one the other three collections use:
#
#   learningUnits/{docId}                                      ← ACTIVE
#   learningUnits/trash/DeletedLearningUnits/{docId}            ← DELETED
#
# The `trash` sentinel is NOT written, deliberately — Firestore serves a
# subcollection under a document that does not exist, so it stays a phantom shown
# in italics in the console. See TRASH_DOC in src/app/core/firestore-paths.ts and
# the same note in provision-collections.sh.
#
# EVERY DOCUMENT CARRIES ownerId, because `learningUnits` is top-level and the
# rules read ownership off the document rather than from the path. A document
# written without it is invisible to the app AND unreadable through the rules,
# which is why --uid is required rather than defaulted.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHAT IT SEEDS, AND WHY EACH ONE IS THERE
#
# Eight documents: seven active, one trashed. This is not a token row — each one
# exercises something the feature does that a single document could not show.
#
#   AE04 EN V10  LIVE      Gold      ┐ THREE DOCUMENTS SHARING A CODE. This is
#   AE04 EN V11  LIVE      Silver    │ the "or Version" case, and it is what
#   AE04 KN V10  DEVELOP.  Diamond   ┘ production's three side-by-side AE04
#                                      cards are. Picking AE04 from the name
#                                      suggestions must then compute the next
#                                      English version as V12 and the next
#                                      Kannada one as V11 — per language, which
#                                      only a family like this can demonstrate.
#
#   PS07 EN V10  LIVE      Gold        Four more domain/sub-domain pairs, so the
#   PL23 HI V10  LIVE      Platinum    categorisation actually varies and the
#   NN04 EN V10  DEVELOP.  Silver      Domain / Sub-Domain / Subject columns and
#   CC14 TA V10  DEVELOP.  Gold        the card grid are not one value repeated.
#
#   BM12 EN V13  LIVE      Diamond     TRASHED. Gives the Trash panel a row that
#                                      fills all six of its columns — Code, Name
#                                      over display name, Version, Status, Owner,
#                                      Deleted Date — and gives Restore something
#                                      to restore. V13 also proves version
#                                      arithmetic skips past trashed numbers: a
#                                      new BM12 EN version must come out V14, not
#                                      V10.
#
# The mix of statuses is deliberate: four LIVE and three draft among the active
# rows, so the three stat cards and the All / Live / Draft pills all show
# non-zero counts instead of one bucket holding everything. All four maturities
# appear for the same reason.
#
# THE CODES ARE REAL. Every one is a learning unit that exists in ThinkTac
# production (AE04 "2D Algebraic Tiles", PS07 "Harmonica Model", PL23 "Box
# Pinhole Camera", NN04 "Rectangle - Area", CC14 "Food Test - Protein", BM12
# "Soil Erosion Model"), and every letter pair resolves in
# src/app/data/learning-unit-taxonomy.ts — so the app categorises these rows
# rather than showing them as uncategorised, and the code field accepts them.
#
# THE IDS ARE FIXED (`seed-lu-…`), which makes the script idempotent — re-running
# replaces the same eight documents rather than accumulating more — and makes
# --teardown exact.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY REST AND NOT THE FIREBASE CLI. `firebase firestore:` can delete documents
# and manage indexes; it cannot write one. The Admin SDK wrapper at
# ~/.claude/scripts/firebase/fbadmin.js has no named-database support and targets
# (default), which belongs to other apps — pointing it here would be a bug with
# consequences. A PATCH to the document's own URL creates or replaces exactly
# that document and touches nothing else.
#
# THE DATABASE IS PINNED IN THE URL. Every request goes to
# .../databases/teacher-corner-dev/documents/..., so there is no ambient
# "current database" to get wrong and no way for a flag to redirect this at
# (default) or at any other project.
#
# ─────────────────────────────────────────────────────────────────────────────
# AUTH. Needed only to APPLY or to TEAR DOWN. The dry run builds every payload
# offline and needs no credentials at all, which is the whole point of reading it
# before authenticating.
#
#     gcloud auth application-default login
#
# RUN. Prints every document in full and changes nothing:
#
#     ./scripts/seed-learning-units.sh --uid <teacher-uid>
#
# Writes them, after you have read that:
#
#     ./scripts/seed-learning-units.sh --uid <teacher-uid> --apply
#
# Removes exactly the eight documents it wrote, and nothing else:
#
#     ./scripts/seed-learning-units.sh --uid <teacher-uid> --teardown --apply
#
set -euo pipefail

PROJECT="helix-staging-india"
DATABASE="teacher-corner-dev"
BASE="https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/documents"

UID_ARG=""
APPLY="no"
TEARDOWN="no"
QUIET="no"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --uid)      UID_ARG="${2:-}"; shift 2 ;;
    --apply)    APPLY="yes"; shift ;;
    --teardown) TEARDOWN="yes"; shift ;;
    --quiet)    QUIET="yes"; shift ;;
    -h|--help)  sed -n '2,115p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$UID_ARG" ]]; then
  cat >&2 <<'USAGE'
--uid is required.

Every document in this collection carries an ownerId, because `learningUnits` is
top-level and the rules read ownership off the document rather than the path. A
seed written without one is invisible to the app and unreadable through the
rules, so there is no sensible default.

Find yours in the Firebase console under Authentication, or from the app: it is
the uid the profile page shows.

    ./scripts/seed-learning-units.sh --uid <teacher-uid>
USAGE
  exit 2
fi

# ---------------------------------------------------------------------------
# The eight documents this script owns.
#
# Nothing outside this list is ever written or deleted, which is what makes
# --teardown safe to run without reading it first.
# ---------------------------------------------------------------------------
PATHS=(
  "learningUnits/seed-lu-ae04-en-v10"
  "learningUnits/seed-lu-ae04-en-v11"
  "learningUnits/seed-lu-ae04-kn-v10"
  "learningUnits/seed-lu-ps07-en-v10"
  "learningUnits/seed-lu-pl23-hi-v10"
  "learningUnits/seed-lu-nn04-en-v10"
  "learningUnits/seed-lu-cc14-ta-v10"
  "learningUnits/trash/DeletedLearningUnits/seed-lu-bm12-en-v13-trashed"
)

# The token is fetched ONLY when it is actually needed. A dry run that demanded
# credentials would be unreadable until you had authenticated, which defeats the
# purpose of having one.
TOKEN=""
if [[ "$APPLY" == "yes" ]]; then
  TOKEN="$(gcloud auth application-default print-access-token 2>/dev/null || true)"

  if [[ -z "$TOKEN" ]]; then
    cat >&2 <<'AUTH'
No access token, so nothing can be written.

    gcloud auth application-default login

That is an interactive browser flow and cannot be scripted. The dry run needs no
credentials — drop --apply to read what this would write.
AUTH
    exit 1
  fi
fi

if [[ "$QUIET" != "yes" ]]; then
  echo "project  : ${PROJECT}"
  echo "database : ${DATABASE}   (learningUnits only — no other collection is read or written)"
  echo "owner    : ${UID_ARG}"
  echo "action   : $([[ "$TEARDOWN" == yes ]] && echo 'TEARDOWN' || echo 'seed')"
  echo "mode     : $([[ "$APPLY" == yes ]] && echo APPLY || echo 'dry run (nothing will change)')"
  echo
fi

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
  echo "Teardown $([[ "$APPLY" == yes ]] && echo 'complete' || echo 'dry run') — ${#PATHS[@]} document(s)."
  echo "The collection itself vanishes once its last document is gone."
  exit 0
fi

# ---------------------------------------------------------------------------
# Build the documents
#
# The field shapes below are src/app/models/teaching.model.ts verbatim, including
# the fields the Add form fills in automatically. Every field is written even
# where it is empty — the app normalises on read precisely because a missing key
# comes back undefined, and Firestore then rejects the whole document on the next
# write that copies it.
# ---------------------------------------------------------------------------
DOCS="$(OWNER="$UID_ARG" python3 <<'PY'
import json, os
from datetime import datetime, timedelta, timezone

owner = os.environ["OWNER"]
now = datetime.now(timezone.utc)


def stamp(offset_days=0):
    return (now - timedelta(days=offset_days)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def s(value):
    return {"stringValue": value}


def i(value):
    # Firestore's REST encoding wants integers as STRINGS. Sending a JSON number
    # here silently stores a double, and `totalTime` would come back as 45.0.
    return {"integerValue": str(value)}


def ts(value):
    return {"timestampValue": value}


# The taxonomy rows these codes resolve to, matching
# src/app/data/learning-unit-taxonomy.ts exactly. Written out rather than
# derived, so the seed cannot silently disagree with the app: if the taxonomy
# file is later replaced by the real Configuration documents, a mismatch here
# becomes visible as a categorisation that does not match the code.
TAXONOMY = {
    "AE": ("MA", "Mathematics", "A", "Algebra", "E", "Expressions and Identities"),
    "PS": ("SC", "Science", "P", "Physics", "S", "Sound"),
    "PL": ("SC", "Science", "P", "Physics", "L", "Light"),
    "NN": ("MA", "Mathematics", "N", "Numeracy", "N", "Mensuration"),
    "CC": ("SC", "Science", "C", "Chemistry", "C", "Chemical Change"),
    "BM": ("SC", "Science", "B", "Biology", "M", "Environment and Soil"),
}

# 'TACtivity' / 'TA' is LEARNING_UNIT_TYPES[0]. typeCode is stored alongside the
# name rather than derived, because it is the first segment of learningUnitId and
# a type renamed later must not retroactively rewrite ids already minted.
TYPE_NAME = "TACtivity"
TYPE_CODE = "TA"


def unit(doc_id, code, name, iso, version, status, maturity,
         difficulty, total_time, age_days, display_name=None, trashed=False):
    pair = code[:2]
    subject_code, subject_name, domain_code, domain_name, sub_code, sub_name = TAXONOMY[pair]
    created = stamp(age_days)

    fields = {
        "docId": s(doc_id),
        # NOT the document id. Production mints a Firestore id for the document
        # and stores a readable identity beside it, so the family is legible in
        # an export without a join.
        "learningUnitId": s(f"{TYPE_CODE}-{code}-{iso}-{version}"),

        "learningUnitCode": s(code),
        "learningUnitName": s(name),
        "learningUnitDisplayName": s(display_name or name),

        # One language per document. A unit in Kannada and English is two
        # documents sharing a code, which is what the AE04 trio below is.
        "isoCode": s(iso),
        # The STORED form, without the language prefix the form field shows:
        # 'V11', not 'EN-V11'.
        "version": s(version),
        "status": s(status),

        "type": s(TYPE_NAME),
        "typeCode": s(TYPE_CODE),
        # Capital M is production's field name, not a typo.
        "Maturity": s(maturity),

        # All seven derived from the code's letter pair by the Add form. Stored
        # rather than recomputed, so a taxonomy row edited later cannot
        # retroactively recategorise units already written under it.
        "subjectCode": s(subject_code),
        "subjectName": s(subject_name),
        "domainCode": s(domain_code),
        "domainName": s(domain_name),
        "subDomainCode": s(sub_code),
        "subDomainName": s(sub_name),
        "compositeCode": s(domain_code + sub_code),

        # Denormalised owner name — the Trash table's Owner column reads it off
        # the deleted document, where no profile join is possible.
        "tacOwnerName": s("Seed Data"),

        "shortDescription": s(f"Seeded by scripts/seed-learning-units.sh — {name}."),
        # A STRING, as the app's model types it: production types the field
        # `number | string` and stores both, and the app coerces on read.
        "difficultyLevel": s(str(difficulty)),
        "totalTime": i(total_time),

        "ownerId": s(owner),
        "createdAt": ts(created),
        "updatedAt": ts(created),
    }

    if trashed:
        # The ONLY field the trash adds. A restore strips exactly this and puts
        # back a document byte-identical to what was deleted.
        fields["trashAt"] = ts(stamp(1))

    return fields


ACTIVE = "learningUnits"
TRASH = "learningUnits/trash/DeletedLearningUnits"

documents = [
    # ---- The AE04 family: one code, three documents -----------------------
    (f"{ACTIVE}/seed-lu-ae04-en-v10", unit(
        "seed-lu-ae04-en-v10", "AE04", "2D Algebraic Tiles",
        "EN", "V10", "LIVE", "Gold", 2, 45, age_days=21)),
    (f"{ACTIVE}/seed-lu-ae04-en-v11", unit(
        "seed-lu-ae04-en-v11", "AE04", "2D Algebraic Tiles",
        "EN", "V11", "LIVE", "Silver", 3, 50, age_days=14,
        display_name="2D Algebraic Tiles (Tool TAC)")),
    (f"{ACTIVE}/seed-lu-ae04-kn-v10", unit(
        "seed-lu-ae04-kn-v10", "AE04", "2D Algebraic Tiles",
        "KN", "V10", "DEVELOPEMENT", "Diamond", 2, 45, age_days=10)),

    # ---- Four more pairs, so the categorisation varies --------------------
    (f"{ACTIVE}/seed-lu-ps07-en-v10", unit(
        "seed-lu-ps07-en-v10", "PS07", "Harmonica Model",
        "EN", "V10", "LIVE", "Gold", 1, 40, age_days=30)),
    (f"{ACTIVE}/seed-lu-pl23-hi-v10", unit(
        "seed-lu-pl23-hi-v10", "PL23", "Box Pinhole Camera",
        "HI", "V10", "LIVE", "Platinum", 4, 75, age_days=25)),
    (f"{ACTIVE}/seed-lu-nn04-en-v10", unit(
        "seed-lu-nn04-en-v10", "NN04", "Rectangle - Area",
        "EN", "V10", "DEVELOPEMENT", "Silver", 1, 30, age_days=7)),
    (f"{ACTIVE}/seed-lu-cc14-ta-v10", unit(
        "seed-lu-cc14-ta-v10", "CC14", "Food Test - Protein",
        "TA", "V10", "DEVELOPEMENT", "Gold", 3, 60, age_days=4)),

    # ---- One in the trash -------------------------------------------------
    (f"{TRASH}/seed-lu-bm12-en-v13-trashed", unit(
        "seed-lu-bm12-en-v13-trashed", "BM12", "Soil Erosion Model",
        "EN", "V13", "LIVE", "Diamond", 2, 55, age_days=40,
        display_name="Soil Erosion Model (Container)", trashed=True)),
]

for path, fields in documents:
    print(path + "\t" + json.dumps({"fields": fields}))
PY
)"

# ---------------------------------------------------------------------------
# Show or write
# ---------------------------------------------------------------------------
COUNT=0
while IFS=$'\t' read -r REL BODY; do
  [[ -z "$REL" ]] && continue
  COUNT=$((COUNT + 1))

  if [[ "$APPLY" != "yes" ]]; then
    echo "── would write ${REL}"
    # Pretty-printed in full. A dry run that only listed paths would not let you
    # check the field shape, which is the part most likely to be wrong.
    printf '%s' "$BODY" | python3 -m json.tool --indent 2 | sed 's/^/   /'
    echo
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

The learningUnits collection now exists, in the same shape as the other three:

  learningUnits/seed-lu-…                                    7 ACTIVE
  learningUnits/trash/DeletedLearningUnits/seed-lu-…          1 DELETED

`learningUnits/trash` shows in the console in ITALICS. That is correct and not a
mistake — the sentinel is a phantom document that holds no fields and is never
written, exactly as institutions/trash is.

What to try in the app:

  1. Learning Units renders 7 rows — 4 Live, 3 Draft. Toggle card / list view.
  2. Three AE04 cards, as in production: EN V10, EN V11, KN V10.
  3. Add → type "2D Algeb" → pick AE04 from the suggestions. The code and
     categorisation lock, and choosing English computes EN-V12 (one past V11).
     Choosing Kannada computes KN-V11.
  4. Add → type a fresh name → language → code PS07. Watch the categorisation
     fill itself in and the composite code become PS. Try ZZ01 to see a
     well-formed code with no taxonomy row refuse to save.
  5. Trash shows Soil Erosion Model with all six columns filled. Restore it,
     then delete it again.
  6. Export downloads LearningUnitData.xlsx with three sheets.

Remove all eight again with:

  ./scripts/seed-learning-units.sh --uid <teacher-uid> --teardown --apply
DONE
fi

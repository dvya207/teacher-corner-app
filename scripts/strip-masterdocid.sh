#!/usr/bin/env bash
#
# Deletes the `masterDocId` field, and NOTHING ELSE, from institution documents
# in helix-staging-india / teacher-corner-dev.
#
# SCOPE IS THE POINT OF THIS FILE. Exactly one field is in scope. An earlier
# version of this script targeted three; it was narrowed on instruction to
# masterDocId alone.
#
#   masterDocId             IN SCOPE. Only ever written as an empty string by the
#                           service, never read by anything.
#   chainName               NOT IN SCOPE. Must be left exactly as it is.
#   institutionCoordinates  NOT IN SCOPE. Must be left exactly as it is.
#
# Do not add fields to FIELDS below without being asked to. The updateMask sent
# to Firestore is built from that array, so widening it widens what is deleted.
#
# WHY A SCRIPT AT ALL. Removing a field from the code does NOT remove it from
# documents already written: updateDoc only touches the keys named in its patch,
# so a stale key survives every later save.
#
# WHY REST AND NOT THE FIREBASE CLI. `firebase firestore:delete` deletes
# documents and collections, not fields. A PATCH carrying an updateMask that
# names a field, with that field absent from the body, deletes exactly that
# field and touches nothing else — which is the operation wanted here.
#
# AUTH. Needs an access token with the datastore scope:
#
#     gcloud auth application-default login
#
# RUN. Lists what it would touch and changes nothing:
#
#     ./scripts/strip-chainname.sh
#
# Applies it, after you have read that list:
#
#     ./scripts/strip-chainname.sh --apply
#
set -euo pipefail

PROJECT="helix-staging-india"
DATABASE="teacher-corner-dev"
COLLECTION="institutions"
# ONE field. See the scope note above before changing this.
FIELDS=(masterDocId)

BASE="https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/documents"

APPLY="no"
[[ "${1:-}" == "--apply" ]] && APPLY="yes"

TOKEN="$(gcloud auth application-default print-access-token 2>/dev/null || true)"
if [[ -z "$TOKEN" ]]; then
  echo "No access token. Run: gcloud auth application-default login" >&2
  exit 1
fi

echo "project  : ${PROJECT}"
echo "database : ${DATABASE}"
echo "fields   : ${FIELDS[*]}"
echo "mode     : $([[ "$APPLY" == yes ]] && echo APPLY || echo 'dry run (nothing will change)')"
echo

# The trash container document holds no fields and is skipped by the filter
# below, since it has no chainName to remove.
DOCS="$(curl -sS -H "Authorization: Bearer ${TOKEN}" "${BASE}/${COLLECTION}?pageSize=300")"

if echo "$DOCS" | grep -q '"error"'; then
  echo "$DOCS" >&2
  exit 1
fi

# One line per document that still carries at least one dead field:
#   <document name><TAB><comma-separated dead fields present>
NAMES="$(printf '%s' "$DOCS" | FIELDS="${FIELDS[*]}" python3 -c '
import json, os, sys
wanted = os.environ["FIELDS"].split()
payload = json.load(sys.stdin)
for document in payload.get("documents", []):
    present = [f for f in wanted if f in document.get("fields", {})]
    if present:
        print(document["name"] + "\t" + ",".join(present))
')"

if [[ -z "$NAMES" ]]; then
  echo "Nothing to do: no document carries any of these fields."
  exit 0
fi

COUNT=0
while IFS=$'\t' read -r NAME PRESENT; do
  [[ -z "$NAME" ]] && continue
  COUNT=$((COUNT + 1))
  SHORT="${NAME##*/}"

  if [[ "$APPLY" != "yes" ]]; then
    echo "would strip [${PRESENT}] from ${COLLECTION}/${SHORT}"
    continue
  fi

  # One updateMask entry per field, with an EMPTY body: that deletes exactly the
  # named fields and leaves every other field on the document untouched. It is
  # also a single write per document rather than one per field.
  MASK=""
  for FIELD in ${PRESENT//,/ }; do
    MASK+="&updateMask.fieldPaths=${FIELD}"
  done

  RESULT="$(curl -sS -X PATCH \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Content-Type: application/json' \
    --data '{}' \
    "https://firestore.googleapis.com/v1/${NAME}?${MASK#&}")"

  if echo "$RESULT" | grep -q '"error"'; then
    echo "FAILED ${COLLECTION}/${SHORT}" >&2
    echo "$RESULT" >&2
    exit 1
  fi

  # Re-read what came back rather than trusting the 200.
  LEFT="$(printf '%s' "$RESULT" | FIELDS="${FIELDS[*]}" python3 -c '
import json, os, sys
wanted = os.environ["FIELDS"].split()
still = [f for f in wanted if f in json.load(sys.stdin).get("fields", {})]
print("STILL PRESENT: " + ",".join(still) if still else "gone")
')"
  echo "stripped [${PRESENT}] from ${COLLECTION}/${SHORT} -> ${LEFT}"
done <<< "$NAMES"

echo
echo "${COUNT} document(s) $([[ "$APPLY" == yes ]] && echo 'updated' || echo 'would be updated')."

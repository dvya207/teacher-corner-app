#!/usr/bin/env bash
#
# Replaces the PROVISIONAL vocabulary in src/app/data/learning-unit-taxonomy.ts
# with the real documents from ThinkTac production's `Configuration` collection.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY THIS EXISTS. The Add-a-Learning-Unit form derives a unit's whole
# categorisation from the two letters of its code: 'AE04' means domain A,
# sub-domain E, and the matching taxonomy row supplies the subject, the names and
# the composite code. That makes the taxonomy a lookup table the feature cannot
# work without — and production keeps it in Firestore, not in source:
#
#   Configuration/learningUnitDomains  → `domains`      (subjectCode, subjectName,
#                                                        domainCode, domainName,
#                                                        subDomainCode, subdomainName)
#   Configuration/subjectTypes         → `subjectTypes` ({ code, name })
#   Configuration/LearningUnitTypes    → `Types`        ({ code, name })
#
# The taxonomy file was seeded by hand because this machine has no credentials for
# the production project. The letter PAIRS in it are real — every one is taken
# from a learning unit that exists in production — but the NAMES are inferred from
# the units carrying each pair. Run this to replace the inference with the source
# of truth.
#
# WHAT IT DOES NOT DO. It does not write to any database. It reads three
# documents and rewrites one local TypeScript file. Nothing is deployed, nothing
# is committed.
#
# ─────────────────────────────────────────────────────────────────────────────
# CREDENTIALS
#
# fbadmin.js resolves Application Default Credentials in this order:
#   1. $GOOGLE_APPLICATION_CREDENTIALS — path to a service-account JSON
#   2. keyring: secret-tool lookup service firebase type sa-keyfile
#   3. gcloud auth application-default login
#
# The account needs Firestore READ on thinktac-india-production. As of writing,
# `firebase projects:list` on this machine sees only helix-staging-india, so one
# of the three above has to be set up first — which is a person's job, not a
# script's.
#
# USAGE
#   ./scripts/import-lu-taxonomy.sh              # dry run: prints what it found
#   ./scripts/import-lu-taxonomy.sh --apply      # rewrites the taxonomy file
#
set -euo pipefail

PROJECT="${FIREBASE_PROJECT:-thinktac-india-production}"
FBADMIN="${FBADMIN:-$HOME/.claude/scripts/firebase/fbadmin.js}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$REPO_ROOT/src/app/data/learning-unit-taxonomy.ts"

APPLY=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    -h|--help) sed -n '2,48p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [[ ! -f "$FBADMIN" ]]; then
  echo "fbadmin.js not found at $FBADMIN" >&2
  echo "Set FBADMIN=/path/to/fbadmin.js or see ~/.claude/scripts/firebase/README.md" >&2
  exit 1
fi

if [[ ! -f "$TARGET" ]]; then
  echo "Taxonomy file not found at $TARGET" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fetch() {
  local path="$1" out="$2"

  echo "  reading Configuration/$path …" >&2

  if ! FIREBASE_PROJECT="$PROJECT" node "$FBADMIN" firestore:get "Configuration/$path" > "$out" 2>"$WORK/err"; then
    echo >&2
    echo "FAILED to read Configuration/$path from $PROJECT." >&2
    sed 's/^/    /' "$WORK/err" >&2
    echo >&2
    echo "This is almost always missing credentials. See the CREDENTIALS section" >&2
    echo "at the top of this script." >&2
    exit 1
  fi
}

echo "Reading the taxonomy from $PROJECT" >&2
fetch "learningUnitDomains" "$WORK/domains.json"
fetch "subjectTypes"        "$WORK/subjects.json"
fetch "LearningUnitTypes"   "$WORK/types.json"

# The rewrite itself is JavaScript: it has to reshape three differently-shaped
# documents (an array or a map of rows, a map of {code,name}, a map of
# {code,name}) into the three constants the file declares, and doing that in
# shell would be an exercise in jq masochism.
node - "$WORK" "$TARGET" "$APPLY" <<'NODE'
const fs = require('fs');
const [work, target, applyFlag] = process.argv.slice(2);
const apply = applyFlag === '1';

const read = name => JSON.parse(fs.readFileSync(`${work}/${name}.json`, 'utf8'));

/** fbadmin prints the document, sometimes wrapped in { data: … }. Accept both. */
const unwrap = doc => (doc && typeof doc === 'object' && doc.data ? doc.data : doc);

/** Firestore maps and arrays both reach here; Object.values normalises them. */
const rows = value => (Array.isArray(value) ? value : Object.values(value ?? {}));

const domainsDoc = unwrap(read('domains'));
const subjectsDoc = unwrap(read('subjects'));
const typesDoc = unwrap(read('types'));

// Production spells this field `subdomainName` — lower d — in the domains
// document while storing it as `subDomainName` on the learning unit itself. Both
// are accepted here so the import does not depend on which one a given
// deployment holds.
const taxonomy = rows(domainsDoc.domains)
  .map(row => ({
    subjectCode: String(row.subjectCode ?? '').trim(),
    subjectName: String(row.subjectName ?? '').trim(),
    domainCode: String(row.domainCode ?? '').trim().toUpperCase(),
    domainName: String(row.domainName ?? '').trim(),
    subDomainCode: String(row.subDomainCode ?? '').trim().toUpperCase(),
    subDomainName: String(row.subdomainName ?? row.subDomainName ?? '').trim()
  }))
  .filter(row => row.domainCode && row.subDomainCode)
  .sort((a, b) =>
    a.domainCode.localeCompare(b.domainCode) ||
    a.subDomainCode.localeCompare(b.subDomainCode)
  );

const types = rows(typesDoc.Types)
  .map(type => ({ name: String(type.name ?? '').trim(), code: String(type.code ?? '').trim() }))
  .filter(type => type.name)
  .sort((a, b) => a.name.localeCompare(b.name));

const subjects = rows(subjectsDoc.subjectTypes)
  .map(subject => ({ code: String(subject.code ?? '').trim(), name: String(subject.name ?? '').trim() }))
  .filter(subject => subject.code || subject.name);

console.error('');
console.error(`  taxonomy rows : ${taxonomy.length}`);
console.error(`  unit types    : ${types.length}  (${types.map(t => `${t.name}/${t.code}`).join(', ')})`);
console.error(`  subject types : ${subjects.length}  (${subjects.map(s => `${s.code}=${s.name}`).join(', ')})`);
console.error('');

if (taxonomy.length === 0 || types.length === 0) {
  console.error('Refusing to rewrite: one of the documents came back empty.');
  process.exit(1);
}

const pad = (value, width) => `'${value}',`.padEnd(width + 3);

const taxonomyLiteral = taxonomy
  .map(row =>
    '  { ' +
    `subjectCode: ${pad(row.subjectCode, 4)} ` +
    `subjectName: ${pad(row.subjectName, 16)} ` +
    `domainCode: ${pad(row.domainCode, 1)} ` +
    `domainName: ${pad(row.domainName, 18)} ` +
    `subDomainCode: ${pad(row.subDomainCode, 1)} ` +
    `subDomainName: '${row.subDomainName}' }`
  )
  .join(',\n');

const typesLiteral = types
  .map(type => `  { name: '${type.name}', code: '${type.code}' }`)
  .join(',\n');

let source = fs.readFileSync(target, 'utf8');

const replaceBlock = (label, declaration, body) => {
  const pattern = new RegExp(
    `(${declaration.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} = \\[)[\\s\\S]*?(\\n\\] as const;)`
  );

  if (!pattern.test(source)) {
    console.error(`Could not find the ${label} block to replace.`);
    process.exit(1);
  }

  source = source.replace(pattern, `$1\n${body}$2`);
};

replaceBlock(
  'taxonomy',
  'export const LEARNING_UNIT_TAXONOMY: readonly TaxonomyRow[]',
  taxonomyLiteral
);

replaceBlock(
  'types',
  'export const LEARNING_UNIT_TYPES: readonly { name: string; code: string }[]',
  typesLiteral
);

// The header warns that the data is inferred. Once it is not, that warning is
// the misleading part.
source = source.replace(
  /^ \* PROVISIONAL DATA — READ THIS BEFORE TRUSTING THE NAMES$/m,
  ' * IMPORTED DATA — read back from production Configuration'
);
source = source.replace(/^\/\*\* PROVISIONAL — see the file header\. .*$/m, '/** Imported from Configuration/learningUnitDomains. */');
source = source.replace(/^ \* PROVISIONAL, as above\. /m, ' * Imported from Configuration/LearningUnitTypes. ');

if (!apply) {
  console.error('Dry run — nothing written. Re-run with --apply to rewrite:');
  console.error(`  ${target}`);
  process.exit(0);
}

fs.writeFileSync(target, source);
console.error(`Rewrote ${target}`);
console.error('Now run:  npm run lint && npx ng test --watch=false');
NODE

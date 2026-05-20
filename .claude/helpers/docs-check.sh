#!/usr/bin/env bash
# Stop hook: verify user-facing src changes are accompanied by doc updates.
# Reads no stdin payload (Stop hook); inspects working-tree diff vs HEAD.
# Emits JSON {"decision":"block","reason":"..."} when source changed without
# matching doc updates, otherwise exits silently. Refers to BP-009.

set -u

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# Skip if not a git repo or no commits yet.
git rev-parse --verify HEAD >/dev/null 2>&1 || exit 0

CHANGED=$(git diff HEAD --name-only 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null)
[ -z "$CHANGED" ] && exit 0

# Source files we consider potentially user-facing. Exclude tests and internal-only paths.
SRC=$(printf '%s\n' "$CHANGED" | grep -E '^packages/[^/]+/src/' | grep -vE '(/__tests__/|\.test\.|\.spec\.|/internal/)' || true)

# Doc surfaces that satisfy BP-009 / BP-022 ("document user-facing changes in the same change set").
DOCS=$(printf '%s\n' "$CHANGED" | grep -E '^(apps/docs/|packages/[^/]+/README\.md$|\.changeset/[^/]+\.md$)' | grep -vE '^\.changeset/(README\.md|config\.json)$' || true)

if [ -n "$SRC" ] && [ -z "$DOCS" ]; then
  REASON="BP-009 / BP-022 docs check: source files changed without matching doc or release-note updates.

Changed src files:
$SRC

No edits to apps/docs/**, packages/*/README.md, or .changeset/*.md in this working tree.

Before declaring this task done, decide:
- If the change is user-facing (new/changed public API, capability, block, CLI command, hook, env var, config key, or behavior end users observe) → write a changeset (\`pnpm changeset\`) and update the relevant packages/*/README.md and any apps/docs/** pages users reference.
- If purely internal (refactor, bug fix without API change, test-only, internal helper) → confirm that explicitly in your reply, no docs or changeset needed (or commit an empty fragment via \`pnpm changeset --empty\`).

Do not silently stop without addressing this."

  # Emit JSON; jq if available for safe escaping, fallback to inline escape.
  if command -v jq >/dev/null 2>&1; then
    jq -nc --arg r "$REASON" '{decision:"block", reason:$r}'
  else
    ESC=$(printf '%s' "$REASON" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
    printf '{"decision":"block","reason":%s}\n' "$ESC"
  fi
fi

exit 0

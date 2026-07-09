#!/usr/bin/env bash
# Stop hook (optional advisory): flag src changes that may need BP-009 / BP-022 follow-up.
#
# Default: emit ONE non-blocking reminder (additionalContext) per distinct set of
# undocumented src changes, then stay silent so the agent is never trapped. The
# "already advised" state is a per-worktree marker file keyed to the changed-src set,
# so it does not depend on Stop-hook continuation internals (e.g. stop_hook_active).
# Adding a new undocumented src file re-triggers the reminder; declining the same set
# does not.
#
# Set FSD_DOCS_CHECK_STRICT=1 to restore hard blocking (decision:block) for CI or
# local enforcement.

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

# Per-worktree marker recording the src set we have already advised on.
GITDIR=$(git rev-parse --git-dir 2>/dev/null || echo ".git")
MARKER="$GITDIR/fsd-docs-check-advised"

# Nothing to flag (or docs already present): clear any stale marker and exit.
if [ -z "$SRC" ] || [ -n "$DOCS" ]; then
  rm -f "$MARKER" 2>/dev/null
  exit 0
fi

ADVISORY="BP-009 / BP-022 (optional): packages/*/src changed without doc or changeset updates in this working tree.

Changed src files:
$SRC

Consider whether the change is user-facing (public API, CLI, hooks, env vars, config, or observable behavior). If yes → update packages/*/README.md and/or apps/docs/** and add a changeset (\`pnpm changeset\`). If internal-only → say so in your reply; no docs or changeset required.

This reminder is advisory — you may finish the task after addressing or explicitly declining."

if [ "${FSD_DOCS_CHECK_STRICT:-}" = "1" ]; then
  REASON="$ADVISORY

Strict mode (FSD_DOCS_CHECK_STRICT=1) is on: a verbal reply does not clear this check. Add a doc/README update, or a changeset (\`pnpm changeset\`, or \`pnpm changeset --empty\` for internal-only changes), before stopping."

  if command -v jq >/dev/null 2>&1; then
    jq -nc --arg r "$REASON" '{decision:"block", reason:$r}'
  else
    ESC=$(printf '%s' "$REASON" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
    printf '{"decision":"block","reason":%s}\n' "$ESC"
  fi
  exit 0
fi

# Default: advise once per distinct src set, then stay silent. Marker holds the hash
# of the src set we last advised on; a matching marker means we have already nudged.
SRC_HASH=$(printf '%s' "$SRC" | cksum | awk '{print $1}')
if [ -f "$MARKER" ] && [ "$(cat "$MARKER" 2>/dev/null)" = "$SRC_HASH" ]; then
  exit 0
fi
printf '%s' "$SRC_HASH" >"$MARKER" 2>/dev/null || true

# One soft continuation with guidance, not a hard requirement loop.
if command -v jq >/dev/null 2>&1; then
  jq -nc --arg c "$ADVISORY" \
    '{hookSpecificOutput:{hookEventName:"Stop",additionalContext:$c}}'
else
  ESC=$(printf '%s' "$ADVISORY" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
  printf '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":%s}}\n' "$ESC"
fi

exit 0

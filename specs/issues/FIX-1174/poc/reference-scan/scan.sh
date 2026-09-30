#!/usr/bin/env bash
# FIX-1174 reference scan — retained spec evidence, not production code.
#
# Re-derives the spec's factual base: which tracked files still name the
# `claude --remote` path of @flow-state-dev/claude-code. Scans EVERY tracked
# file (git ls-files), so a mention nobody listed still surfaces.
#
#   bash specs/issues/FIX-1174/poc/reference-scan/scan.sh           # scan
#   bash specs/issues/FIX-1174/poc/reference-scan/scan.sh --control # plant a hit, expect FAIL
#
# Exit 0: no mention outside history (CHANGELOGs, archived changesets, specs/,
# .changeset/ fragments). Exit 1: at least one live mention, listed.
# On today's main it must exit 1 (the code, README and docs still carry the path);
# after the implementation PR it must exit 0.
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

# Every public name the remote path exports, the session-state key, the handle
# source string, the subpath import, and the phrases the docs use for it.
PATTERN='claudeRemoteDispatch|claudeRemoteTasks|CLAUDE_REMOTE_TASKS_KEY|ClaudeRemoteDispatchOptions|createClaudeCliCapability|CreateClaudeCliCapabilityOptions|scriptPtyClaudeCliExec|resolvePtyClaudeCli|parseRemoteDispatchOutput|ParsedRemoteDispatch|CLAUDE_CLI_REMOTE_SOURCE|claudeRemoteHandleSchema|ClaudeRemoteHandle|ClaudeCliNotFoundError|ClaudeRemoteDispatchError|claude-code/cli-remote|claude --remote|tools/claude-code-cli|[Rr]emote dispatch'

# History is allowed to remember the path. Everything else is live.
is_history() {
  case "$1" in
    */CHANGELOG.md|CHANGELOG.md) return 0 ;;
    docs/internal/archive/*) return 0 ;;
    specs/*) return 0 ;;
    .changeset/*) return 0 ;;
    # The one sanctioned live mention: the redirect that keeps the old URL alive.
    apps/docs/docusaurus.config.ts) return 0 ;;
  esac
  return 1
}

files=$(git ls-files)
if [[ "${1:-}" == "--control" ]]; then
  planted="packages/core/src/__fix1174_control__.ts"
  echo 'import { claudeRemoteDispatch } from "@flow-state-dev/claude-code/cli";' > "$planted"
  trap 'rm -f "$planted"' EXIT
  files=$(printf '%s\n%s\n' "$files" "$planted")
fi

total=0; live=0; history=0; out=""
while IFS= read -r f; do
  [[ -f "$f" ]] || continue
  total=$((total + 1))
  hits=$(grep -nIE "$PATTERN" "$f" 2>/dev/null || true)
  [[ -z "$hits" ]] && continue
  if is_history "$f"; then history=$((history + 1)); else
    live=$((live + 1)); out+="$f"$'\n'"$(sed 's/^/    /' <<<"$hits")"$'\n'
  fi
done <<<"$files"

echo "scanned $total tracked files · $history history files mention the path (allowed) · $live live files"
if (( live > 0 )); then printf '%s' "$out"; echo "FAIL: live mentions remain"; exit 1; fi
echo "PASS: no live mention of the remote path"

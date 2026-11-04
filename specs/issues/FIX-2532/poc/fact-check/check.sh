#!/usr/bin/env bash
# Re-derives the counted facts SPEC.md and D3 rest on: the field lookups done by filtering a
# loaded task ledger, and the one hand-built index. Totality: every chained
# `list(...).find|filter|some` in workforce/orchestration sources is counted per file, across
# lines (a call split over several lines counts), and the per-file counts must equal D3's table.
# It proves the inventory, not that any site could move to findBy as a drop-in.
# Negative control: FACT_CHECK_PLANT=1 adds a multiline site to a listed file and must FAIL.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
scan_dir="$root/packages"
if [ "${FACT_CHECK_PLANT:-}" = 1 ]; then
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  cp -r "$root/packages/workforce" "$root/packages/orchestration" "$tmp/"
  printf 'const x = ledger\n  .list()\n  .find((t) => t.run?.requestId === id);\n' >> "$tmp/workforce/src/conversation-board/steer.ts"
  scan_dir="$tmp"
fi
want=$(sort <<'LIST'
orchestration/src/skills/steer-context.ts:1
orchestration/src/skills/task-tools-capability.ts:2
orchestration/src/tasks/helpers/wait-on-task.ts:1
workforce/src/conversation-board/held-task.ts:2
workforce/src/conversation-board/routed-session.ts:1
workforce/src/conversation-board/steer.ts:2
workforce/src/conversation-board/task-admission.ts:2
LIST
)
found=$(cd "$scan_dir" && rg -U -o -c --type ts -g '!*.test.ts' -g '!**/__tests__/**' \
  '\.list\([^)]*\)\s*(as [A-Za-z\[\]]+\)?)?\s*\.(find|filter|some)\(' workforce/src orchestration/src | sort)
if [ "$found" != "$want" ]; then
  echo "FAIL: scan sites differ from D3's inventory"; diff <(echo "$want") <(echo "$found") || true; exit 1
fi
[ -f "$root/packages/orchestration/src/tasks/collection/id-index.ts" ] || { echo "FAIL: id-index.ts missing"; exit 1; }
grep -q '__ids' "$root/packages/orchestration/src/tasks/collection/id-index.ts" || { echo "FAIL: __ids key not found"; exit 1; }
echo "PASS: eleven scan sites in seven files, one hand-built __ids index"

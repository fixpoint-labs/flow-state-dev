#!/usr/bin/env bash
# Re-derives the counted facts SPEC.md rests on: the field lookups done by scanning a task
# ledger, and the one hand-built index. Totality: every `list(...).find|filter` over a task
# ledger in packages/*/src must be one of the four sites the spec names; any other fails.
# Negative control: FACT_CHECK_PLANT=1 plants an unlisted site in a temp copy and must FAIL.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
scan_dir="$root/packages"
if [ "${FACT_CHECK_PLANT:-}" = 1 ]; then
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  cp -r "$root/packages/workforce" "$root/packages/orchestration" "$tmp/"
  echo 'const x = ledger.list().find((t) => t.run?.requestId === id);' > "$tmp/workforce/src/planted.ts"
  scan_dir="$tmp"
fi
expected=(
  "workforce/src/conversation-board/held-task.ts"
  "workforce/src/conversation-board/steer.ts"
  "workforce/src/conversation-board/task-admission.ts"
  "orchestration/src/tasks/helpers/wait-on-task.ts"
)
found=$(grep -rlE '(ledger|ref|collection)\??\.list\([^)]*\)\.(find|filter)\(' "$scan_dir"/workforce/src "$scan_dir"/orchestration/src --include=*.ts \
  | sed -E "s|^$scan_dir/||" | sort)
want=$(printf '%s\n' "${expected[@]}" | sort)
if [ "$found" != "$want" ]; then
  echo "FAIL: scan sites differ from the spec's four"; diff <(echo "$want") <(echo "$found") || true; exit 1
fi
[ -f "$root/packages/orchestration/src/tasks/collection/id-index.ts" ] || { echo "FAIL: id-index.ts missing"; exit 1; }
grep -q '__ids' "$root/packages/orchestration/src/tasks/collection/id-index.ts" || { echo "FAIL: __ids key not found"; exit 1; }
echo "PASS: four scan sites, one hand-built __ids index"

#!/usr/bin/env bash
# eval.sh <label> <slug>   — runs the four blind checks on blind/<label>-<slug>.md
set -u
S=/tmp/claude-0/-home-user-flow-state-dev/5f124f94-c1af-571f-8b2a-38d6390fd212/scratchpad
L="$1"; SLUG="$2"; ID="$L-$SLUG"
PAGE="$S/blind/$ID.md"
R="$S/results"; mkdir -p "$R" "$S/empty-$ID"

# 1. fact check (repo access, no arm A, read-only)
( { cat "$S/prompts/factcheck.md" "$PAGE"; echo; echo "=== PAGE END ==="; } | \
  bash "$S/run.sh" "$S/sandbox-eval" "$R/$ID.fact.txt" --disallowedTools "Write Edit NotebookEdit" ) &

# 2. cold read (no tools, empty dir), then a blind grader that sees only key + answers
( cd "$S/empty-$ID" && { cat "$S/prompts/coldread-head.md" "$PAGE"; echo; cat "$S/eval/q-$SLUG.md"; } | \
    claude -p --tools "" > "$R/$ID.cold.txt" 2>/dev/null
  { cat "$S/prompts/grade-head.md" "$S/eval/key-common.md" "$S/eval/key-$SLUG.md"; echo; echo "=== ANSWERS ==="; cat "$R/$ID.cold.txt"; } | \
    claude -p --tools "" > "$R/$ID.grade.txt" 2>/dev/null ) &

# 3. docs-editor verdict (fresh, read-only)
( cd "$S/sandbox-eval" && { echo "Review the page below, one draft page for the new docs, given inline between the markers (cite line numbers within it). Its figures are not included; read each figure's italic description line instead. Return your standard VERDICT / FINDINGS / SUSPECTED INACCURACIES report, and as the very last line exactly: EDITOR verdict=<SHIP|REVISE> findings=<number of FINDINGS>"; echo "=== PAGE START ==="; cat -n "$PAGE"; echo "=== PAGE END ==="; } | \
  claude -p --agent docs-editor --permission-mode default --allowedTools "Read Grep Glob" > "$R/$ID.editor.txt" 2>/dev/null ) &

# 4. mechanical check
( cd "$S/sandbox" && node scripts/check-docs-page.mjs "$PAGE" > "$R/$ID.check.txt" 2>&1; echo "exit $?" >> "$R/$ID.check.txt" ) &
wait
echo "done $ID"

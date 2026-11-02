# Checker · every screen that reads a task board

Retained design evidence for FIX-2429, not production code. Throwaway.

**Question.** The spec says five views read a task board for a screen and all five move behind
board notices. Is that the whole list?

**Run** (from the repository root, no install needed):

```bash
node specs/issues/FIX-2429/poc/board-views/check.mjs
FIX2429_CONTROL=plant node specs/issues/FIX-2429/poc/board-views/check.mjs   # must exit 1
```

**What it does.** Scans every non-test source file under `packages/*/src`, `labs/*/src` and
`apps/*` for the board read (`listTasks_tasks`, its constants, Shift Manager's reader, the live
board driver). Every match must be classified as a view that moves, a shared reader or the
server's declaration, and every classified file must still match.

**Result, 2026-11-01** (`main` at 79c3134): 1,646 files scanned, 8 read a board, 5 are views
that move. The control plants an unclassified reader and exits 1.

**Limit.** It finds a board view by the read it calls. A view that reads the ledger as a plain
resource collection (`BoardColumns`) is not a board-read caller, and FIX-1506 gives it a notice.

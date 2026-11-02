# Checker · every timer in Shift Manager and the two labs

Retained design evidence for FIX-2466, not production code. Throwaway.

**Question.** The spec says twelve views in Shift Manager, the Teammates lab and the
claude-code-style lab read on a timer and move behind notices, and that every other timer in
those apps is a board view (FIX-2429's), a wait on one request (FIX-2455's), or reads nothing.
Is that the whole list?

**Run** (from the repository root, no install needed):

```bash
node specs/issues/FIX-2466/poc/app-polls/check.mjs
FIX2466_CONTROL=plant node specs/issues/FIX-2466/poc/app-polls/check.mjs   # must exit 1
```

**What it does.** Scans every non-test source file under `packages/shift-manager/src`,
`labs/teammates/src` and `labs/claude-code-style/src`. A site is a timer call
(`setTimeout`, `setInterval`, `requestAnimationFrame`) or a call of a lab's read-again helper
(`poll(` in Teammates, `every(` in claude-code-style). Each site belongs to the nearest lab verb
or function declaration above it. Every owner must be classified, and every classified owner must
still be found.

**Result, 2026-11-02** (`main` at 9fd46b6): 161 files scanned, 36 sites under 32 owners: 12 views
that move, 4 board views (FIX-2429), 4 waits on one request, 10 timers that read nothing, and the
2 labs' helpers. The control plants an unclassified owner and exits 1.

**What it found that wasn't known.** Shift Manager's task view re-reads its conversation's board
every 2 s, up to 30 times, until the task's run is linked (`task.tsx`). It reads the board
through the lab reader's `readBoard`, not `listTasks_tasks`, so FIX-2429's checker, which
matched the read by name, did not list it. This spec takes it ([decided, not asked](../../DECISIONS.md#decided-not-asked)).

**Limit.** It finds a read on a timer. A view that reads only once, or only when the user acts,
has no timer and is not listed; Shift Manager's snapshot is one, read again on the user's own
actions.

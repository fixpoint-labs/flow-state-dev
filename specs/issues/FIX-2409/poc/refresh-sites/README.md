# Checker · every place Shift Manager reads its snapshot, and every action it runs

Retained design evidence for FIX-2409, not production code. Throwaway.

**Question.** The spec says three views nudge the snapshot when they see another session's
change, and that every other read of the snapshot is the boot read, the lapsed retry, the user's
own action, or a Retry. It also says the actions Shift Manager runs on each snapshot read write
requests only on its own reading and usage sessions. Is that the whole list?

**Run** (from the repository root, no install needed):

```bash
node specs/issues/FIX-2409/poc/refresh-sites/check.mjs
FIX2409_CONTROL=plant node specs/issues/FIX-2409/poc/refresh-sites/check.mjs   # must exit 1
```

**What it does.** Scans every non-test source file under `packages/shift-manager/src`. A refresh
site is a call `refresh()` or a prop `={refresh}`. An action site is a call `runAction(`. Each
site is keyed by file and line text. Every key found must be classified, and every classified key
must still be found.

**Result, 2026-11-04** (`main` at 5eaaa9f6): 104 files, 25 refresh sites: 22 keep (boot, lapsed
retry, the user's own action, Retry) and 3 go (`TasksPanel`, `TaskBoardMeta`, the task screen's
`suspended` nudge). 7 action sites: 3 on reading sessions and 1 on the usage session (Schedules
and Usage run theirs on every snapshot read), 3 on a conversation's session (`listDelegates` once
per Delegates panel open; add and remove are the user's own). The plant control exits 1.

**What it found that wasn't known.** `listDelegates` is an action, so opening the Delegates panel
writes a request on the conversation's session, a topic the snapshot hears. It costs one snapshot
read per open, not a loop. Schedules and Usage write on Shift Manager's own sessions on every
snapshot read; if the snapshot heard those sessions, each read would start the next.

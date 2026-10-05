# mailbox-setup › it wakes a worker hired and subscribed at run time

**Issue:** FIX-1779 (VG, with VD1 and VD2, of the spec's PLAN)

**Outcome:** A coordinator gets work to the right workers while the app runs. It hires a worker, sets up a mailbox with it and a task list, files a task there, puts the hire on a mailbox a file declared and takes that mailbox's member off. The hire hears every post on both mailboxes, the member taken off hears none, and all of it, the task included, is still there after a restart. No file is written.

**Input:** `fixtures/workforce/`: one team, a coordinator (`ops.lead`, on the built-in `agent` kind, naming `hire`, `setUpMailbox`, `subscribeWorkers`, `unsubscribeWorkers` and `fileTask` in `tools:`), one agent member (`ops.kim`), and one mailbox (`ops.floor`) with that member and a `queue` board. The two workers share no mailbox. `host.mts` is the app: the tree, the published packages, a SQLite file, `wakeMemberSeats` over the registry, and hires reloaded at boot. Held-out: the hire's name and the new mailbox's name are fresh every run, so no file names them, and the coordinator, the member, the team and the board are read off the tree.

**Signal:** one host over one SQLite file. The coordinator's own `run` turns call the tools; posts go through the mailbox's public `post`. Everything graded is read from the store after the run: each worker's conversations through the host's own routes, the lists through the mailbox's `readBoard`, and `discover` over the inventory rows.

- **woken**: the hire heard each of four posts in exactly one turn: on the new mailbox and on `ops.floor`, before and after the restart.
- **removed**: `ops.kim` heard the post on `ops.floor` before it was taken off, and none of the four after.
- **task**: after the restart, the new mailbox's `tasks` list holds the task, for the hire, with `filingWorker` the coordinator.
- **works**: after the restart, a task for the hire lands on `ops.floor`'s board, and one for `ops.kim` is refused, filing nothing.
- **discover**: `discover` lists the new mailbox with the hire among its members.
- **tree**: `git status` is as it was before the run, no file under the goal changed, and no file names the hire or the new mailbox.

**Anti-game:** no assertion on a tool's return value; a refusal only counts with the list read back empty of it. No worker is passed in a boot list after the hire; the hire's only way back after the restart is the roster reload any durable host runs. The restart does not set anything up again. No board name for the new mailbox is in any file. The wait before grading polls until every request has settled, then gives a wrongly woken worker 0.5s to run; none of it is graded.

**Model:** n/a. Every agent answers from a scripted model (`@flow-state-dev/testing`), keyless. The goal is what exists and who wakes, not what a model chooses.

**Run:** `pnpm --dir goals exec tsx mailbox-setup/it-wakes-a-worker-hired-and-subscribed-at-run-time/run.mts`

**Controls:** on the same command, applied by the check around the host's wake, never inside the package.

- `GOAL_CONTROL=boot-wake`: the wake reads the workers declared at start, as hosts did before this change. Must FAIL at **woken**, and at nothing else.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-05 | `fix-1779-pr-b` on PR-A `972737eb8`, uncommitted | scripted | FAIL (control) | **`GOAL_CONTROL=boot-wake`, taken first.** Failed at **woken** only: `the hire ops.hire41163651 heard the newBefore post (launch-a-41163651) in 0 turns (want 1)`, and the same for the other three posts. |
| 2026-10-05 | `fix-1779-pr-b` on PR-A `972737eb8`, uncommitted | scripted | **PASS** | First verdict. The hire heard each post once (newBefore=1, floorBefore=1, newAfter=1, floorAfter=1); `ops.kim` heard the post before its removal and none of the 4 after; the task is on the new mailbox's `tasks` list for the hire, `filingWorker ops.lead`; the hire works `ops.floor`'s `queue` and a task for `ops.kim` was refused (`assignee-not-a-list-worker`); `discover` lists the new mailbox with the hire; `git status` unchanged. |

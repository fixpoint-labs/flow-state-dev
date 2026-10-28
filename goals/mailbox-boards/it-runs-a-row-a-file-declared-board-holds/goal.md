# mailbox-boards › it runs a row a file-declared board holds

**Issue:** FIX-1385 (check VG of the spec's Checks table: the goal-altitude proof that a team's work is reachable end to end). Converted by FIX-1792 P2: no file declares a board now, and the mailbox is gone. The folder's name is FIX-1796's to change.

**Outcome:** Someone describes a team in Markdown, worker files only, and the team has a place to keep its work. The worker whose file names `delegates:` files a task for one of them, on its own conversation's board. The board hands it to that delegate, which runs it. Nobody declares a board, nobody writes where the work is kept, nobody wires a collection between the two workers, and nothing is dispatched by hand.

Where the work is kept is never written anywhere. It is the filer's conversation's own board, in the filer's user store, at a partition the server mints when the conversation is created: a file says **who files for whom**, the framework owns **where**.

**Input:** `fixtures/workforce/`: one team `eng`, workers `em` (`flow: em`, `delegates: [eng.coder]`) and `coder` (`flow: coder`). Held out: who files, whom for, and which flow each runs on all come off the tree at runtime; `run.mts` finds the worker whose file names delegates and reads its first delegate rather than naming either.

**What the conversion dropped.** The tree used to hold more than this check read (FIX-1611): a second board nobody drained (`parked`), a third member whose session heard posts (`listener`), and a second mailbox, `notices`, on a kind of its own. They were there for `workforce-conventions/a-mailbox-holds-the-work-a-seat-drains`, which retired in FIX-1792 P4 and took that tree with it. Here, no file declares a board, so `parked` has no subject.

**Signal:** six legs, model-free, over a real `createFlowState` host, its HTTP router with a verified caller, and real user-scoped storage.

(0) **The tree declares no board and never names where the work is kept.** No file under `fixtures/` holds a `boards:`, `boardActions:` or `filing:` line, and none holds the partition the conversation was given. A hit is a failure: if a fixture could name where the work goes, legs (c) to (e) would pass for workers that agreed with a string somebody typed.

(a) **The tree alone produces the roster and the workers' flows.** `readWorkforce` loads clean and `hireWorkforce` hires one copy per worker flow.

(b) **The filer's conversation lists its delegate as taking a task.** Its `listDelegates`, read over HTTP, names `eng.coder` with `takes` of `tasks` (or `both`). The delegate list is the only thing that gives the filer the task tools.

(c) **The filer files one task, through its own conversation.** `createTask_tasks` on its conversation, over HTTP, names the delegate and nothing about a board.

(d) **The board hands it over, and the work really ran.** Proof of execution is a **file on disk** written by the delegate's run, not the board's own report, because the board would report "completed" whatever it actually did.

(e) **The task is completed in the filer's own store.** Read straight out of storage, not through the board: exactly one row in the user's store, `completed`, with the goal and the delegate it was filed for, kept at `tasks/<the conversation's partition>/<id>`, the partition its `listDelegates` reports; and nothing of it at org scope.

**Anti-game:** A hollow pass would hire two workers, file a task, and assert the filing reported success: true even when nothing ran at all. So the check MUST prove execution by a **side effect outside the board** (the outbox file); MUST read the row **out of storage at the conversation's partition**, not merely ask the board; MUST read who files and for whom off the **tree**, so agreeing with a hardcoded string is no route to green; and MUST fail leg 0 if any fixture declares a board or names the partition.

**Model:** n/a, model-free on purpose. Nothing here is a judgment call: a task is filed, a board runs it, a side effect happens or it does not.

**Run:** `pnpm tsx goals/mailbox-boards/it-runs-a-row-a-file-declared-board-holds/run.mts`

**Controls:** each perturbs `run.mts`, never the tree (leg 0 reads the tree, so a fixture edit would die there).
- `GOAL_CONTROL=no-delegates`: the filer's file is read without its `delegates:` line. Must FAIL at **(b)** and **(c)** (*"could not file a task"*, `no_delegation_board`): nothing else grants the task tools. (d) and (e) follow, since nothing was filed.
- `GOAL_CONTROL=hollow-run`: the delegate's run writes nothing outside the board. Must FAIL at **(d)** only (*"the work did not run"*): the board still reports the task completed, which is why (d) reads the outbox and not the board.

## Verdict log

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-27 | FIX-1611 branch on 315976e5f, uncommitted | n/a | PASS | **The tree extended**, for the legs `a-mailbox-holds-the-work-a-seat-drains` moved here. All six legs green: the minted `eng.feature.triage` is in no file (the generated module included), the read listed `["parked","triage"]` against the file's two boards, the `em` seat filed one row, the coder's drain claimed and ran it, the outbox held its goal, and the row read completed under the minted id. The `notices` mailbox opened on its own kind beside it. |
| 2026-09-27 | FIX-1611 branch (control: `by-name`) | n/a | FAIL (expected) | Named **legs (d) and (e)**, not leg 0: *"the work did not run: the outbox holds \"\""* and *"the row is pending, not completed"*, the same two lines as the first verdict. The extension did not move the control. |
| 2026-09-19 | fix/FIX-1385-mailbox-boards (pre-PR) | n/a | PASS | A tree declaring `boards: [triage]` on `eng/mailboxes/feature` produced a mailbox kind holding one board. The mailbox's `read` returned `["triage"]`. The `em` seat — no collection, no board, one dispatcher — filed `"wire the triage board end to end"`; the `coder` seat's drain claimed it and the worker body wrote the goal to `/tmp/fsd-goal-mailbox-boards-*/ran.txt`. `readBoard` returned one row, `status: "completed"`, `assignee: "coder"`, `attempts: 1`, and `resourceState.get("org", org_mailbox_boards, "eng.feature.triage/task_…")` found it. No file under `fixtures/` contains the string `eng.feature.triage`. |
| 2026-09-19 | fix/FIX-1385-mailbox-boards (control: `by-name`) | n/a | FAIL (expected) | Named **legs (d) and (e)**, not leg 0: *"the work did not run: the outbox holds \"\""* and *"the row is pending, not completed"*. With the coder seat resolving the board `other.team.triage` — same local name, different mailbox — everything still compiled, every id was still well-formed, and the drain found nothing to claim while the row sat `pending` on the mailbox's own ledger. This is the control that proves legs (d)/(e) grade the **minted identity** rather than the local name, and it is the red state behind BR-9's isolation claim. |
| 2026-10-10 | claude/project-thread-5s0me3 on e0dcef85, the tree converted, the old check | n/a | FAIL (expected) | The mailbox check on the converted tree: *"the tree declared no mailbox holding a board"*. |
| 2026-10-10 | claude/project-thread-5s0me3 on e0dcef85 + uncommitted (this conversion) | n/a | PASS | All six legs. No file declares a board or names the partition. `eng.em`'s conversation listed `eng.coder` as taking `tasks`, filed one task through its own `addTask_tasks`, and the board handed it to `eng.coder`'s task entry, which wrote the goal to the outbox. The task read `completed` out of `u_mailbox_boards`'s store at `tasks/<the conversation's partition>/<id>`; nothing at org scope. |
| 2026-10-10 | same (control: `no-delegates`) | n/a | FAIL (expected) | **(b)** *"lists eng.coder as absent"* and **(c)** *"could not file a task: no_delegation_board"*; (d) and (e) with them (nothing filed, nothing ran). |
| 2026-10-10 | same (control: `hollow-run`) | n/a | FAIL (expected) | **(d)** *"the work did not run: the outbox holds \"\""*, and nothing else: the task still read `completed` at the conversation's partition. |
| 2026-10-11 | FIX-1792 P4 on 617aeabb + uncommitted | n/a | PASS | Re-run after the mailbox code was removed, unchanged. All six legs: no file declares a board or names the partition; `eng.em`'s conversation listed `eng.coder` as taking tasks, filed one task through its own `addTask_tasks`, and `eng.coder`'s task entry wrote the outbox; the task read `completed` in `u_mailbox_boards`'s store at the conversation's partition, nothing at org scope. |

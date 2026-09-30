# task-run-link › it names the run working each task

**Issue:** FIX-1668 (check VG of the spec's Checks table)

**Outcome:** Someone looking at a task on a board can open exactly the run working it, or the run that last worked it, and never another task's run or a guess. Each handed-off row carries `run: { sessionId, requestId, attempt }`, and that link reaches every read a board view uses.

**Input:** `fixtures/workforce/` — one team `lab`, one channel `desk` whose `CHANNEL.md` declares `boards: [work]`, a member `lead` that drains it, and three seats it hands rows to: `coder` (`handoff: per-task`), `reviewer` (`handoff: per-worker`) and `auditor` (`handoff: per-task`, on a flow of its own, `flow: audit`). A seat that names `flow: seat` runs on the drainer's flow. Held out: the channel, the board, the drainer, the seats and their policies all come off the tree. Rename the team, channel or board, or swap which seat is per-worker, and a correct build still passes.

Five rows are filed through the channel's own `fileTask`: one per seat, a second for the per-worker seat, and one on the first per-task seat whose worker fails its first attempt (`maxAttempts: 2`), so it is re-drained.

**Signal:** model-free, over a real `createFlowState` host, real dispatch, real child sessions, and the real HTTP router. The board is drained from conversation A, and re-drained from conversation B once A's runs settle. Every worker writes what it saw from inside its own run (session, request, attempt, a random marker) to a file outside the board. Legs, by name:

- **browser** — the board's browser read (`GET /sessions/:channel/resources/:ledger`) names, for every row, the session and request its worker recorded, and `attempt` equal to the row's `attempts`. No `claimedBy`.
- **model** — the same on the channel's `readBoard`.
- **stream** — each run is opened from its link: the link's session is read for its owning flow (`flowId`), then that request's stream is read through that flow. The last `task-change` item on it names the same run. No `claimedBy`.
- **shared** — the per-worker seat's two rows name one session and two different requests.
- **redrain** — after its failed first attempt the retried row names the failed run; after conversation B re-drains it, it names B's run, not A's.
- **marker** — the cross-flow seat's run, opened through its session's owner, returns the marker its worker emitted.

**Anti-game:** A hollow pass would assert the link is present, or equals the ids the hand-off reported to the drain, or equals `claimedBy`. The first passes with the claiming conversation's coordinate written in; the second is a neighbour of the claim, generated on the path being tested; the third is exactly the defect `stamp-at-claim` models. So the check compares every read against a file each worker wrote from its own context, never against the board's own report. It reads through the browser route and the model action rather than a collection ref, so a field stripped on the way to a reader fails. It opens runs through the session's recorded owner, so a reader that assumed the board's flow fails on the cross-flow seat.

**Model:** n/a — model-free. A row is handed off, a run starts, or it doesn't.

**Run:** `pnpm tsx goals/task-run-link/it-names-the-run-working-each-task/run.mts`

**Controls:** each perturbs `run.mts`, never the tree.
- `GOAL_CONTROL=stamp-at-claim` — the worker overwrites the link with the claiming conversation's coordinate (`claimedBy`). Must FAIL at **browser**/**model** *"session equals the worker's"*.
- `GOAL_CONTROL=server-only` — `run` joins `SERVER_ONLY_TASK_FIELDS` and leaves the browser list. Must FAIL at **browser** *"link present on the browser read"*.
- `GOAL_CONTROL=board-flow` — every run is opened through the drainer's flow instead of its session's owner. Must FAIL at **marker** *"marker read on the cross-flow seat"*, and nothing else.

## Verdict log

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-30 | fix-1668-task-run-link on f1abccf14 | n/a | PASS | Channel `lab.desk`, board `work` (ledger `lab.desk.work`), drained by `lab.lead` from `s_convo_a` and re-drained from `s_convo_b`. 5 rows across `coder:per-task`, `reviewer:per-worker`, `auditor:per-task@audit`, 6 proofs on disk. Every row's link on the browser read, `readBoard` and the last `task-change` of its run's own stream equals its worker's session and request. The reviewer's two rows shared one `dsx_` session over two requests. The retried row moved from A's failed run to B's. The auditor's run opened through its session's `flowId` and returned its marker. |
| 2026-09-30 | same (control: `stamp-at-claim`) | n/a | FAIL (expected) | Named **browser** and **model** *"session equals the worker's"* on all 5 rows (e.g. *"names s_convo_a, its worker ran in dsx_0f5e…"*; the re-drained row names `s_convo_b`), plus request mismatches, **shared** (*"two rows name one request"*: both name the drain's request), **redrain**, and **stream**/**marker**, since the link now opens the drain's request. |
| 2026-09-30 | same (control: `server-only`) | n/a | FAIL (expected) | Named **browser** *"link present on the browser read"* on all 5 rows, and **stream** on all 5 (the change item no longer carries `run`). **model** stayed green: the model list is a separate allowlist the control does not touch. |
| 2026-09-30 | same (control: `board-flow`) | n/a | FAIL (expected) | Named only **marker** *"marker read on the cross-flow seat"*: the auditor's run, opened through `lab.lead`, answered 404. The same-flow seats' runs still opened, because their owner is the drainer's flow. |
| 2026-09-30 | origin/main f1abccf14 (no implementation) | n/a | FAIL (expected) | Before-state: every row *"carries no run"* on **browser**, **model** and **stream**, and **redrain** found no link after the failed attempt. |

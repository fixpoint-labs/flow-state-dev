# hand-offs › it survives a restart and runs once

**Issue:** FIX-1820, the closure of epic FIX-1815. Its spec's goal: `specs/issues/FIX-1820/SPEC.md` → "The goal, and how we'll know it's met"; the epic's: `specs/epics/FIX-1815/SPEC.md`.

**Outcome:** on one `main` commit, with every other child of FIX-1815 merged, a worker can ask a colleague and continue the same turn with its real answer, or assign a task whose own session parks on a question, carries on when answered, and still answers and takes a follow-up once finished. A server restart during either wait loses nothing, and the work runs once.

**Input:** one clean checkout. The runner composes checks it does not own, each run unchanged as its own process, plus one journey of its own:

- **P1.a**, leg a: `goals/hand-offs/ask-survives-a-restart/` (Shift Manager's DevTeam install, SQLite, SIGKILL while the asker waits).
- **P1.b**, leg b: `goals/coordinators/task-session-stays-open/` (its goal-local Lab, SQLite, a task that parks, is answered, asked again, followed up).
- **P1.c**: `goals/coordinators/files-tasks-down-the-owners-chain/`. **P1.d**: `goals/coordinators/hands-each-post-to-its-delegates/` and `goals/coordinators/routes-a-follow-up-by-its-conversation/`. The neighbouring checks on the same board.
- **J4** (`legs/parked.mts`): leg b's Lab and brief, read from leg b's own files, on a fresh SQLite store. Alice files the brief for `desk.ops`; while the task reads `parked`, the server and every process under it get SIGKILL; a new process starts on the same store. Held out, picked at run time: the region (one of leg b's six) and the ticket, which `drawTicket` draws.

**Signal:** P1.a to P1.d: each check's own `goal.md` signals, its plain run PASS. J4, each failure tagged:

- `kill:parked` the task read `parked`, with one `parked` notice, in the store the dead server left. A task that never parks within 120 s, or a store holding no one `drawTicket` output at the kill, is a **setup** failure of that attempt, never a grade: there was no wait, or no draw, to survive.
- `j:answered` after the restart, `answerTask_tasks` answers `{ ok: true }`.
- `j:completed` the task is `completed` within 90 s of the answer.
- `j:same-session` it completed in the session that parked.
- `j:names-ticket` · `j:names-region` its output names the ticket the store held at the kill, and the answered region.
- `j:one-draw` · `j:one-completed` at the end of the run the store holds exactly one `drawTicket` output, and it is the same record (session, item and ticket) the store held at the kill; one `completed` notice.
- `j:second-answer` a second `answerTask_tasks` is declined (`ok: false`), and every task row is byte-for-byte as before it.
- `j:still-answers` the session `findWorkerSession({ worker, taskId, filingSessionId })` returns is the one that parked, and its `run` request ends `completed` and answers "Which ticket did you draw?" with the ticket.
- `j:row-unchanged` after that, the row is still `completed` with the same output.

The runner prints one verdict per check, each with the commit's SHA. It exits non-zero when a plain check fails, or when a control's red tags are not exactly its allowed set (see **Controls**).

**Anti-game:** the runner refuses a dirty tree and re-checks `HEAD` before every check, so no verdict comes from another commit. It writes no row, calls no waker and resumes no request; neither does J4, whose only touches after the restart are Alice's: answer, list the board's tasks every five seconds, answer again, find the task's session and ask it. J4 kills only after the store shows the park, grades the store file read-only, and reads the ticket from `drawTicket`'s own output, so the model can't pass by inventing one. No check is graded on a child's own unit tests.

**Model:** real — openai/gpt-5.4-mini for legs a, b and J4 (through the AI Gateway, `AI_GATEWAY_API_KEY`); P1.c and P1.d run on the models their own `goal.md` names. Blocked, not failed, without a key.

**Run:** `pnpm tsx goals/hand-offs/survives-a-restart-and-runs-once/run.mts` on a clean checkout. J4 alone: `pnpm tsx goals/hand-offs/survives-a-restart-and-runs-once/legs/parked.mts` (`GOAL_ATTEMPTS=<n>`, default 3; 1 under a control). On demand only, never a CI gate.

**Controls:** the runner runs each child's controls with their own `GOAL_CONTROL`. A control passes only when its tags that went red are exactly its must-fail tags plus the co-failures its check documents, nothing else: any other red tag, a setup failure or a throw is a finding (QR-12).

| Control | Must fail | Allowed to go red with it |
|---|---|---|
| P1.a `no-run-once` | `one-row` | `b:once` |
| P1.a `no-waker` | `a:completed` | `a:word` |
| P1.b `new-session` | `a:names-ticket`, `c:names-ticket` | `a:same-session`, `b:names-ticket`, `c:same-session`, `c:one-draw` |
| P1.b `drop-answer` | `a:names-region` | nothing |
| J4 `fresh-store` | `j:answered` | every `j:*` after the answer; never `kill:parked` |

J4's own:

- `GOAL_CONTROL=fresh-store`: the server restarts on a new, empty store file instead of the one the dead server left, as an in-memory store would. No product code changes; the run checks that the restarted server opened the new file. Must fail **`j:answered`** with `kill:parked` green. Everything after the answer goes red with it: there is no task to complete.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-10 | 48c885d12 (`main` b160ea1c1 + this goal) | openai/gpt-5.4-mini (vercel gateway); P1.c and P1.d on their own models | PASS | The runner, every check on one clean commit. P1.a PASS (killed 4488 ms after the ask, while suspended; one turn, one row, one completed run); `no-run-once` FAIL at `one-row` (+`b:once`); `no-waker` FAIL at `a:completed` (+`a:word`). P1.b PASS; `new-session` FAIL at `a:names-ticket`, `c:names-ticket` (+`a:same-session`, `b:names-ticket`, `c:same-session`, `c:one-draw`); `drop-answer` FAIL at `a:names-region` alone. P1.c PASS, P1.d PASS (both). J4 PASS on attempt 1 of 3 (below) |
| 2026-10-10 | 48c885d12 | openai/gpt-5.4-mini (vercel gateway) | PASS (J4) | Killed 3491 ms after the filing, the row `parked` with one notice; after the restart the answer `{ ok: true }`, `completed` 5026 ms later in the session that parked: "Ticket TCK-248965, region sa-east."; one draw, one `completed` notice; the second answer `terminal_task_write_declined`, rows unchanged; the session answered "TCK-248965"; the row still `completed` |
| 2026-10-10 | 48c885d12 | openai/gpt-5.4-mini (vercel gateway) | FAIL (control `fresh-store`, expected) | Killed 2960 ms after the filing with the row `parked` (`kill:parked` green); restarted on a new file, the answer came back `400 Bad Request` (`j:answered`); every later `j:*` red with it, nothing to complete |
| 2026-10-10 | cca7102a6 (`main` d484d3955 + the strict grading and the draw at the kill) | openai/gpt-5.4-mini (vercel gateway); P1.c and P1.d on their own models | PASS | Every check on one clean commit, controls graded on an exact red set. P1.a PASS (killed 4161 ms after the ask, while suspended); `no-run-once` red exactly `one-row`, `b:once`; `no-waker` red exactly `a:completed`, `a:word`. P1.b PASS; `new-session` red exactly its six allowed tags; `drop-answer` red exactly `a:names-region`. P1.c PASS, P1.d PASS (both). J4 PASS on attempt 1 of 3 (below) |
| 2026-10-10 | cca7102a6 | openai/gpt-5.4-mini (vercel gateway) | PASS (J4) | Killed 2992 ms after the filing: the row `parked` with one notice, and the store already held the one draw, `TCK-67868B` (item `item_tool_output_1791667635583_e737…`). After the restart the answer `{ ok: true }`, `completed` 5030 ms later in the session that parked: "Ticket TCK-67868B, region us-east."; the same draw record alone; one `completed` notice; the second answer `terminal_task_write_declined`, rows unchanged; the session's request `completed`, answering "TCK-67868B"; the row still `completed` |
| 2026-10-10 | cca7102a6 | openai/gpt-5.4-mini (vercel gateway) | FAIL (control `fresh-store`, expected) | Killed 3230 ms after the filing, the row `parked` and the draw `TCK-2EED2C` held (`kill:parked` green); restarted on a new file, `400 Bad Request` (`j:answered`); red exactly `j:answered` and the nine `j:*` after it |

# shift-manager › every stop is one Inbox item

**Issue:** FIX-2134, the closure of epic FIX-2058. Its spec's goal: `specs/issues/FIX-2134/SPEC.md` → "The goal, and how we'll know it's met"; the full plan in `DECISIONS.md` → "The plan in full".

**Outcome:** on one `main` commit with every other child merged, a user on Shift Manager with a real model sees every stop that waits on them as exactly one Inbox item, answers each once through its one route, and the work carries on the same attempt, or, for a task held before it starts, starts its first. A cancel closes the item, and a steer never runs beside a waiting request.

**Input:** a goal-local Lab (`lab/fsdev.config.mts`) served by Shift Manager's command over DevTeam's `openLab`, with no durability or store setting of its own. The tree (`cast.mts`) is DevTeam's, copied, plus a desk team: `desk.front` (Alice's conversation, real model), `desk.asker` (asks midway with `holdTaskForUser`), `desk.doer` (a block that stops for an approval, a review or an input), and DevTeam's `eng.coder`, whose coding run asks through its marker. The words each task carries and the coding run's held-out fact are picked at run time (`pickWords`). Model `openai/gpt-6-luna`; the coding run is Claude Code through the devteam harness (`GOAL_HARNESS=stub` swaps in a scripted harness for the controls).

**Signal:** each failure is tagged `<leg>:<assertion>`; the spec's signal table is the contract.

- `a`: six stops wait at once, approval, review and input (suspensions), held-before-start, midway and coding (row holds). `a:six-items` reconciles the Inbox over all six (`reconcileInbox`: no missing, duplicate or orphan item, no drift); `a:no-deadline-waits` keeps all six listed and unresumed past the sweeper's interval and a board touch; `a:rows-read` reads one open suspension hold with its claim on each suspended row, and an open row hold with no lease on each held one.
- `b`: each stop answered once in the Inbox carries on as its kind says, `attempts` never past 1 and work counted once (`b:<stop>-same-attempt`); a second answer is told the stop is resolved (`b:answered-once`). The coding run resumes the same Claude Code session.
- `c`: cancelling a suspended and a held task closes both items, and nothing the resumed block writes is kept (`c:item-closes`); `getTask` on the cancelled held row shows no open hold (`c:held-cancel-closes-questions`).
- `d`: a steer into a task waiting on a review starts no request beside it, and one more turn takes it after the answer (`d:no-request-beside`); a held question is answered only by a steer carrying its id, through `updateTask` or a line typed in the task's session (`d:answer-by-id`); a plain message and a steer naming no question answer nothing (`d:plain-answers-nothing`).
- `j1` *files work* (amended by FIX-2241): the asker's midway question reaches desk.front's conversation as one received message naming the task and the question, and an `onMessageReceived` turn runs there (`j1:filer-hears`); that turn's steer answers it, from the filer, and the task completes on attempt 1 with no line from Alice after the filing (`j1:filer-answers-own`); the Inbox lists the waiting task once (`j1:one-item`); a coding task desk.front's model files for eng.coder asks through its marker, and its question reaches the conversation as one received message from eng.coder (`j1b:coder-heard`); the filer's steer on a question asked at filing is refused and answers nothing (`j1:routed-answers-nothing`).
  - *Not walked here:* FIX-2241's `j1:routed-told`, a task routed to a workstream telling its filer the user answers it. The desk team has no project or workstream to route to; the routed text and its refusal are pinned model-free in `packages/workforce/test/project-coordinator.test.ts` ("tells the conversation that routed it the lead's midway question") and `midway-question-to-filer.test.ts`. The spec's `question-pays` control is likewise model-free there (a spent per-request limit), since the walk never spends a budget.
- `j2` *writes a flow that asks:* on its own host with set deadlines, an approval reads as a no, an input fails its try, a held question goes ahead from its brief, and a user's stop cancels the task (`j2:approval-reads-no`, `j2:input-fails-try`, `j2:held-deadline-goes-ahead`, `j2:stop-cancels-task`).
- `j3` *runs it locally:* the host restarts while six wait; all six are listed once, then each is answered once and carries on the same attempt (`j3:six-after-restart`, `j3:answered-after-restart`).

**Beside the walk** (plan rows 1, 3 and 4):

- *The sweep* (`sweep:no-old-path`): `node goals/workforce-coordination/runs-on-one-task/sweep.mjs` passes; `--control` reports exactly its plants; `--at b8328ccb` (before the epic) fails.
- *Every child's goal and its controls:* FIX-2129 `goals/task-board/holds-a-task-waiting-on-a-person`, FIX-2133 `goals/task-board/waits-on-its-questions` (plus `questions.test.ts` on both store backings), FIX-2131 `goals/task-board/asks-a-person-one-way`, FIX-2132 `goals/shift-manager/a-coding-runs-question-is-answered-in-the-inbox`, FIX-2063 `goals/durable-by-default/a-local-stop-is-held-and-answered` (its control: the goal on pre-FIX-2063 `main`, 7d69c4068). FIX-2137 has no goal; leg b's work counter is its check. None is skipped: the walk covers each kind only together, not each child's own legs.
- *The gap sweep:* each coordination seam in `specs/epics/FIX-2058/DECISIONS.md` read from both sides; the human-in-the-loop guide, the task-board page and the runtime page followed as written; each epic *not done if* state checked absent.

**Not in this goal, and why:**

- *A custom-reason `ctx.suspend()`.* It is documented as not shown in the Inbox, and ER-1's predicate keeps it out; nothing to assert.
- *Today's `main` failing `a:six-items`.* The walk cannot build on a pre-epic commit (the stops it raises don't exist there); the sweep's pre-epic FAIL is the old-main control.
- *A coding run's review* (FIX-2163): FIX-2156's call, outside this epic.

**Anti-game:** Alice reads the Inbox through Shift Manager's pending read and answers through orchestration's Inbox client; rows are read through `getTask` / `listTasks` as Alice; no fixture writes a row. Lease and turn are read from the store only where no public read shows them. `FSDEV_TRACE_OBSERVABILITY=0`, so a step run twice shows as a work counter of 2. A structural failure is a finding on any attempt; only `a:held-filed`, `j1:filer-files` and `j1:filer-calls` (what the model chose to write) may be retried.

**Run:** `pnpm tsx goals/shift-manager/every-stop-is-one-inbox-item/run.mts`, with a key serving `openai/gpt-6-luna` and Claude Code signed in (`ANTHROPIC_API_KEY`). `GOAL_LEGS=a,b,c,d,j1,j2,j3` runs some legs (b answers a's stops). On demand only, never a CI gate.

**Controls:** scratch patches applied as the code under test loads (`goals/lib/module-patch.mts`), in the goal and in every Lab it serves, printed by the run, and refused when they never reached the code. Run with `GOAL_HARNESS=stub`.

- `GOAL_CONTROL=public-resume` (FIX-2129's): the Inbox answers a suspension through the public resume route. Must fail **`b:approval-same-attempt`**.
- `GOAL_CONTROL=new-attempt` (FIX-2132's): an answered coding question starts a new attempt. Must fail **`b:coding-same-attempt`**.
- `GOAL_CONTROL=cancel-keeps-item`: the cancel is written, but neither the suspension nor the row's holds are resolved. Must fail **`c:item-closes`** and **`c:held-cancel-closes-questions`**.
- `GOAL_CONTROL=steer-ignores-mark`: steer admission ignores the row's open hold. Must fail **`d:no-request-beside`**.
- `GOAL_CONTROL=no-question-message` (FIX-2241's): the board's `onMidwayQuestion` hook is gone. Must fail **`j1:filer-hears`** and **`j1b:coder-heard`**.
- `GOAL_CONTROL=default-deadline` (FIX-2129's): a stop with no deadline gets one anyway. Must fail **`a:no-deadline-waits`**.

## Verdict log

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-26 | `main` 31bed8b, uncommitted (stub harness) | stub | PASS; FAIL (each control, as required) | Built before the pin. Each control failed its named tags and nothing else. |
| 2026-10-27 | `main` 31bed8b (run 1) | `openai/gpt-6-luna` + Claude Code | PASS (walk); findings | a to d, j1 to j3 green. The coding run resumed the same Claude Code session (walk 8223587a…, j3 acbcdce6…). Sweep green, `--control` its 33 planted lines, pre-epic FAIL (exit 3). All five controls failed their named tags. Findings: FIX-2221 (runtime docs left out held questions, gap sweep) and FIX-2222 (FIX-2131's goal still asked for `blocked-by-failures`), both fixed in #3945. |
| 2026-10-27 | `main` 0168859 (run 2) | `openai/gpt-6-luna` + Claude Code | PASS (walk); one finding | Every row green again; every child's goal PASS with its controls failing as documented, FIX-2063's on 7d69c4068 failing a, c and d. Finding FIX-2224: FIX-2133's `release-on-first` control refused to apply (its import anchor moved in c67118a3), so it never ran; fixed in #3950. FIX-2133's `duplicate-item`, `drop-row-holds` and `mirror-skips-close`, missed in run 1, failed `a:reconciler`, `a:reconciler`, `e:reconciler`. |
| 2026-10-27 | `main` 83c444b (run 3, carry-forward) | n/a | PASS | #3950 merged; nothing else touching the epic's subject landed after 0168859 (only kitchen-sink's plan panel). Re-graded what changed: FIX-2133's goal PASS, `release-on-first` FAIL on `b:still-held`, as required. Everything else carries forward from run 2. Clean: the epic's goal is met. |
| 2026-10-27 | `main` 83c444b (run 3, goal re-graded) | `openai/gpt-6-luna` + Claude Code | PASS; FAIL (each control, as required) | The goal itself changed after review: j1 now requires the filer's own `updateTask` refused as `question_is_the_users` (refused once), a second answer must get its stop's own refusal (409 for a suspension, `question_answered` for a row hold), j3 stops its Lab on an early return, and unread lines were dropped. Walk PASS twice; all five controls failed their named tags. |
| 2026-10-28 | FIX-2241 branch on #4020 (f417cda + ff52698) | `openai/gpt-6-luna` + Claude Code | j1 PASS 3 of 3; FAIL (control, as required) | j1 amended for FIX-2241. Scripted harness PASS; `no-question-message` failed `j1:filer-hears` and `j1b:coder-heard`, as it must. Only j1 run: the amendment touches no other leg. |

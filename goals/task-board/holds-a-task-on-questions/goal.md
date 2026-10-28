# task-board › it holds a task on questions

**Issue:** FIX-2133 (epic FIX-2058). Its spec's goal: `specs/issues/FIX-2133/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** a task can be held on a person's questions, before it starts or midway. The user sees them as one Inbox item; each answer joins the brief; the last answer, or a deadline the host set passing without one, lets the work go on: a task not yet started starts its first attempt, a midway one takes one more turn on the same attempt. Nothing else releases it, no two turns run at once, and a cancel closes it.

**Input:** a real `createFlowState` host on a durable SQLite store, the Workforce session board on two flows (`desk`, the conversation that files, and `doer`, whose task sessions work), the org's worker inventory opened as a Lab's boot opens it, and deterministic scripted turns that call the real verbs (`askMidway`, `reportProgress`, `waitForUser`), driven as a verified caller. Marks in a task's goal drive its turn: `[ask:N]` asks N questions midway on the first turn, `[late]` then waits on a latch and reports a checkpoint late, `[approve]` waits for an approval, `[ask-then-approve]` asks and then waits for an approval in the same turn. The questions are "Which CSV export should the script read?" and "Which date column?"; any two prompts pass the same way.

**Signal:** each failure is tagged `<leg>:<assertion>`.

- `a` (filed on two questions, t1, with t2 depending on it): one Inbox item for t1 with both prompts, oldest first, listed once; `getTask` shows `pending`, `attempts: 0`; a board touch starts nothing.
- `b` (one answered through the Inbox client): one question left, t1 still not started.
- `c` (the second answered): t1 runs once, attempt 1, its brief holding both answers with their questions; the item is gone; t2 runs once, after t1 completes; t1's answer retried after it completed is a success, other words are refused.
- `d` (asked midway, t4): `in_progress`, no lease, attempt 1; past its lease and a touch, not renewed or reclaimed; the Inbox lists the question and answers it; exactly one more turn on attempt 1 with the answer in its message, and t4 completes; the asking turn's late write, landing after the next turn's claim and before its end, is declined `lost-claim`.
- `dnowake` (leg d with the owed turn's own start in its session skipped): the board's claim takes the turn, on attempt 1.
- `e` (the rules): the same answer twice is a success, a different second answer is refused as answered (answers committed at once, and the 20-place cap, are pinned per backing in `holds.test.ts`); an answer from another user, tenant or org is `task_not_found` and writes nothing; a cancel closes t3's item and a later answer is refused `task_finished`; t6's question with no deadline is still open past a touch well after t5's would fall due; t9's `waitForUser` approval opens one suspension hold, listed once and answered through the engine's route, and the resume closes it; t10's confirm is one item with a yes and a no, and the yes starts it; t12's confirm answered No (its default, `onNo: "cancel"`) cancels it unstarted and closes its item (`e:t12-no-cancels`); t11 asks and then waits for an approval in one turn: the stop is refused, its suspension resumed `{ cancelled: true }`, and t11 is held on its question alone; a line typed in t8's session with two open questions answers the oldest and leaves the other open.
- `edue` (a host with `userDeadlineMs` 1,500 ms, t5): past due and a touch later, t5's question closes "No answer came…" and t5 starts.
- `f` (a host with `userDeadlineMs` 7,777,000 ms): a held question takes the host's deadline as its `due` (FIX-2129 leg f's other half).

Every leg ends with `reconcileInbox` over Shift Manager's own Inbox read against reads made apart from it (the board's `listTasks`, the task sessions' suspended requests): green, drift included, and a hold answered or cancelled is in no later read.

**Anti-game:** the Inbox is Shift Manager's snapshot (`createLabReader().read().inbox`), every answer goes through orchestration's Inbox client (`createInboxClient`) or the board's `updateTask` action as a screen sends it, and the task is read through `getTask` and `listTasks`, never a store write by hand. The turn counter is a proof each scripted turn appends from inside its own run. The lease is shortened to 3 s by a scratch patch (printed by the run): that fakes time, not behaviour.

**Model:** n/a (model-free).

**Run:** `pnpm tsx goals/task-board/holds-a-task-on-questions/run.mts`. `GOAL_LEGS=a,b,c,d,dnowake,e,edue,f` runs some legs (a, b, c run in order). On demand only, never a CI gate. The state and resource backings are each covered by `packages/orchestration/test/collection/holds.test.ts`; the goal's board is the Workforce session board's.

**Controls:** scratch patches to the code under test, applied as it loads (`goals/lib/module-patch.mts`), printed by the run, and refused when they never reached the code.

- `GOAL_CONTROL=release-on-first`: the claim gate lets a row with one open question go. Must fail **`b:still-held`**.
- `GOAL_CONTROL=answer-off-brief`: the worker's brief drops the answers. Must fail **`c:brief`**.
- `GOAL_CONTROL=wake-only`: the claim ignores the owed mark. Must fail **`dnowake:one-more-turn`** (t4 is stranded). Leg d fails too, `d:late-write-refused`: with no claim to take the turn while the asking turn still runs, its late write lands.
- `GOAL_CONTROL=no-turn-fence`: claim tickets fenced by row, status and attempt only. Must fail **`d:late-write-refused`**.
- `GOAL_CONTROL=default-deadline`: a question with no deadline gets one. Must fail **`e:no-deadline`** (t6 closes).
- `GOAL_CONTROL=duplicate-item`, `drop-row-holds`, `mirror-skips-close` (t9's resume leaves its hold open): each must fail its leg's **reconciler**.

Today's `main` fails a: `createTask` has no `questions`, and there is no `askMidway` to import.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-25 | fix/FIX-2133-holds (working tree) | n/a | PASS | Legs a to f. a-c: t1 held on 2 questions, started once on attempt 1 with both answers in its brief, t2 after it. d: t4 held past its lease with no lease, answered, one more turn on attempt 1, the late write declined `lost-claim`. dnowake: the board's claim took the turn. e: retries, a competing answer, the caller check, a cancel, no deadline, t9's mirror, t10's confirm, t11's refused stop resumed cancelled, t8's line. edue: due 1,500 ms on, closed "no answer came" on a touch past it, t5 started. f: 7,777,000 ms taken |
| 2026-10-25 | fix/FIX-2133-holds (working tree) | n/a | FAIL (each control, as required) | `release-on-first`: `b:still-held` (t1 started on its first answer). `answer-off-brief`: `c:brief`. `wake-only`: `dnowake:one-more-turn` (t4 in progress, one turn), and `d:late-write-refused`. `no-turn-fence`: `d:late-write-refused` (recorded). `default-deadline`: `e:no-deadline` (t6 closed "no answer came"). `duplicate-item`: `a:reconciler` (duplicate). `drop-row-holds`: `a:reconciler` (missing). `mirror-skips-close`: `e:reconciler` (drift: no live stop) |
| 2026-10-27 | `main` 0168859 (plain run, every control; `release-on-first` from this change) | n/a | PASS; FAIL (each control, as required) | Plain: legs a to f green. `release-on-first`: `b:still-held` (the patch now uses the `openRowHolds` `internal.ts` already imports; its old import anchor stopped matching after c67118a3, so the control could not run). `answer-off-brief`: `c:brief`. `wake-only`: `dnowake:one-more-turn`. `no-turn-fence`: `d:late-write-refused`. `default-deadline`: `e:no-deadline`. `duplicate-item`: `a:reconciler`. `drop-row-holds`: `a:reconciler`. `mirror-skips-close`: `e:reconciler`. Found by the FIX-2134 closure |

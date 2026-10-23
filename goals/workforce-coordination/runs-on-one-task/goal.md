# workforce-coordination › it runs on one task

**Issue:** FIX-2087, the closure of epic FIX-2056. Its spec's goal: `specs/issues/FIX-2087/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** on one `main` commit with every other child merged, a person using a Workforce app on a real model hands out work, waits on it, steers it and hears how it ended through one task; every ending reaches its filer once, after a server restart and when a task fails out too; nothing records an ending except the claim gate or the drain; and no task tool beyond the five (and `answerTask` and `parkOnQuestion` until FIX-2058) is offered, now and in later changes.

**Input:**

- **The Lab** (`lab/fsdev.config.mts`): the concept's cast as `WORKER.md` files only (`cast.mts`, written at run time), on the built-in `agent` and coordinator flows, a SQLite store with durable execution, served by Shift Manager's own command. Alice signs in with her verified bearer and acts through the shipped clients. `desk.launch` (coordinator, routing everyone) hands to `desk.writer`, which asks `desk.researcher` for the fact and fact-checks it in a step of its own in a session of its own (`session: "new"`); `desk.chief` hands questions to `desk.editor`, which files for researcher and waits with `getTask`. The app adds no coordination code. The Lab notes the tools each model call was handed (`GOAL_TOOLS_LOG`), without changing them.
- **Held out, picked at run time:** the topic, the held-out word Alice asks for, the steer word, and the fact, which only researcher's file holds.

**Signal:** each failure is tagged `<leg>:<assertion>`, and each assertion is **structural** or **judgment** (`TAGS` in `run.mts`, printed with every failure; D1).

- **a**, the concept's walk less the call and the Inbox: `a:routed-listed` launch's routed task for writer is in Alice's list; `a:files-research` writer files researcher's task; `a:ends-running` writer's task stays running past its first request and its research; `a:one-settled` one `onTaskSettled` per research ending starts writer again; `a:step-dispatched` writer files its fact-check as a step in a session of its own; `a:drain-waits` the task ends after that step; `a:answers-after-steps` writer gets a turn after the step ends; `a:lands-once` the draft lands once, under writer's name; `a:draft-content` with the held-out word and researcher's fact; `a:follow-up` Alice's follow-up from the finished task runs in its session and returns a new version; `a:original-unchanged` the original reads byte-identical; `a:once` every ending reaches its filer once.
- **j1** (a team that hands out work): `j1:files`, `j1:waits-in-request` editor reads the research's ending with `getTask` in the same request, `j1:read-once` and so no notice turn runs for it, `j1:answer`, `j1:tools` no task turn is offered a task tool beyond the allow list, `j1:once`.
- **j2** (a team that runs a coordinator): `j2:steered` Alice's steer of an open routed task is taken, `j2:steer-shows` the draft carries the steer word, `j2:cancelled` her cancel of another ends it, `j2:cancel-heard-once` launch's session hears it once and no line lands.
- **b**: `b:killed` the server dies after researcher's ending is written and before it is sent (FIX-2078's kill point, reused); `b:hears-in-due-time` after a restart with no touch, writer hears it within the due time plus 2 s; `b:once`.
- **c**: researcher's model refuses every call. `c:files-dependent`, `c:fails-out`, `c:dependent-cancelled`, `c:one-failure-notice` writer hears one failure notice naming the dependent it cancelled, and none for the dependent; `c:once`.
- **sweep** (`sweep.mjs`, the engine CI runs): 0 live lines, and `--control` reports exactly its plants.
- **children** (`children.mts`): every child's goal or check with its controls, the set read from Linear; plus the coordinators, hand-offs and FIX-2005 privacy goals, and the goal-seek loop.
- **gaps** (`gaps.mts`): the 31 in-scope gaps rows, each mapped to the checks that read it.

**Anti-game:** Alice's conversation and rows are read through `listTasks_tasks` and `getTask_tasks` as Alice; every other grade reads the store file, read-only; endings are counted from the filer's notices and requests. No fixture writes a row, a session or a notice. The kill is a real process exit at the delivery's send, and the restarted server gets no action. A structural FAIL on any attempt is a finding, never retried past (D1).

**Model:** real: the goals library's default model through the gateway (`gatewayModel(goalModel())`, `openai/gpt-5.4-mini`), gated on a key that serves it (`keysServing`); without one the walk is blocked, not failed. The sweep and gaps parts are model-free.

**Run:** `pnpm tsx goals/workforce-coordination/runs-on-one-task/run.mts`. `GOAL_PARTS=walk,sweep,children,gaps` (default all), `GOAL_LEGS=a,b,c`, `GOAL_ATTEMPTS=<n>` (default 3, judgment misses only; 1 under a control). The children part runs every composed goal and takes hours. On demand only; the sweep alone runs in CI's Typecheck job (`node goals/workforce-coordination/runs-on-one-task/sweep.mjs`, and with `--control`).

**Controls:**

- `GOAL_CONTROL=no-sweeper-payment` (FIX-2078's, imported from its goal's `controls.mts`) must FAIL **`b:hears-in-due-time`**.
- `GOAL_CONTROL=no-cascade` (FIX-2080's, imported from its goal's `controls.mts`) must FAIL **`c:dependent-cancelled`**.
- `node sweep.mjs --control` plants a sixth tool, a removed name, a write through a renamed variable and a claim-passing cancel, and must report exactly those. `node sweep.mjs --at <commit>` sweeps another commit's tree: today's `main` before the epic must FAIL.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|

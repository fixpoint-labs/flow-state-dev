# shift-manager › a task shows its model and tokens

**Issue:** FIX-2288

**Outcome:** A user who opens a dispatched task sees which harness and model its run is on and how many tokens it has spent, split into input and output. The count rises while the run works, is `null` (never 0) until something reports, counts every attempt, reads the same in production as in development, matches the worker's Usage total for the same work, and holds only that task's own spend when one worker runs two at once.

**Input:** DevTeam's tree and `openLab`, served by Shift Manager's command (`lab/fsdev.config.mts`), each start over its own SQLite store, started four times:

1. **dev**: development, the coder on `claudeCodeHarness` configured with `claude-opus-4-1`, the Agent SDK replaced by `lab/scripted-sdk.mjs` at its import seam (`sdkSeam` in `controls.mts`). A scripted run sends an init message naming `claude-sonnet-4-5`, one assistant message per step with its usage, and a result with the whole query's `modelUsage`; it pauses after the init and after each step (`lab/pause.mjs`) until the check releases it.
2. **production**: `NODE_ENV=production` and trace observability off (`TASK_SPEND_GOAL_PRODUCTION=1`, set in `lab/goal-env.mts`). The Lab logs how it stood and the check reads that line.
3. **codex**: the coder on `codexAgent` started with `gpt-5`, its client scripted through `resolveCodexClient`, paused before `turn.completed`.
4. **cursor**: the coder on `cursorAgent` configured with `composer-2`, its client scripted through `resolveCursorClient`, paused before the turn's usage.

The Shift Coordinator's model is scripted to file one coder task per `[[usage:<tag>]]` and reports no usage. `openai/gpt-6-luna` (the general lead's and the researcher's) answers at 4 + 4 tokens a call: the general lead files one researcher task per `[[research:<tag>]]`, and the researcher's run reports progress, then answers. Rows are read through `listTasks` from the board's task actions over the Lab's HTTP door. Each leg runs as its own user.

**Signal:** each failure tagged `<leg>:<assertion>`.

- **a**: the researcher's task, two calls of 4 + 4: model `openai/gpt-6-luna`, harness `null`, exactly 8 in and 8 out, `live: false` (**a:model-and-8**).
- **b**: a coder task on Claude Code, read at each pause. Before any assistant message: harness `claude-code`, model `claude-sonnet-4-5` (the run's, not the configured `claude-opus-4-1`) (**b:model**), tokens `null` (**b:null-before**). After the first of three messages (100 + 20 each): 100 + 20 and `live: true`; after the second, 200 + 40 (**b:rising**). At the end exactly 1 000 + 200, the result's whole-query count, not added to the running 300 + 60, and `live: false` (**b:exact**).
- **c**: Codex paused before `turn.completed`: harness `codex`, model `gpt-5`, tokens `null`, `unreported: true` (**c:null**); after, 700 + 300. Cursor the same with `cursor`, `composer-2`, then 500 + 100.
- **d**: attempt one spends 230 + 70 and answers nothing, so its check fails; attempt two spends 1 000 + 200 and passes: the row reads 1 230 + 270, 1 500 in all (**d:1500**).
- **e**: a and b give the same numbers on the production Lab (**e:same-numbers**).
- **f**: for legs a to d and c's two harnesses, the task's final tokens equal what `workerUsage` added for its worker over that leg (**f:equal**).
- **g**: two Claude Code tasks for one coder at once (1 000 + 200 and 400 + 80); the second is cancelled after its first message (100 + 20): the first reads 1 000 + 200, the cancelled one 100 + 20 and `live: false` (**g:own-only**); a row that never settles or stays live fails it too.

**Anti-game:**
- No assertion reads orchestration's modules or a row written directly. Rows are read through the board's `listTasks` action, and worker usage through `workerUsage`, over each Lab's HTTP door.
- Spend enters as model results and SDK messages only, through the real chain: Shift Coordinator or general lead, task board, harness manager, the harness, the request's ledger, the task request's spend tick and its request-end settle.
- Mid-run reads wait past one spend tick (`SPEND_TICK_MS` + 1.5 s) at a pause the run cannot leave until the check releases it.
- Production is a separate process whose own log line says `NODE_ENV=production traces=off`.

**Model:** n/a (scripted models and SDKs).

**Run:** `pnpm tsx goals/shift-manager/a-task-shows-its-model-and-tokens/run.mts` (about two minutes).

**Controls:** each patches a module as the Lab loads it (`controls.mts`).
- `GOAL_CONTROL=end-only`: no spend is written while a run works. Must fail **b:rising**.
- `GOAL_CONTROL=zero-unreported`: tokens nothing reported read as 0. Must fail **c:null**.
- `GOAL_CONTROL=last-attempt-only`: a task counts only its latest request. Must fail **d:1500**.
- `GOAL_CONTROL=config-model`: the model shown is the harness's configured one. Must fail **b:model**.
- `GOAL_CONTROL=from-traces`: model calls count only where traces carry usage. Must fail **e:same-numbers**.
- `GOAL_CONTROL=add-result`: an ending's spend is added on top of the running total. Must fail **b:exact** and **f:equal**.
- `GOAL_CONTROL=by-session`: a request's spend is written to every task its worker is running, each with a ticket made for that row (the row's identity fence alone would decline a write under another task's ticket). Must fail **g:own-only**.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-28 | claude/project-thread-ldiw1v (tree of 20a34ac7 + working changes) | n/a | PASS | 108 s. a: `openai/gpt-6-luna`, harness `null`, 8 + 8. b: `claude-code`/`claude-sonnet-4-5`, tokens `null` before any message, then 100 + 20 and 200 + 40 live, 300 + 60 before the result, 1 000 + 200 at the end, `live: false`. c: Codex `gpt-5` and Cursor `composer-2` read `null`, `unreported: true` mid-turn, then 700 + 300 and 500 + 100. d: completed after 2 attempts, 2 runs, 1 230 + 270. e: production a 8 + 8, b 1 000 + 200. f: every leg's task equals its worker's usage. g: 1 000 + 200; cancelled 100 + 20, `live: false`. |
| 2026-10-28 | same, `GOAL_CONTROL=end-only` | n/a | FAIL (expected) | **b:rising**: every mid-run read is `null`; c's mid-turn reads `null` too. |
| 2026-10-28 | same, `GOAL_CONTROL=zero-unreported` | n/a | FAIL (expected) | **c:null**: Codex and Cursor read 0 + 0 mid-turn; b reads 0 + 0 before any message. |
| 2026-10-28 | same, `GOAL_CONTROL=last-attempt-only` | n/a | FAIL (expected) | **d:1500**: 1 000 + 200, against worker usage 1 230 + 270 (f:equal). |
| 2026-10-28 | same, `GOAL_CONTROL=config-model` | n/a | FAIL (expected) | **b:model**: the row reads `claude-opus-4-1`. |
| 2026-10-28 | same, `GOAL_CONTROL=from-traces` | n/a | FAIL (expected) | **e:same-numbers**: leg a reads `null` in production, 8 + 8 in development. |
| 2026-10-28 | same, `GOAL_CONTROL=add-result` | n/a | FAIL (expected) | **b:exact**: 1 300 + 260. **f:equal**: worker usage added 1 000 + 200. |
| 2026-10-28 | same, `GOAL_CONTROL=by-session` | n/a | FAIL (expected) | **g:own-only**: the cancelled task stays live at 200 + 40; the first reads 1 100 + 220. |

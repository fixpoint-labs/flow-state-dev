# task-board › it lets a worker plan its own steps

**Issue:** FIX-2076 (epic FIX-2056), leg a. Its spec's goal: `specs/issues/FIX-2076/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** a worker handed a job in steps files each step for itself, and the request that works its task works the steps, in order, in the same session, each seeing what the one before produced. No session is opened per step and nothing is handed to another worker. Then the worker answers once, having seen every step end, and that answer is the task's result.

**Input:**

- One in-process host on the real engine and a SQLite store, acted on over its HTTP router as one verified person (`goals/lib/client-actions`). The tree in `fixtures/workforce/`: `crew.desk` on a goal-local `desk` flow (the person's conversation; its turn runs no model), delegate `crew.writer`; `crew.writer` on the built-in `agent` flow and a real model, with no delegates. Its instructions say to file numbered steps for itself and to do one step when it comes.
- The person files one task for the writer from the desk with `createTask_tasks`: a product announcement in three steps (leg a1: outline, draft, tighten) or two (leg a2: outline, write). The first step invents a two-word codename.
- Held out, made at run time: the product, picked from `fixtures/briefs.json`, and the codename, which only the first step's turn invents.

**Signal:** each failure is tagged `<leg>:<assertion>`.

- `steps-in-task-session` the writer filed as many steps as the brief has, all for itself, all `completed`, all on the plan ledger of the task's own session.
- `in-order` each step started after the one before it ended.
- `carries-forward` the codename the first step's output states is in every later step's output.
- `no-child-session` the conversation ledger holds no row but the person's task: nothing was handed to a session, the writer's own included. Scoped to steps filed with no `session`, as this leg's are: since FIX-2082 a step filed `session: "new"` runs in a new session of the writer, by design (`goals/task-board/waits-on-a-task-it-filed/`, leg d).
- `listed` what the person's app reads for the task session, over the router: its `listTasks_tasks` answers `{ ok: false, error: "no_delegation_board" }` (the writer has no delegate, so it has no delegation board), and its `plan` ledger lists exactly the steps this leg filed, each assigned to the writer.
- `result-is-the-answer` the task is `completed` with one answer (a string, not `{ answer, pieces }`) that names the codename.

**Anti-game:** every grade reads the store (the plan ledger, the conversation ledger, the task row), a public task action's answer, or a collection read over the router, never the model's tool arguments or its prose about what it did. The codename is invented at run time by the first step's turn, so a later step or the result that holds it got it through the steps. A step filed as a task for a session of the writer lands on the conversation ledger, which `no-child-session` reads.

**Model:** real for the writer: the goals library's default model through the gateway (`gatewayModel(goalModel())`; `GOAL_MODEL` overrides). Gated on a key that serves it (`keysServing`); without one the run is blocked, not failed.

**Run:** `pnpm tsx goals/task-board/a-worker-plans-its-own-steps/run.mts`. `GOAL_LEGS=a1,a2` runs some legs. On demand only, never a CI gate.

**Controls:** `GOAL_CONTROL=no-plan` is today's `main` as a scratch patch applied as the process loads (`goals/lib/module-patch.mts`): the agent's turn runs without its plan, and a filing naming the worker is a task handed to a session of its own. Leg a1 must fail **`a1:steps-in-task-session`**. `a1:no-child-session` goes red with it when the planless model files steps for itself, as it did on 2026-10-21; on 2026-10-24 it answered in one turn instead (4 of 4 runs), so it isn't required.

A step that fails, and the answer naming it, is proven in CI by `packages/workforce/test/worker-plans-its-steps.test.ts`: a real model won't fail a step on cue. FIX-2080 had not landed when this did, so a failed attempt's open steps stay open for the next attempt rather than ending `cancelled`; that assertion joins this leg with FIX-2080.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-21 | fix/FIX-2076, uncommitted goal | vercel:openai/gpt-5.4-mini | FAIL | first draft of the writer's instructions: it filed one step per turn and finished the rest in its answer; the instructions now say to file every step in one turn |
| 2026-10-21 | fix/FIX-2076, uncommitted goal | vercel:openai/gpt-5.4-mini | FAIL | a1: the first step's turn read the original task in its history and tried to file the step again; the step's brief now says it is running and not to file it again |
| 2026-10-21 | fix/FIX-2076, uncommitted goal | vercel:openai/gpt-5.4-mini | PASS | a1: 3 steps completed in order in the task session, codename "Velvet Beam" in every later step and the result; a2: 2 steps, "Lunar Veil"; one `work` request in the task session; no delegation row |
| 2026-10-21 | fix/FIX-2076, uncommitted goal | vercel:openai/gpt-5.4-mini | FAIL (control `no-plan`, expected) | a1: 0 steps; four rows on the conversation ledger for crew.writer (task sessions of itself); the task parked on them |
| 2026-10-23 | fix/FIX-2117 | vercel:openai/gpt-5.4-mini | PASS | FIX-2117: `listed` now checks the documented contract (`apps/docs/docs/workforce/delegating-work.md`, "Working in steps"; `packages/workforce/README.md`; `packages/workforce/test/any-worker-files.test.ts`): a worker with no delegate answers `no_delegation_board` from the app's `<tool>_tasks` actions, and its steps are read from the `plan` ledger. It used to want `listTasks_tasks` to list the steps, and failed on `main` reading `no_delegation_board` with every other assertion passing. a1: 3 steps, "Cloud Ledger"; a2: 2 steps, "Velvet Beacon"; the plan ledger read over the router held exactly those rows. Probes: the action answering another error, and a read of a ledger without the steps, each fail `listed` |
| 2026-10-24 | FIX-2087 closure round 5, 7b442e1ae + the anchor fix, uncommitted | vercel:openai/gpt-5.4-mini | FAIL (control `no-plan`, expected) | The patch matched nothing on 7b442e1ae: FIX-2159 added `answerAgain` to `board.planned(...)`. Re-anchored; `a1:steps-in-task-session` red again (0 steps) |

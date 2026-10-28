# task-tools › five task tools, one rule per field, and no reach past the delegates

**Issue:** FIX-2081 (epic FIX-2056). Its spec's goal: `specs/issues/FIX-2081/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** a worker or a screen changes a task through five task tools; every field of `updateTask` follows one rule, which a refusal names; and a task reaches only a worker its filer may give work to.

**Input:** a real `createFlowState` host on a SQLite store, with Workforce's real worker flows: the built-in `agent` flow and the `coordinator`. The standard workers are `desk` (a coordinator, delegates `eng.a` and `eng.b`), `chief` (a coordinator set to `editsOwnDelegates: true`), `fan` (an agent worker with `delegates: all`), `eng.a` (an agent worker, delegate `eng.b`), `eng.b` and `eng.c` (agent workers; `eng.c` is nobody's delegate). Every model turn runs on one scripted model: it records the tools each model request offered, and makes the calls its turn's message names. Alice and Bob act over the host's HTTP router, each as a verified user. Task words and ids are made at run time.

**Signal:** each failure is tagged `<leg>:<assertion>`.

- `a` (the tools each worker's model is offered): a coordinator's turn and an agent worker's conversation turn are offered `createTask`, `getTask`, `listTasks`, `updateTask` and `listDelegates`, and none of `addTask`, `assignTask`, `completeTask`, `failTask`, `cancelTask`, `readTask`, `blockTask`, nor `createTask` (gone in FIX-2083). Only `chief`, set to manage its own delegates, is offered `addDelegate`, `removeDelegate` and `setFallback`. `reportProgress` and `askQuestion` are offered on a task turn and not off one, and neither `answerTask` nor `parkOnQuestion` (gone in FIX-2131) is offered anywhere. An inline plan step that calls `reportProgress({ statusNote, output })` checkpoints its own row, and the task's result is still the answering turn's. The coordinator flow has no removed tool's action.
- `b` (every field in every state): for each of `goal`, `title`, `context`, `input`, `deps`, `priority`, `labels`, `metadata`, `assignee` and `maxAttempts`, and for a hold or a release, on a task that is pending, held, pending after a retry, running and finished, by the coordinator's `updateTask` tool and by `updateTask_tasks` as the user. A write to a task that hasn't started reads back changed through `getTask_tasks`. Any other is refused, names the field, the state and the task, and leaves the row unchanged. A release with a reassign, in one `updateTask_tasks`, is refused on a started or finished task and releases a held one. A cancel sent with an edit is refused. A running task's reassign is refused, and the row completes with its first worker's answer. A cancel lands on a running task.
- `c` (filing and delegates): from `eng.a`'s task session, a piece for `eng.c` is refused `unknown_assignee`, by `createTask`, and none is stored; a piece for `eng.b` is filed. `fan` (`delegates: all`) is refused a task for a worker not yet hired, and reaches it once Alice hires it, in the same conversation. Bob's `updateTask_tasks` on Alice's conversation is refused, and her row is unchanged.

**Anti-game:** the tools are read off each model request, never the board's description of them. Tool results are what the model got back. Rows are read through the public read actions (`getTask_tasks`, `listTasks_tasks`), never through the collection. A turn makes calls only when its own message opens with its tag, so a notice that quotes a task's goal makes none. The one row seeded into the store, the task pending after a retry, is seeded as a failed first attempt leaves it; everything else is filed and run on the real path.

**Model:** n/a (model-free).

**Run:** `pnpm tsx goals/task-tools/five-tools-one-rule-per-field/run.mts`. On demand only, never a CI gate.

**Controls:** each is a scratch patch to the code under test, applied as it loads (`goals/lib/module-patch.mts`), printed by the run, and refused when it never reached the code.

- `GOAL_CONTROL=roster-reach`: a task session's delegates are the whole roster again (`packages/workforce/src/delegates/worker-delegates.ts`). Must fail leg `c` on **"a piece for a non-delegate is refused"**.
- `GOAL_CONTROL=edit-any-state`: the field table's state rule is off, in the tool's pre-check and in the guarded write (`task-tools-capability.ts`, `collection/internal.ts`, `collection/resource-backed.ts`). Must fail leg `b` on the **running** and **finished** columns.

On `fix/FIX-2080` before FIX-2081 the check fails before any leg runs: the host refuses the standard workers, since `editsOwnDelegates` isn't a coordinator setting and `delegates: all` isn't a list. The package tests that carry the same rules fail there too (see the verdict log).

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-21 | `fix/FIX-2080` at 0d5a235 (before FIX-2081), extracted with `git archive`, built | n/a | FAIL (expected) | The host refuses the workers: `editsOwnDelegates` is not a setting, and `delegates: all` is not an array. The new orchestration tests fail 20, the new workforce tests 4. |
| 2026-10-21 | `fix/FIX-2081` at 8af3e44bd | n/a | PASS | Legs a, b and c. Every field in the pending and held columns reads back changed; the pending-after-retry, running and finished columns are refused with `field_locked_after_start` or `task_finished` and leave the row unchanged. |
| 2026-10-21 | same, `GOAL_CONTROL=roster-reach` | n/a | FAIL (expected) | Only `c:a piece for a non-delegate is refused`. |
| 2026-10-21 | same, `GOAL_CONTROL=edit-any-state` | n/a | FAIL (expected) | Leg b, the running, finished and pending-after-retry columns; the pending and held columns stay green. |
| 2026-10-21 | `fix/FIX-2081` after the review round and the merge of `fix/FIX-2080` at b194f86 | n/a | PASS | Legs a, b and c, with the field table as the write's only field rule. |
| 2026-10-21 | same, `GOAL_CONTROL=roster-reach` | n/a | FAIL (expected) | Only `c:a piece for a non-delegate is refused`. |
| 2026-10-21 | same, `GOAL_CONTROL=edit-any-state` (patch moved to the new call sites) | n/a | FAIL (expected) | Leg b, the running, finished and pending-after-retry columns; pending and held stay green. |
| 2026-10-22 | `fix/FIX-2081` at the delta-review round (D3's literal checkpoint rule, the legacy-only release, `main` at b8328ccb3) | n/a | PASS | Legs a, b and c. |
| 2026-10-22 | same, `GOAL_CONTROL=roster-reach` | n/a | FAIL (expected) | Only `c:a piece for a non-delegate is refused`. |
| 2026-10-22 | same, `GOAL_CONTROL=edit-any-state` | n/a | FAIL (expected) | Leg b, the running, finished and pending-after-retry columns; pending and held stay green. Both controls reached their patch anchors. |
| 2026-10-22 | `fix/FIX-2078` over `main` at 23856ed68 | n/a | PASS | Legs a, b and c. The scripted model no longer sleeps on a `[slow]` quoted in a notice of an ending: since FIX-2078 the coordinator hears the cancel of `#b-running#` as a notice turn, which slept 45 s on the quoted goal and held the session past leg c's idle wait (`c:threw — a request never finished`). |
| 2026-10-23 | fix/FIX-2083 on 52ad9b934 (the merge with FIX-2082) + the `dispatchTask` removal, uncommitted | n/a | PASS | Legs a, b and c. Leg a: the coordinator is offered no `dispatchTask`. Leg b: a release with a reassign is one `updateTask_tasks` write, refused on started and finished rows, landing on a held one |
| 2026-10-26 | `fix/fix-2131` on `f32747683`, uncommitted | n/a | PASS | `answerTask` and `parkOnQuestion` on the removed list; a task turn offered `reportProgress` and `askQuestion`. |

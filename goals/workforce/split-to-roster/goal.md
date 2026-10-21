# workforce › it splits a task to its delegates

**Issue:** FIX-1997 (epic FIX-1996); rewritten for FIX-2081 (epic FIX-2056), where a task reaches only its filer's delegates. Its spec's goal: `specs/issues/park-on-task/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** a worker on a task can get a result from one of its delegates by filing a piece and ending its turn. Nothing runs while it waits. The piece's ending wakes it, and its task completes with the worker's own report as its answer. The person's desk hears the task end, never the piece.

**Input:**

- One in-process host on the real engine and a SQLite store, acted on over its HTTP router as one verified person (`goals/lib/http-actions`). The tree in `fixtures/workforce/`: `crew.desk` on a goal-local `desk` flow, the person's conversation, whose turn runs no model and records every message it is handed, delegate `crew.reporter`; `crew.reporter` (A) on the built-in `agent` flow and a real model, delegates `crew.helper`, `crew.keeper` and `crew.broken`; `crew.keeper` (B), `crew.broken` and `crew.helper` on a goal-local `taker` flow. B answers with the round's codename after a 4 s hold; `crew.broken` fails every attempt; `crew.helper` holds no codename.
- The person files each task for A from the desk with `dispatchTask_tasks`, naming the delegate that keeps the codename. The ask doesn't mention `wait`, pieces or the task tools.
- Held out, made at run time: the codename, fresh per leg and held only in B's answer.

**Signal:** each failure is tagged `<leg>:<assertion>`.

- **1** `1:piece-to-delegate` A's task session filed a piece for its delegate `crew.keeper`. `1:parked-while-b-works` halfway through B's hold, A's task is `parked` and A's task session has no request running. `1:report-is-output` A's task is `completed` with `output.answer` holding the codename, and B's piece listed under `output.pieces`, completed.
- **2** `2:reads-the-failure` `crew.broken`'s piece failed for good, a turn in A's task session was woken by that failure, and A's task ended `errored`, or `completed` after that turn filed the work again.
- **3** `3:settles-once` the host is stopped (no drain) the moment B's piece is `completed`, while A's task is still `parked` and no `onTaskSettled` request in A's task session has ended or started the turn it wakes (the request itself is filed with B's ending, so no poll sees one without the other), so the stop lands between B's ending and A's woken turn; then it starts again over the same store and the person lists the desk's tasks. A stop polled too late is set aside and tried again with a fresh task, up to 3 attempts. A's task completes, and the desk acted on its `completed` notice once and its turn was handed it once.
- **4** `4:desk-hears-tasks-only` across legs 1 to 3, after a last `listTasks` on the desk, every notice the desk acted on and every notice turn it ran names a task the person filed, never a piece.

**Anti-game:** every grade reads the store (task rows, requests, session state) or what the desk's own turn was handed, never the model's tool arguments or prompt. The codename is fresh per leg and only B's answer holds it, so an answer holding it came through B. `1:report-is-output` reads `answer`, which only the woken turn writes; B's own output sits under `pieces`, so a settle that passes B's output up can't pass it. Leg 3 says where the stop landed; a stop after A's task settled fails it rather than passing vacuously. On a stop with no woken turn behind it, the task completes with `{ pieces }` alone, by design.

**Model:** real for A: the goals library's default model through the gateway (`gatewayModel(goalModel())`; `GOAL_MODEL` overrides). Gated on a key that serves it (`keysServing`); without one the run is blocked, not failed.

**Run:** `pnpm tsx goals/workforce/split-to-roster/run.mts`. `GOAL_LEGS=1,2,3,4` runs some legs. On demand only, never a CI gate.

**Controls:** each is a scratch patch to Workforce applied as the process loads it (`goals/lib/module-patch.mts`), printed by the run and refused when it never reached the code.

- `GOAL_CONTROL=pieces-output`: the settle ignores the woken turn's answer (`conversation-board/split.ts`, `settleParent`). Leg 1 must fail **`1:report-is-output`**, alone.
- `GOAL_CONTROL=wake-coordinator`: a task session's board is the one above it, the desk's (`conversation-board/board.ts`, the resolver's partition), so A's pieces land on the desk's board and their endings are the desk's. Leg 4 must fail **`4:desk-hears-tasks-only`**. Leg 1 goes red with it (A's task completes from its first turn); it has no isolating red state.

**Before-state:** `main` at `ce4dbe52` (the merged spec, before FIX-1997) fails leg 1: A's `dispatchTask` for `crew.keeper` is refused `unknown_assignee`. Since FIX-2081 a task reaches only its filer's delegates, so `crew.keeper` is one of A's; a piece for a non-delegate is refused, which `goals/task-tools/four-tools-one-rule-per-field/` leg c grades. The `delegates-only` control is retired with the roster reach it put back.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-14 | 034f21c6 + the review fixes, uncommitted | the default model (vercel gateway) | PASS | 1: completed with answer "This release’s codename is kestrel-cobalt-974.", crew.keeper's piece under it; `parked` with 0 requests running while B worked. 2: crew.broken's piece errored; A's task `errored`. 3: first attempt stopped with A's task `parked`, B's piece `completed`, no notice request ended and no woken turn started; after the start, completed once with `{ pieces }` (the stop cancelled the notice past its marker, so no turn answered), the desk heard it once. 4: the desk acted on notices for the three filed tasks only |
| 2026-10-14 | 034f21c6 + the review fixes, uncommitted | the default model (vercel gateway) | FAIL (control `delegates-only`, expected) | `1:piece-to-roster`: `unknown_assignee` for crew.keeper, only crew.helper available; `1:parked-while-b-works`, `1:report-is-output` red with it |
| 2026-10-14 | 034f21c6 + the review fixes, uncommitted | the default model (vercel gateway) | FAIL (control `pieces-output`, expected) | `1:report-is-output` alone: output `{ pieces }` holding B's answer, no `answer` |
| 2026-10-14 | 034f21c6 + the review fixes, uncommitted | the default model (vercel gateway) | FAIL (control `wake-coordinator`, expected) | `4:desk-hears-tasks-only`: the desk acted on the piece's ending; leg 1 red with it |
| 2026-10-14 | 95c660ab8 + this goal, uncommitted | the default model (vercel gateway) | PASS | 1: A filed one piece for crew.keeper; halfway through B's hold A's task was `parked` with 0 requests running in its session; completed with answer "The release codename is lumen-garnet-323." and the piece under it. 2: crew.broken's piece errored after 2 attempts; woken turns read it; A's task `errored`. 3: stopped with A's task `parked` and B's piece `completed`; after the start and a `listTasks`, completed once with `{ pieces }` (no woken turn behind it), the desk heard it once. 4: the desk acted on notices for the three filed tasks only |
| 2026-10-14 | 95c660ab8 | the default model (vercel gateway) | FAIL (control `delegates-only`, expected) | `1:piece-to-roster`: A's piece for crew.keeper refused; it filed for crew.helper instead and reported it couldn't find the codename. `1:parked-while-b-works`, `1:report-is-output` red with it |
| 2026-10-14 | 95c660ab8 | the default model (vercel gateway) | FAIL (control `pieces-output`, expected) | `1:report-is-output` alone: output `{ pieces }` holding B's answer, no `answer`; the park read held |
| 2026-10-14 | 95c660ab8 | the default model (vercel gateway) | FAIL (control `wake-coordinator`, expected) | `4:desk-hears-tasks-only`: the desk acted on the piece's ending (it failed at the desk's hand-over, crew.keeper being no delegate of the desk). Leg 1 red with it: A's task completed from its first turn |
| 2026-10-14 | `ce4dbe52` source for the changed modules (`main`), leg 1 | the default model (vercel gateway) | FAIL (expected) | `1:piece-to-roster`: `dispatchTask` for crew.keeper answered `unknown_assignee`; A filed for crew.helper; output `{ pieces }` |

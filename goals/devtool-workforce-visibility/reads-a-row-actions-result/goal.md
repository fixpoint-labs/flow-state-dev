# devtool-workforce-visibility › it reads a row action's result

**Issue:** FIX-1661. The spec's goal check.

**Outcome:** A developer runs an action from a task's row in the DevTool and the row shows what that action came to: refused with the action's own words, done with its answer, or failed with the error, even when the answer only ever existed in a transient block, behind completion hooks, by reference inside a sequencer, after a person resumed it, or before a hook failed the request. The row reads it from the result the engine recorded for the request, never from traces or the live stream.

**Input:** The fixture flow (`fixtures/flow.mts`), served by the ordinary `fsdev dev --config fixtures/fsdev.config.mts` on SQLite, durable, with no model. `fixtures/input.json` holds one row goal per leg and the answer each leg's action returns. Both are **held out**: the server gets the answers through `ROW_RESULT_ANSWERS`, and rows are filed through the board's own `addTask_rows` action and found by the ids it returned. Different answers must pass too.

**Signal:** Chromium on the shipped DevTool bundle, rebuilt at the start of the run, at **1280×800**. The page talks to the server through a pass-through proxy the check runs. Each leg runs its action from the row's own Actions strip, with the task id locked in the form. Every failure line names its leg.

- **handover.** A transient block refuses. Then the hook leg's dispatch takes the one live stream, and the handover row is graded again: it still reads `refused` with the fixture's words.
- **hook.** A refusal with the flow's `onStarted`/`onCompleted`/`onFinished` hooks running as root blocks of the same request. The row reads `refused` with the fixture's words.
- **ref.** A sequencer whose step returns the answer. The row reads `ok` and shows that value.
- **suspend.** A durable sequencer suspends for a person. While suspended the row reads pending (checked after 4.5s). The check resumes it over HTTP with the fixture's answer, and the same row then reads `ok` with it.
- **hook-fails.** The action refuses, then its own `onCompleted` hook throws. The row reads `failed` with the hook's error and the action's refusal.
- **api.** Through the proxy, `GET /sessions/:id/requests?include_result_output=true` lists each leg's request with its recorded result and output. Without the flag it lists the status, `result.error` and `hasOutput` only.
- The page loads once. Any further main-frame navigation fails the run.

**Anti-game:** The hollow pass is a row that still reconstructs the answer from traces or the stream, and happens to get these cases right. The `no-result` control rules it out: with `result` stripped from the listing, every row leg must go red, so nothing but the recorded result can turn a row green. Rows are found by `data-task-id`, never by text. The check never reads the store to decide what is on screen.

**Model:** n/a. Every block is a deterministic handler.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/devtool-workforce-visibility/reads-a-row-actions-result/run.mts`. The run builds the DevTool bundle first. On a clean checkout, run `pnpm packages:build` once before it.

**Controls:** Each control must FAIL at exactly the legs named, and the run checks that itself.

- `GOAL_CONTROL=no-result`: the proxy strips `result` from the session request list, which is what a server that does not record results sends. Must fail **every leg**: handover, hook, ref, suspend, hook-fails and api.

## Verdict log

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-30 | `2013d34f6` + this goal (on `fix/fix-1661`) | n/a | FAIL (expected) | Control `no-result`: **every leg**, and no other. The handover, hook, ref and suspend rows read *"No result recorded for this request."*; hook-fails read *"Failed: The request ended failed. No result recorded for this request."*; api reported each leg listing no result. |
| 2026-09-30 | `2013d34f6` + this goal (on `fix/fix-1661`) | n/a | **PASS** | handover: *"Refused: handover: task is cancelled, which is terminal"*, still so after hook's dispatch. hook: *"Refused: hook: task is not claimable while it is parked"*. ref: *"Done: {"ok":true,"value":"ref: priority raised to 7"}"*. suspend: pending while suspended, then *"Done: {"ok":true,"answer":"suspend: approved by the on-call reviewer"}"*. hook-fails: *"Failed: hook-fails: the notification service is down (the action itself refused: hook-fails: the task was already settled)"*. api: all five results with the flag; status, error and `hasOutput` only without. One page load. |

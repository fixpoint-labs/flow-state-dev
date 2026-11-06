# suspension › it is answered from React in a task run

**Issue:** FIX-2450 (epic FIX-2447). Its spec's goal: `specs/issues/FIX-2450/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** a person who answers a stop from a React screen gets it answered, whatever started the run. An approval inbox over a task board approves a task's stop and the task's run carries on; the same holds for a form, for the session's streaming call, and for a webhook's run. A developer's own custom-reason `ctx.suspend`, approved from the same default card, still completes.

**Input:** a real `createFlowState` host on a SQLite store (so execution is durable, as in an app), reached by React's hooks through `createInProcessFetch` and rendered by react-dom over a happy-dom document. One flow, `approvals`:

- a task board (`taskBoard`, delegation) with four tasks, each dispatched to its own `task` entry in its own session: two `ctx.suspendForUser({ kind: "approval" })`, one `ctx.suspendForUser({ kind: "input" })`, one raw `ctx.suspend({ reason: "user_approval" })`;
- a webhook binding whose run stops on the same raw `user_approval`;
- a public action whose run stops on a custom reason (`budget_check`).

Each task's prompt is its goal; any goal text passes the same way.

**Signal:** each failure is tagged `<leg>:<assertion>`. In every leg, `stop-resolved` is the stop's `suspension_resume` item in its session reading the expected resolution, and `run-completes` is the request settling `completed`.

- `a`: a task's approval, approved through `useApproval` alone (no resolver provider).
- `b`: a task's approval, approved through `useApproval` under `SuspensionResolverProvider` with `session.answerSuspension`. Also `b:items-show-continuation`: the stop's resume item reaches the session view's own `items`.
- `c`: a task's input, submitted through `useSuspensionForm`, reads `submitted`.
- `d-task`, `d-webhook`: a raw `user_approval` stop in a task's run and in a webhook's run, approved through `useApproval` alone.
- `e`: a custom-reason stop in the user's own run, approved from the card, reads `approved` and completes.

**Anti-game:** the runs are started by their real sources (a board's dispatch for `task`, a webhook binding for `webhook`), never a run the user started standing in for one. No client is mocked: every answer goes from the hook through the real client and the engine's routes. The check reads what the engine recorded (the stop's resume item, the request's status) through the public client, never the path a hook posted to.

**Model:** n/a (model-free: no model is called).

**Run:** `pnpm tsx goals/suspension/is-answered-from-react-in-a-task-run/run.mts`. On demand only, never a CI gate.

**Controls:** a scratch patch to the code under test, applied as it loads (`goals/lib/module-patch.mts`), printed by the run, and refused when it never reached the code.

- `GOAL_CONTROL=resume-only`: React answers every stop through `resume`, which is what every React caller did on `main` before FIX-2450. Must fail **`a:stop-resolved`**, **`b:stop-resolved`**, **`c:stop-resolved`**, **`d-task:stop-resolved`** and **`d-webhook:stop-resolved`** (the resume route answers 404 for a task's or a webhook's run), with their `run-completes`. Leg `e` must pass.

**Not in this goal, and why:** the DevTool's suspension panel takes the same pick on `isUserSuspension`, and is pinned by `packages/devtool/test/suspensions.test.tsx`. A custom-reason stop in a task's run is answered by no route, before or after; nothing to grade.

## Verdict log

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-06 | `fix/fix-2450` on `b34bdf1da`, uncommitted | n/a | **PASS** | a, b, c, d-task, d-webhook and e all resolve and complete; b's resume item is in the session view's items (read 1). |
| 2026-11-06 | same (control `resume-only`) | n/a | FAIL (expected) | `a`, `b`, `c`, `d-task`, `d-webhook`: `stop-resolved` unresolved (the hook said `Request failed (404)`), `run-completes` suspended; `b:items-show-continuation` 0. Leg `e` green. Nothing else red. |

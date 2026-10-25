---
"@flow-state-dev/contracts": minor
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/client": minor
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": patch
"@flow-state-dev/shift-manager": patch
"@flow-state-dev/react": patch
"@flow-state-dev/devtool": patch
---

A stop that waits for a user holds its task and ends exactly once (FIX-2129).

- **`ctx.waitForUser({ kind, prompt, deadline? })`** (`core`): stop the request for an `approval`, a `review` or an `input`. It returns the answer, or `{ cancelled: true }` when the task was cancelled while it waited. At its deadline an approval reads as a no (`deadline: true`) and a review or an input throws `SuspensionTimeoutError`, which the block may catch. With no `deadline`, the host's `userDeadlineMs` applies, else none: the stop waits until it is answered, stopped or cancelled.
- **The answer route** (`engine`): `POST /api/flows/:flowKind/requests/:requestId/answer` answers a user's stop in any run, a task board's included, after the resume path's ownership checks; a request handle's `answer` (`client`) calls it. Who answered is the signed-in caller.
- **`userDeadlineMs`** (`createFlowState`, `engine`): the host's deadline for a user's stop, unset by default.
- **A task waiting on a user** (`orchestration`): `getTask` and `listTasks` show `waitingOn` and, for `"user"`, `waitingFor` (the stop's kind, prompt and deadline). A cancel resumes the run `cancelled` (its writes, its result and its filings are refused), a stop cancels the task instead of failing the try, and a cancelled task refuses new filings (`parent_cancelled`).
- **Cancel one stop:** `RequestHost.resumeWait({ suspension: { requestId, suspensionId }, outcome: { cancelled: true } })`.
- `contracts` exports `isUserSuspension` and `waitForUserKindOf`, and `SuspensionStatus` gains `"cancelled"`.

**Migration:**

- `TaskWaitingOn` reads `"user"` where it read `"person"`. Stored rows are not migrated.
- A raw `ctx.suspend` with `human_approval` or `human_input` now gets the same mark, cancel and stop as `waitForUser`. A raw `human_input` stop past its `timeoutMs` now resumes its block with `SuspensionTimeoutError` instead of staying parked, and a cancelled one throws `SuspensionRejectedError` with `cancelled: true`.
- `isExpiredApproval` is now `continuesAtExpiry`, which also covers a user's review and input.
- A filing by a cancelled task is refused (`TaskFilingRefusedError`, rule `parent_cancelled`), and a piece filed on a task session's board under a cancelled task is refused before it is added, so it is never claimable.
- Shift Manager answers every ask through the answer route; `REOPENED_SOURCES` and `DISPATCHED_RUN_UNANSWERABLE` are gone.

---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": minor
"@flow-state-dev/react": minor
"@flow-state-dev/devtool": patch
"@flow-state-dev/shift-manager": patch
---

A task waiting on a person no longer parks (FIX-2131). A worker's model asks with `askQuestion({ question })`: the turn ends and the task waits on the question, still running, and the user's Inbox lists it. The answer is a message naming the question, `updateTask({ id, question, message })`, from the Inbox, a line typed in the task's session, or the filer's own `updateTask` for a question asked midway; the first answer wins, and the task takes one more turn on the same attempt, spending no retry. A model stops for the user's approval or review with its `waitForUser({ kind, prompt })` tool, whose result is the answer; off a task row it also takes `input`. A block asks for a review with `ctx.waitForUser({ kind: "review", prompt })`. A turn waits on a person once: `askQuestion` and `waitForUser` called in one step open one wait, and the other comes back as a tool error naming it. A `complete-or-blocked` board whose open tasks only wait on a person stops `blocked` instead of waiting on them. A `goalSeekLoop` whose drain leaves a task waiting on an answer judges nothing: it ends that pass with `reason: "waiting-on-a-user"`, runs no `finalize` and spends no iteration.

The DevTool's Tasks tab shows what a running task waits on (its open question, or its run's stop) in the row's reason slot, and an action form leaves an optional choice unpicked until you pick one. Shift Manager counts what needs you from the Inbox, and Roster lists a worker's tasks held on its questions as waiting on you.

**Migration.**

- `parkOnQuestion` and `createParkOnQuestion` (`ParkOnQuestionOptions`) are removed: use `askQuestion`, built with `createAskQuestion({ resolve })` (`TaskTurnToolOptions`). `createWaitForUserTool({ resolve })` builds the model's `waitForUser`.
- `answerTask` and its `answerTask_<board>` action are removed: answer with `updateTask({ id, question, message })`.
- `TaskCollectionRef.awaitReview` (`AwaitReviewOptions`) and `unpark` (`UnparkOptions`), `board.unparkAndDrain` (`unparkAndDrainInputSchema`) and a board's `onReview` are removed: ask with `ctx.waitForUser({ kind: "review", prompt })`, which the Inbox answers. A board built with `onReview` is refused, naming it.
- The `parked` status is removed, with `counts.parked`, the `parked-for-review` termination reason, the `parked` notice ending and its `question` field, the `parked` and `awaiting-answer` decline reasons, `refuseWhenParked`, `Task.turnReentries` and `parkedOnQuestion`, the worker input's `answer`, and the `review_requested` change. Stores are reset: no stored `parked` row is read.
- `@flow-state-dev/react`: `BOARD_STATUS_COLUMNS` has no `parked`, and the legacy card status mapping (`awaiting_review`) is gone.

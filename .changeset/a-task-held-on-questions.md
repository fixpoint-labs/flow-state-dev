---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": patch
"@flow-state-dev/core": patch
"@flow-state-dev/harness-manager": patch
"@flow-state-dev/shift-manager": patch
---

A task can be held on a person's questions (FIX-2133). `createTask({ questions })` files a task that stays `pending` until the user has answered each one: a plain string is a question, `{ kind: "confirm", prompt, onNo? }` asks for a yes or a no. A No cancels the task by default (the No and its note are the cancel's reason); `onNo: "continue"` lets the work go on with "No." in its brief. A worker asks midway, questions or confirms, with `askMidway(ctx, board, questions)` from `@flow-state-dev/orchestration/task-board`: its turn ends unsettled with no lease, and once the user answers, the task takes one more turn on the same attempt. Each answer joins the brief. `updateTask({ id, question, message })` (or `done` for a confirm) answers one, and the Inbox client's `answer` and `answerHold` now send questions and confirms through it. A deadline applies only when the host sets `userDeadlineMs`; past it, the question closes with "no answer came" and the work goes on. A line typed in a held task's session answers its oldest open question.

**Breaking:** a task's open holds are listed in `holds`, a `TaskHold` each. A run's stop for a person is one of them (`source.kind: "suspension"`), so `waitingOn: "user"` and `waitingFor` are gone: the row reads `waitingOn: "wait"` and carries the hold. `MAX_WAITING_FOR_PROMPT` and `ROW_HOLD_UNANSWERABLE` are removed. `TaskClaimTicket.turn` is required: every claim advances the row's `turn`, and a ticket from an earlier turn of the same attempt is declined `lost-claim`. New decline reasons `held`, `answered` and `no-such-hold`; new `task-change` kinds `asked` and `answered`; task collection refs gain optional `ask`, `answer` and `payHoldDeadlines`, which both built-in backings implement.

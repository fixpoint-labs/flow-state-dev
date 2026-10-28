---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": minor
"@flow-state-dev/shift-manager": minor
"@flow-state-dev/devtool": patch
"@flow-state-dev/harness-manager": patch
---

Hold now means one thing on the task board: the filer's hold before a start (status `held`, `createTask({ held: true })`, `hold()`, `release()`, unchanged). A task's open asks are its questions, what keeps a running task open is `keptOpenBy`, and a request's right on its task is its claim (FIX-2183). Every rename below is breaking, with no alias.

- **A task's questions.** `Task.holds` and an Inbox item's `holds` are `questions`. `TaskHold`, `RowHold`, `SuspensionHold`, `RowHoldSource`, `SuspensionHoldSource`, `InboxHold` and their schemas are `TaskQuestion`, `RowQuestion`, `SuspensionQuestion`, `RowQuestionSource`, `SuspensionQuestionSource`, `InboxQuestion` (`taskQuestionSchema` and so on). `HoldAsk` is `QuestionInit`, `HoldReleaser` is `QuestionCloser` and `source.releasedBy` is `source.closedBy`, `HoldAnswer` is `QuestionAnswer` and its `hold` is `questionId`, and `MAX_HOLD_PROMPT` is `MAX_QUESTION_PROMPT`. The helpers read *question* for *hold*: `openQuestions`, `hasOpenQuestion`, `openRowQuestions`, `isRowQuestion`, `isSuspensionQuestion`, `suspensionQuestionOf`, `questionsDue`, `nextQuestionDue`, `newRowQuestions`, `questionWrite`, `QuestionChange`, `QuestionWriteResult`, `payQuestionDeadlines`, `questionDueMs`, `questionOfSuspension`, `openUserQuestions`. `setKeptOpenBy`'s `hold` option is `question`.
- **Answering.** `updateTask`'s `question` input is `answers` (`updateTask({ id, answers, message })`), and its `done_without_question` refusal is `done_without_answers`. The Inbox client's `answerHold` is `answerOne`, and `answer`'s `holdId` argument is `questionId`; Shift Manager's `LabData.answerHold` is `answerOne`.
- **Write outcomes.** The decline reason `"held"` (a question is open) is `"open-question"`, and `"no-such-hold"` is `"no-such-question"`. The options `whileHoldOpen` and `refuseWhenHeld` are `whileQuestionOpen` and `refuseWithOpenQuestion`.
- **What keeps a task open.** `Task.waitingOn`, `TaskWaitingOn` and `setWaitingOn` are `keptOpenBy`, `TaskKeptOpenBy` and `setKeptOpenBy`, with the same values. `endRules.filedWorkHolds` and the helpers `filedWorkHolds` and `holdsItsFiler` are `filedWorkKeepsOpen` and `keepsFilerOpen`.
- **The claim and a board's owner.** `heldTask`, `heldTaskId`, `heldRowOf` and `ticketHoldsRow` are `claimedTask`, `claimedTaskId`, `claimedRowOf` and `ticketClaimsRow`; Shift Manager's `holderSessionId` and `holderOf` are `ownerSessionId` and `boardOwnerOf`.

Stores are reset, not migrated: a row written with `holds` or `waitingOn` before this release is not read under the new names.

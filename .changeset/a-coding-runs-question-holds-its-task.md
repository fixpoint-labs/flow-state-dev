---
"@flow-state-dev/harness-manager": minor
---

A coding run's question now holds its task on the board, where the Inbox lists it, and the answer continues the same coding session on the same attempt: an answer spends no retry (FIX-2132). The run's own question, the judge's *ask* and held work that doesn't match its record all ask this way. Answer through the board's `updateTask({ id, answers, message })`, or with a line typed in the run's session; a cancel closes the question and starts nothing.

**Migration.** The manager's question inbox is removed: `askQuestion`, `answerQuestion`, `listQuestions`, `readQuestion`, `withdrawQuestion`, `inboxCollection`, `INBOX`, `questionTopic`, `questionFingerprint`, `parseQuestionTopic`, `HarnessRunParked` and the `QuestionAnnouncement` type. `harnessManager({ announce })` is refused at construction; read held tasks from the board (`openRowHolds` on its rows). `PromptRunContext.answers` is the task's answered questions, oldest first, read from its row. `run.askMarkerPath` is now `.fsdev/ask/<attempt>-<run>.md`, a new path for every run; `askMarkerPath` and `readAskMarker` take the run as a third argument. A phase that hard-codes the old `<attempt>.md` path must use the path it is handed.

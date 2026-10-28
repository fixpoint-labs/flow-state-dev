---
"@flow-state-dev/workforce": minor
"@flow-state-dev/orchestration": minor
---

A person's running turn can hear the tasks that finished while the worker answered (FIX-2159). `defineAgentWorkerFlow({ answerAgain: true })` says each such result in that same request, under the delegate's name, and the worker answers again with it; pass a block instead to change what the worker is told (`finishedTasksAnswerAgain({ message })`, or your own sequencer around `takeFinishedTasks`). The worker's answer after its plan and these share one cap, `MAX_ANSWERS_AGAIN` (3 per request). Orchestration exports `takeOwedNotice`, which takes an owed notice in the running request's name through the same take record `onTaskSettled` uses.

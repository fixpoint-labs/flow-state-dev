---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": patch
---

A turn waiting on another worker's task now says **wait** everywhere; **ask** means only a question to a person (FIX-1876). The old exports are gone, with no alias, so an import of one fails to compile and names it:

- `@flow-state-dev/core`: `ASK_GATE_REASON` → `WAIT_GATE_REASON`, `isAskGate` → `isWaitGate`, `AskGateBinding` → `WaitGateBinding`, `AskOutcome` → `WaitOutcome`, `AskEndingErrorCode` → `WaitEndingErrorCode`, `parkOnAsk` → `parkOnWait`, `ParkOnAskInput` → `ParkOnWaitInput`, `parseAskOutcome` → `parseWaitOutcome`, `recordedAskOutcome` → `recordedWaitOutcome`, `RequestHost.resumeAsk` → `RequestHost.resumeWait`, `RequestHost.hasAskSweeper` → `RequestHost.hasWaitSweeper`, `ResumeAskInput` → `ResumeWaitInput`, `ResumeAskResult` → `ResumeWaitResult`.
- `@flow-state-dev/orchestration`: `resumeOwedAsks` → `resumeOwedWaits`, `askGateId` → `waitGateId`, the task tools' `resumesAsks` option → `resumesWaits`, a row's `Task.ask` → `Task.wait`, `listTasks` marks a waited-on row `waitedOn: true` instead of `asked: true`, and `parkOnQuestion` on a task a turn is waiting on is refused with `waited_on_task` instead of `asked_task`.
- `@flow-state-dev/engine`: the request host's `askResume` → `waitResume` and `askSweeper` → `waitSweeper` (`RuntimeConfig.requestHost`).

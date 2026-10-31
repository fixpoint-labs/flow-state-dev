---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": patch
---

A turn waiting on another worker's task says **wait** (FIX-1876). `@flow-state-dev/core` exports `WAIT_GATE_REASON`, `isWaitGate`, `WaitGateBinding`, `WaitOutcome`, `WaitEndingErrorCode`, `parkOnWait`, `ParkOnWaitInput`, `parseWaitOutcome`, `recordedWaitOutcome`, `RequestHost.resumeWait`, `RequestHost.hasWaitSweeper`, `ResumeWaitInput` and `ResumeWaitResult`. `@flow-state-dev/orchestration` exports `waitGateId`; a row's wait slot is `Task.wait`, and `listTasks` marks a waited-on row `waitedOn: true`. `@flow-state-dev/engine`: the request host's `waitResume` and `waitSweeper` (`RuntimeConfig.requestHost`).

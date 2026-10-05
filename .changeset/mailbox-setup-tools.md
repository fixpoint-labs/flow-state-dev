---
"@flow-state-dev/workforce": minor
---

A coordinator worker can now change mailboxes itself (FIX-1779). `createMailboxSetupCapability({ open, workers })` puts four catalog tools on a worker kind: `setUpMailbox`, `subscribeWorkers`, `unsubscribeWorkers` and `fileTask`. A worker reaches them only by naming them in `tools:`, and the organization is always the caller's. Worker names and `fileTask`'s assignee are looked up with the new `findWorkerByName`, which refuses a name no worker holds and a name two workers hold. `fileTask` refuses an assignee who does not work the list, and records the calling worker as `filingWorker` on the task. `openMailboxAtRunTime` gains `fileTask`, the door the tool files through.

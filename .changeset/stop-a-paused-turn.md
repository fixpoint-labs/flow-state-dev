---
"@flow-state-dev/contracts": minor
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/orchestration": patch
"@flow-state-dev/react": patch
"@flow-state-dev/devtool": patch
---

Stopping a paused request now ends it `aborted` and records its gate with the new `stopped` suspension status, and a turn paused on an ask cancels the asked task instead of waiting for it (FIX-1816).

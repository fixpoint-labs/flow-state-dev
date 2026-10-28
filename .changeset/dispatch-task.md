---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": minor
"@flow-state-dev/core": minor
---

A board can start work on another worker now: on a board that dispatches (a Workforce conversation's, or one built with `{ dispatches: true }`), a task is handed over as soon as it is filed, and one filed held waits until it is released. Filing a task never waits: it refuses `waitForResponse` and `timeoutMs` by name. The wait names are renamed with no alias (`canHoldAsk` → `canHoldWait`, and the rest of the `Ask` names to `Wait`) (FIX-1875).

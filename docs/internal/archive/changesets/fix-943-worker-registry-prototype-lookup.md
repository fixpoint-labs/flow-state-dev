---
"@flow-state-dev/orchestration": patch
---

Fix `dispatchAndExecute`'s worker-registry lookup so a task assigned to a prototype-named worker (e.g. `"constructor"`, `"toString"`) is rejected with the usual "no worker registered" error instead of resolving to an inherited `Object.prototype` member.

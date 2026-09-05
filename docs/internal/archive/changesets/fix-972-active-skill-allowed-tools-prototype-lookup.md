---
"@flow-state-dev/orchestration": patch
---

Fix the `allowed-tools` union for active skills so a skill named after an `Object.prototype` member (e.g. `"constructor"`, `"hasOwnProperty"`) now behaves exactly like a skill that declares no `allowed-tools`, instead of crashing skill activation with `TypeError: list is not iterable`.

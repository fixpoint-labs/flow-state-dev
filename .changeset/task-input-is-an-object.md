---
"@flow-state-dev/orchestration": minor
---

`createTask` now takes `input` as a JSON object. A string, number or array is refused at the tool's schema, so a model that would have sent the payload as a JSON string is told to send the object instead (FIX-1965).

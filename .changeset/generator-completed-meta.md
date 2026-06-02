---
"@flow-state-dev/core": minor
---

Generator `onCompleted` callbacks now receive a third `meta` argument carrying `{ model: ModelIdentity }` — the resolved identity of the model that produced the output. Use it to project completion-time runtime data into session, request, or user state without reaching into framework internals.

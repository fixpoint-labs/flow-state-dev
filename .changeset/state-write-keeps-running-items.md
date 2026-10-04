---
"@flow-state-dev/engine": minor
---

`RequestStore.set` must now keep the stored items when a record leaves `items` off, which the request-state write now does so a mid-run state change no longer drops the items persisted since the run started, and a custom store that keeps items on the record and replaces it whole has to add this (FIX-1735).

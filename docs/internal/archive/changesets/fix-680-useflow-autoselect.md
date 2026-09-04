---
"@flow-state-dev/react": patch
---

`useFlow` gains an `autoSelectSession` option (default `true`). Pass `false` when the consumer drives session selection itself (e.g. keying the active session off input metadata) so the hook doesn't auto-load the most-recent session on mount. `selectSession` now also accepts `undefined` to clear the active session.

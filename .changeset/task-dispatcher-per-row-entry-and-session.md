---
"@flow-state-dev/core": minor
"@flow-state-dev/orchestration": minor
---

A task board's dispatcher can now choose its entry and its session for each row (FIX-1872). Give a `task` dispatcher an `action` of `{ among, by }` and `by` picks, per row, one of the entries listed in `among`; every listed entry is checked when the flow is defined, and an answer outside the list fails that row with `no-entry`. Give it a `session` of `{ by }` and it answers, per row, `{ key }` for a child session or `{ id }` for a session that already exists. An existing session is delivered into and never created: a missing one, or one the running user can't reach on this flow, fails the row with `session-not-found` or `session-not-addressable`. A string `action` and the `"per-task"`, `"per-worker"` and `{ key }` policies behave as before.

---
"@flow-state-dev/orchestration": minor
---

Skill activation can no longer be stored at org scope (FIX-1153).

`activeState.scope` narrows from `"request" | "session" | "user" | "org"` to
`"request" | "session" | "user"`, and the binding config's runtime schema
rejects `"org"`. Org scope state is gone, so the option could only read empty
and throw on write. Store shared activations at `session` or `user` scope.

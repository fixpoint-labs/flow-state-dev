---
"@flow-state-dev/core": patch
---

Remove `webhooks`, `chat`, `schedules`, and `mcp` from `FlowInstanceOptions`.
The four type-checked as per-instance overrides and were never read: the flow
instance always carried the definition's values, so `flow({ webhooks })`
compiled clean, looked configured, and did nothing. Every sibling option on the
same object (`session`, `user`, `org`, `work`, `tools`, `voice`, `tokenCounter`,
`costEstimator`, `isolateUserState`, `isolateOrgState`) does apply.

Declaring these four on `defineFlow(...)` is unchanged and remains the supported
way to configure them. Only the instance-level call site is affected, and only
where it never worked — passing one is now a compile error, and a caller that
reaches past the types gets a thrown error naming the option instead of silence.

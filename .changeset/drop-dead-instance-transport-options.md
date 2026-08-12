---
"@flow-state-dev/core": minor
---

**Breaking:** Removed `webhooks`, `chat`, `schedules`, and `mcp` from the options
you can pass when creating a flow instance (FIX-1048). The four type-checked and
were never read — `flow({ webhooks })` compiled clean, looked configured, and did
nothing.

Declare all four on `defineFlow(...)` as before; that path is unchanged. Passing
one to the instance no longer compiles, and a caller that reaches past the types
gets a thrown error naming the option instead of silence.

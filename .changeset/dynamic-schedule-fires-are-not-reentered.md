---
"@flow-state-dev/engine": patch
---

A dynamic schedule's fire is never run again, because its handler isn't stored (FIX-2895). Retry, continue and resume refuse it with `404`, like any request they won't re-enter, and a session's request list marks it `retryable: false`; a retry used to answer `202` and then crash a Node host, and `/continue` answered `409`. A dynamic fire also can't stop or wait: `ctx.suspend()` and its user stops fail the fire before anything is held, and waits answer `wait_unavailable`. Before, such a fire parked and an answer was accepted, but it never ran again. Declare a schedule under `schedules.static` when its fires stop or wait.

Docs: apps/docs/docs/reference/http-api.md and apps/docs/docs/reference/durable-execution.md (the dynamic scheduled dispatch refusal is `404`, and applies to retry and resume too), and the scheduled actions page (a dynamic schedule's fires can't stop or wait)

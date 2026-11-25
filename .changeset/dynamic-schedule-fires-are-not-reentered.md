---
"@flow-state-dev/engine": patch
---

A failed or interrupted fire of a dynamic schedule can no longer be retried, continued or resumed through the public routes: each answers `404`, like any request they won't re-enter, and a session's request list marks it `retryable: false` (FIX-2895). A retry used to answer `202` and then crash a Node host; `/continue` answered `409` and now answers `404`.

Docs: apps/docs/docs/reference/http-api.md and apps/docs/docs/reference/durable-execution.md (the dynamic scheduled dispatch refusal is `404`, and it applies to retry and resume too)

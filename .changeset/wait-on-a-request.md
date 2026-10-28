---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
---

`waitOnRequest(ctx, { requestId, gateId, planKey, deadlineMs?, deadlineAt?, message? })` is exported from core: it parks the running request on the wait gate until another request ends or the deadline passes, the half of `dispatcher({ wait: true })` that waits (FIX-2239). `RequestHost.waits.userStop()` returns the request of the running session parked for a person, if any; the engine implements it. A request's end now also resumes waits in its own session that are bound to it, when the run that ended it had resumed it.

---
"@flow-state-dev/claude-code": patch
---

`runClaudeHeadless`'s `timeoutMs` now bounds the run itself, not just loading
the SDK (LAB-66). The deadline was armed before resolution, but once execution
reached the message loop the ceiling went back to being cooperative: it aborted
the signal and then *waited* for the SDK's iterator to reject. An iterator that
ignores `abortController` — an injected one, or an SDK wedged on a subprocess
that stopped reading its signal — hung the call forever, and one that eventually
yielded a successful result after the timer had fired was reported as `ok: true`,
so a run that blew its budget by an hour reached the caller's ledger as a normal
completion.

The loop is now stepped against the deadline, so the call leaves on time either
way. Leaving means abandoning a live agent, so it first makes a real attempt to
stop it: the run is aborted, and the stream is `close()`d when the SDK offers
that (`query()`'s handle does). The failure reason distinguishes the two
outcomes — a stopped run reads "…and was stopped", an abandoned one "…was
abandoned before it acknowledged the stop, so the agent may still be running",
so a possible leak is named rather than silent.

`costUsd` and `usage` were documented as reported on failed runs; that holds
only for a run that reached a terminal `result`. A timeout or a mid-stream throw
returns `null` for both even though tokens were spent. The docs now say so
instead of promising the case they miss.

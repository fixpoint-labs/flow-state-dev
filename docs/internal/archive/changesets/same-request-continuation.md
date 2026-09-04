---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/store-sqlite": patch
---

Resume now continues the same request instead of spawning a new linked one. Resolving a suspension re-enters the original request id: already-completed blocks are replayed from the durable item log rather than re-run, the resolving `ctx.suspend()` returns the resume payload, and the record transitions `suspended → in_progress → terminal` in place. A `GET` returns the full pause→continue history (pre-suspension items + `suspension` + `suspension_resume` + post-resume items) on one record, with no orphan second request.

- **`continueRequest()` / `host.continueRequest()`** — the same-id re-entry path the resume route now uses (replacing the new-request dispatch). Rebuilds the live SSE stream and the active-request heartbeat under the same id and runs in replay mode.
- **Per-gate resume matching** — `ctx.suspend()` returns the resume payload only at the gate whose logical path matches the one being resolved; every other gate re-suspends. Multi-gate and loop-iteration flows now resume one gate at a time, with no shared "consumed" flag.
- **Log-as-source-of-truth replay** — completed blocks are injected by logical path via the `ReplayLog`; the positional step-index skip is removed. A replayed block runs no body, emits no duplicate trace, and is still queryable via `ctx.getBlockOutput()`.
- **Append/merge-by-id item persistence** — `persistItems` is now a documented merge-by-id contract, so a continuation persists only its post-resume items while reads return the full ordered log.
- One commit boundary: a failure before the `suspended → in_progress` transition leaves the request resumable; after it, failures are durable.

Known limitation: a durable sequencer **nested** inside another that carries its own accumulator state across the suspension does not yet have that nested state restored on resume (the root sequencer's state and all block outputs do). Tracked as a follow-up.

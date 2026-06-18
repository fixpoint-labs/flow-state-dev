---
"@flow-state-dev/core": minor
"@flow-state-dev/server": minor
"@flow-state-dev/client": minor
"@flow-state-dev/react": patch
---

Crash recovery now continues the same request, and resumed-request history reads back deduplicated.

- **Continue an interrupted request under its own id.** A new `POST /:flowKind/sessions/:sessionId/requests/:requestId/continue` endpoint (and `recoveryClient.continue(...)`) re-enters a crash-`interrupted` request in place: completed blocks replay from the durable item log and the in-flight block re-runs, transitioning `interrupted → in_progress → terminal` under the same id. The stale sweeper still only *marks* records `interrupted`; continuing is the explicit, client-driven action. `retry` (a fresh run under a new id) is retained unchanged as the separate "start over" mode.
- **Canonical item-log view.** A resumed request's suspending block re-runs from the top of its body, so any items it emitted before `ctx.suspend()` (e.g. a human-in-the-loop approval prompt) are re-emitted with fresh ids. The physical log keeps both copies for forensics; the new `collapseToCanonicalLog` read helper drops the superseded run-1 copies, keyed by logical block ownership. `GET` history, `useSession`, and the empty-cursor SSE replay seed now route through it, so each emission shows once. The append-only SSE event wire is unchanged (still strictly `sequence_number`-ordered; dedup happens at items-record reconstruction).
- **Replay drives both continuation shapes.** Suspension resume (with a resolving gate) and crash recovery (no gate) share one replay path; crash recovery emits no `suspension_resume` audit item.
- **Canonical dedup covers crash recovery too.** Because crash recovery re-runs the in-flight block with no `suspension_resume` marker, `collapseToCanonicalLog` now also supersedes a re-run's run-1 emissions via the second `block_trace` on the logical path (its index marks where the surviving run began), not only via resolved suspensions. A block that ran once — including a completed block injected from the log on replay — is left untouched.
- **Pre-transition lease release on crash recovery.** A failed `continue` setup (before the `interrupted → in_progress` transition) now releases the continuation lease even though there is no suspension to revert, so the next `continue` isn't blocked until the 60s TTL. Previously only the resume path released it.
- **Cross-store coverage.** The `RequestStore` conformance suite gains a same-request item-persistence case (the full ordered log survives an append), run on in-memory and the persistent adapters.

Known limitation (unchanged): a durable sequencer **nested** inside another that carries its own accumulator state across the boundary does not yet have that nested state restored on crash-recovery continuation (the root sequencer's state and all block outputs do).

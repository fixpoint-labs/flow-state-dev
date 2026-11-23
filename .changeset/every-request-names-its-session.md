---
"@flow-state-dev/contracts": patch
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/client": minor
"@flow-state-dev/react": minor
"@flow-state-dev/mcp": patch
"@flow-state-dev/bullmq": patch
---

Every request names its session, from the first write of its record (FIX-2907). The engine no longer makes up a session for a run that names none.

- **Breaking: a send needs a session id.** `client.flow(f).send(action, input, { sessionId })` and `useAction`'s `execute(input, sessionId)` require it, and so does `runAction` (`sessionId`) and a custom transport's `host.dispatch` envelope. An HTTP send with none is refused `400 { error: "session-required" }` before anything is written, and the route stays registered; `runAction`, `createExecutionContext` and `host.dispatch` throw `SessionRequiredError` (from `@flow-state-dev/engine/host`). Pass the conversation's id (`client.flow(f).createSession()`), or, for a one-shot send, `oneOffSessionId()` from `@flow-state-dev/core/helpers`: the same one-off run as before, folded under "One-off runs" in the navigator.
- **No behaviour change for runs with no conversation.** A webhook binding that names no session, a `per-fire` schedule fire and an MCP `tools/call` with no session directive still run in a fresh one-off session; the webhook route, the scheduled endpoint and the MCP adapter now make its id before they dispatch, so the request record and its gates name it. A one-off webhook session is born with `metadata.source: "webhook"` like a named one.
- **Requests recorded with no session before this release** stay readable and stoppable (a stop settles a parked one `aborted`). Running one again is refused by name: a resume, continuation, retry or wake answers `legacy-sessionless-request` (`409` over HTTP), and a queued BullMQ job with no session is settled failed under `LegacySessionlessRequestError` and not retried.
- `ConcurrencyKeyContext.sessionId` is now always set.

Docs: apps/docs/docs/client/overview.md (`send` takes a session id and how to get one; drop the "no session" sentences), apps/docs/docs/fundamentals/state-and-scopes.md (the "sent without a session id" line under the create check: such a send is refused), apps/docs/docs/server/connection-resilience.md (the snapshot's `sessionId` is absent only on a request recorded before sessions were required), apps/docs/docs/server/mcp.md and apps/docs/docs/server/scheduled.md (a one-off run gets a fresh session made for it, no behaviour change), packages/client/README.md and packages/react/README.md (`sessionId` on `send` and `execute`)

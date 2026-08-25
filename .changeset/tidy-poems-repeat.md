---
"@flow-state-dev/engine": patch
"@flow-state-dev/core": patch
---

Background work now settles before a request reports a terminal status, whatever the outcome (FIX-1001).

A request that queued work with `.sideChain()`, `.sideChainIf()`, or `.forEachSideChain()` already waited for it when the action succeeded. When the action threw, the user hit stop, or the client disconnected, the request wrote its terminal record and returned with those tasks still running. On ephemeral hosts (Vercel, Next.js `after()`, Lambda) the platform can freeze the container as soon as the request returns, so a task still writing at that point could be cut off mid-write — a user cancelling a long answer was enough to lose a memory capture.

The request now waits on every terminal path, and keeps draining until no queued task is left, so a background task that queues more background work is awaited too.

Two consequences worth knowing:

- A non-streaming caller that `await`s a failing request now waits for that request's background work, the same bill the success path already paid. Streaming clients are unaffected — the error item is emitted before the wait.
- Stopping a request while it is waiting on background work is honoured: it settles as `aborted` rather than `failed` or `interrupted`, and the returned result carries no `error`, matching the record. The error item already delivered to the stream is kept, so a client that saw the failure still sees it.
- Work queued from `onFinished` or `onErrored` is not covered, because those hooks run after the terminal record is written. Do durable work inline in those hooks rather than dispatching it with `.sideChain()`. `onCompleted` runs before finalization and is covered.

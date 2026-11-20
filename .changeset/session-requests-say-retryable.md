---
"@flow-state-dev/engine": patch
"@flow-state-dev/client": patch
---

A session's request list says whether the server runs each request again when the caller retries it (FIX-2853).

- **engine:** each entry of `GET /sessions/:sessionId/requests` carries `retryable`, the retry route's own rule with the host's `publicReentrySources`: the same answer a session's turns carry. A request a notification started is `false`, so a screen offers no Retry that the server would refuse.
- **client:** `SessionRequestSummary.retryable?: boolean`, so `useSession`'s `latestRequest` carries it. Absent from a server that predates it; read absent as not retryable.

Docs: apps/docs/docs/api/client.md (the `SessionRequestSummary` fields)

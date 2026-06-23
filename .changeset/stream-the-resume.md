---
"@flow-state-dev/client": minor
"@flow-state-dev/react": minor
"@flow-state-dev/devtool": patch
---

Stream the resume so a resolved suspension renders live, without a page refresh.

Resolving a durable-execution suspension (approve/reject) was fire-and-forget: a
non-streaming `POST` returned `202` and the resumed continuation ran detached, so
its output only appeared after a manual refresh. On serverless (no shared
pub/sub) a separate GET reconnect couldn't reach the in-flight continuation at
all, so the UI sat on the pre-resume state for the whole run.

The resume now streams, mirroring `sendAction`'s inline-streaming path:

- `@flow-state-dev/client`: new `recoveryClient.resumeSuspensionStream(...)` —
  POSTs the resolution with `Accept: text/event-stream` and returns the raw
  `Response` whose body is the continuation's SSE stream (falls back to `202`
  JSON when the server doesn't stream).
- `@flow-state-dev/react`: `useSession()` gains `resumeSuspension(...)`, which
  streams the continuation straight into `session.items`. `useSuspensions()`'s
  `approve`/`reject` now resolve through it. A new `<SuspensionResolverProvider>`
  bridges that streaming resolver to the inline default `<ApprovalRenderer>`, so
  the standard chat view updates live with one provider line (the card falls back
  to a non-streaming resume when no provider is mounted).
- `@flow-state-dev/devtool`: the Suspensions tab consumes the streaming resume's
  SSE response inline, so the resumed run follows to terminal live on serverless
  instead of stalling until a refresh.

`useSuspensions().approve`/`reject` now resolve to `void` (the continuation
streams in via `session.items`) rather than returning the resume result.

---
"@flow-state-dev/client": patch
"@flow-state-dev/react": patch
---

A request's stream that ends before the request does is picked up again instead of leaving the view hanging (FIX-2675).

- **client:** `request(id).stream()` resumes after the last event it delivered when the server ends the stream with no terminal `request.*` status (the server cuts off a reader that falls 4 MiB behind). It reconnects at once after a connection that delivered events, backs off (1 s, doubling) after one that delivered nothing, and gives up with `onError` after five such connections in a row. An error answer such as a 404 or 409 is reported with `onError` and not retried, and a local `close()` stops it.
- **react:** when the inline stream of a turn `useSession` sent ends with no terminal status, the hook follows the request on `request(id).stream()` from the last event it applied, so the turn finishes with every item once rather than staying "streaming" until `isStuck`. A turn the caller stopped is not picked up again.

Docs: apps/docs streaming / resume page (request streams resume themselves after an early end; `createSSEClientFromResponse` callers resume with `request(id).stream({ startingAfter })` from `onClose`), packages/client and packages/react READMEs if they describe stream ends.

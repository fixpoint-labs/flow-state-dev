---
"@flow-state-dev/client": patch
---

Route `request.suspended` SSE events to `onRequestStatus`. The stream client's status dispatcher recognized every terminal/lifecycle status except `suspended`, so a request that paused at a `ctx.suspend()` gate streamed its suspension but the client never saw the status change — `useSession` (and the DevTool) stayed on "in progress" and never surfaced the approval for resume. The client now delivers `request.suspended` like the other status events.

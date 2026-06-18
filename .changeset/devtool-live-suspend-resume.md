---
"@flow-state-dev/devtool": patch
---

DevTool now reflects the full suspend/resume/recovery lifecycle live, without manual refreshes:

- The request-stream hook's status handler ignored `request.suspended` (and `interrupted` / `aborted`), so a request that paused at a `ctx.suspend()` gate stayed on the "in progress" badge. It now maps those to the matching status and stops the live spinner.
- The chat view derived a request's status from the session-requests list snapshot (which only refetches on terminal/refresh) for any request already listed, so live transitions on the watched request didn't show. The live stream is now authoritative for the request it's watching — covering every transition (in_progress → suspended, then in_progress → completed across a resume).
- Resolving a suspension (approve/reject) posted the resume but never re-attached the panel's stream. The Suspensions view now hands the resumed request id back to the panel, which re-subscribes to the same-id continuation and follows it to completion.
- The interrupted-request "Resume" button started a fresh request via retry (new id). It now continues the same request under its own id (the FIX-811 crash-recovery path), re-attaching the stream to follow it to terminal.

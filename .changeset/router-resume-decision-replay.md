---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
---

A suspension inside a router's chosen branch now resumes the same branch. The router dispatches its selected child through the replay seam, so completed work inside a suspended branch replays from the durable log instead of re-executing, and the router's pass-through `ref` output survives resume. On continuation the re-run selector is validated against the recorded router decision — a mismatch (re-decision drift or a removed route) fails with the new `RouteUnavailableError` instead of silently switching branches. The decision record is now awaited before the branch dispatches, closing a race where a suspension could persist before its decision anchor. Two different blocks sharing a route name are rejected when the router is built (listing the same block under multiple aliases stays legal); a router whose branch can suspend needs a pure `execute` selector. Because routed children now dispatch like sequencer children, a route block's `.rescue()` handlers actually run in-flow (they were silently ignored before), and a `transient: true` route block's trace is now treated as transient (streamed, not retained).

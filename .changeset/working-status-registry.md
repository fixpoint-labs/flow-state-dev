---
---

The UI registry gains `working-status` (`fsdev ui add working-status`), two pure helpers for the live line at the end of a running background task's feed (FIX-2527). `toolInFlight(items)` finds the newest tool call that hasn't returned. `workingStatus({ inFlight, plan, note })` returns the most specific status it has: that call ("Running pnpm test", or what the call says it is doing), then the plan step in progress ("Step 3 of 5: Add regression test"), then the task's last progress note. With none of them it returns `undefined`. Pass the result to `StreamingIndicator` as `message`, with `since` for the elapsed clock.

Docs: apps/docs/docs/ui/common-components.md (a section on what a running task is doing now, after Streaming Indicator); packages/ui/README.md (a `working-status` row in the component table)

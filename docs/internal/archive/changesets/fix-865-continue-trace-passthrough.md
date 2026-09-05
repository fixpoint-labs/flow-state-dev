---
"@flow-state-dev/engine": patch
"@flow-state-dev/client": patch
---

Thread `includeTrace` through the crash-recovery `/continue` route so a caller can opt an inline SSE continuation into trace-channel items (`block_trace`/`router_decision`/`state_snapshot`), the same way the GET stream route's `?include=trace` already does. `RecoveryClient.continueStream({ includeTrace: true })` appends the query param; the DevTool's per-row Continue action now always requests it so its Trace tab can show what ran in the resumed portion. Default (omitted) behavior is unchanged — filtered, client-visible-only events.

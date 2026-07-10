---
"@flow-state-dev/client": patch
---

Add `RecoveryClient.continueStream()`, the streaming sibling of `continue()`. It POSTs to the same `/continue` route with `Accept: text/event-stream` and returns the raw `Response`, so callers can read the continuation's SSE stream directly from the POST body — matching `resumeSuspensionStream()`'s inline-streaming approach for serverless deployments without shared pub/sub.

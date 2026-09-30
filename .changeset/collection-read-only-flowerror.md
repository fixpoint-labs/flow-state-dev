---
"@flow-state-dev/engine": patch
---

A resource collection declared `writable: false` now refuses writes with the same non-retryable `FlowError` (`code: "resource_read_only"`) as a single resource, so a retry-configured block no longer re-runs on a collection refusal. The error messages are unchanged (FIX-1519).

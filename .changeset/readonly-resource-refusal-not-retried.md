---
"@flow-state-dev/engine": patch
---

A write to a resource marked `writable: false` is now a terminal `FlowError`. Retry-configured blocks no longer re-run that refusal or replay side effects they already performed (FIX-1265).

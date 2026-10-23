---
"@flow-state-dev/engine": patch
---

A resumed or continued request no longer runs its completed steps again when trace observability is off, as it is by default in production. Each completed block now records a lean `block_trace` (its identity and output only) whatever the observability setting, and resume replay reads that record to skip the block. Full capture (inputs, generator prompts, resource loads, failed traces) is still gated by `FSDEV_TRACE_OBSERVABILITY`. With observability off, a request's item log now holds one `block_trace` per completed, non-transient block (FIX-2137).

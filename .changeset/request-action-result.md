---
"@flow-state-dev/engine": patch
"@flow-state-dev/client": patch
"@flow-state-dev/devtool": patch
"@flow-state-dev/fsdev": patch
---

Each request's record now stores its action result (`output` as JSON, and/or `error`) with its final status, `listSessionRequests` returns it (the output with `includeResultOutput`), the DevTool task row reads it instead of reconstructing it from traces, and a run a completion hook failed after the action answered now reports that answer as `output` (including `fsdev run`'s result, where it was `null`) (FIX-1661).

---
"@flow-state-dev/engine": minor
---

Remove the unused `maxConcurrentStreams` and `staleStreamTtlMs` options from `createFlowApiRouter` and `createFlowRouteHandlers`. Live tail is owned by the store; those knobs had no effect after the per-process stream registry went away (FIX-1210).

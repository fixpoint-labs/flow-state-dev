---
"@flow-state-dev/engine": patch
"@flow-state-dev/client": patch
---

`POST /api/flows/users/:userId/check-interrupted` no longer lets a caller's `staleThresholdMs` shorten the server's own stale threshold. The route now uses the larger of the two, so a value of zero, a negative value, or anything below `staleSweepThresholdMs` sweeps exactly as leaving it out does, and a request that is still heartbeating is never marked `interrupted`. A larger value still lengthens the window as before. A value that is not a number is still rejected with 400. To sweep sooner, lower `staleSweepThresholdMs` on the server. Calling `createRecoveryClient().checkInterrupted({ staleThresholdMs })` follows the same rule (FIX-1571).

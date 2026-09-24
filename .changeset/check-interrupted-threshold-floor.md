---
"@flow-state-dev/engine": patch
"@flow-state-dev/client": patch
---

`POST /api/flows/users/:userId/check-interrupted` and `createRecoveryClient().checkInterrupted({ staleThresholdMs })` now use the larger of the caller's `staleThresholdMs` and the server's `staleSweepThresholdMs`, so a smaller, zero, or negative value sweeps as if it were left out and a request that is still heartbeating is never marked `interrupted` (to sweep sooner, lower `staleSweepThresholdMs` on the server) (FIX-1571).

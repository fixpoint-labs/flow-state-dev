---
---

FIX-954 (Phase 1, step 0): extracted the shared opaque-reason classifier (`classifyOpaqueReason`) into the private `@flow-state-dev/trading-desk` example's `etf-look-through.ts` domain leaf, beside its exported reason constants, and rewired `classifyOpaqueFunds` to call it — a pure move with no output change (parity-tested). No publishable package surface changes.

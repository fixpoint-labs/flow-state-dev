---
"@flow-state-dev/workforce": patch
---

`createSeatHireCapability` adds catalog `hire` and `fire` on the existing mint, and `createWorkforceCapability({ hiredRoster })` lets Discover list those runtime hires (FIX-1525, FIX-1526). Hire refuses to register a seat without an owner pin `{ orgId, userId? }` from the hire row's roster owner (FIX-1529 / F2-PLAN).

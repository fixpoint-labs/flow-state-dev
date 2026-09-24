---
"@flow-state-dev/workforce": patch
---

Added `createSeatHireBlocks(options)`, returning the seat-hire sequence's `hire` and `fire` handlers with no model in front of them — the same two handlers `createSeatHireCapability` mounts as catalog tools, for a caller that wants to dispatch `hire` (or `fire`) directly from an action (FIX-1500).

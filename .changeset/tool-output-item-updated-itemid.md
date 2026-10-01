---
"@flow-state-dev/core": patch
---

A tool's `item.updated` event, sent when it completes or fails, is now keyed by `itemId` like every other stream, instead of `id` (FIX-1681).

---
"@flow-state-dev/workforce": patch
"@flow-state-dev/shift-manager": patch
---

A coordinator's routing record now carries `answeredItself: true` when its own turn answered the post and tried no delegate. Shift Manager draws no "routed" note for such a record, so a reply the coordinator answered itself no longer ends with "the coordinator handed it to no delegate". The note still shows when the post went to a worker, when a worker was tried and missed, and when a round's delegates never answered (FIX-2488).

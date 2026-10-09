---
"@flow-state-dev/core": minor
---

`defineFlow` now throws when the flow's own `resources` map declares an accessor a block also declares, with a different `defineResource()` reference. The flow's entry used to win silently, so the block read and wrote a resource it never declared. Use the block's reference, or pick a distinct accessor key (FIX-1586).

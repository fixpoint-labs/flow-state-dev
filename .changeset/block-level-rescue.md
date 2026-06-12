---
"@flow-state-dev/core": minor
---

`.rescue()` is now a method on every block, not just sequencers. Call `someBlock.rescue([{ when, block }])` to get a block that recovers from its own failure — when it throws, the first matching handler runs (with the block's own context, so it can read sequencer state) and its output is returned in place of the throw. Put it on a single step and the chain continues to the next step; put it on one `forEach` element, `parallel` branch, or `router` route and that unit fails in isolation while the rest proceeds. The existing chain-level `sequencer.rescue()` is the same operation applied to a whole sequencer.

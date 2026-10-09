---
"@flow-state-dev/workforce": patch
---

A coordinator's `handOff` tool now tells the model that a new message is a new post, even when it repeats an earlier ask, so a coordinator no longer declines to hand a repeated ask to the delegate that took it before (FIX-1826).

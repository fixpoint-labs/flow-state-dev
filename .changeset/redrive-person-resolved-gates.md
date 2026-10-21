---
"@flow-state-dev/engine": patch
---

A turn whose approval (or rejection, form submission or skip) was recorded but whose process died before the turn continued is now carried on by the durability sweep with that recorded answer, instead of staying paused forever (FIX-1850).

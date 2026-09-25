---
"@flow-state-dev/core": patch
---

`utility.intentRouter` now keeps a category handler's own `connectInput`, applying it to the router's original input instead of dropping it (FIX-1558).

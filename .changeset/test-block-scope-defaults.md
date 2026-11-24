---
"@flow-state-dev/core": patch
"@flow-state-dev/testing": patch
---

Stand-alone `testBlock` runs now fill missing session, user and org state fields from the defaults declared by the block, its children and their capabilities, just as a registered flow does (FIX-2576).

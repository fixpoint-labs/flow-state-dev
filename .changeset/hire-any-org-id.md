---
"@flow-state-dev/workforce": patch
---

`seatAddress` now accepts any non-empty organization id, including `__fsd_default_org__` and ids like `org_acme`, by percent-escaping it the way the user segment already is; ids of lowercase letters, digits and `-` keep their existing addresses. `@flow-state-dev/workforce/browser` also exports `seatAddress` (FIX-1757).

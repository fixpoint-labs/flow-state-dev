---
"@flow-state-dev/workforce": patch
"@flow-state-dev/core": patch
---

`seatAddress` now accepts any well-formed organization id, including `__fsd_default_org__` and ids like `org_acme`, by percent-escaping it the way the user segment already is (ids of lowercase letters, digits and `-` keep their existing addresses), and `@flow-state-dev/workforce/browser` also exports `seatAddress`. `isValidOrgId` now refuses an id containing a lone UTF-16 surrogate (FIX-1757).

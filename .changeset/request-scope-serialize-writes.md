---
"@flow-state-dev/engine": patch
---

Request-scope state writes now serialize through the per-scope lock before persisting, so a wide same-process fan-out no longer throws ConcurrentModificationError. Session, user, and org scopes still use CAS.

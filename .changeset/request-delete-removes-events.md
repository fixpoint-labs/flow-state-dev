---
"@flow-state-dev/engine": minor
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
---

Deleting a request (including through session retention) now also removes its events and runOnce results once its run has finished, and custom `RequestStore`s must persist `finalizedAtMs`/`heartbeatsUntilFinalized`, honor `setFieldsIfStatus`'s new `expectedIncarnation` argument, and call `isStillAuthorized` in live tails (FIX-1647).

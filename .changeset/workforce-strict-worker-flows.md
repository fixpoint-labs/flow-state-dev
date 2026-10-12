---
"@flow-state-dev/workforce": patch
---

A `defineFlow(...)` worker flow passed in `workerFlows` now typechecks in an app compiled with `strict: true`; it was refused with TS2322 before. The routing record of a best-fit post that nobody took, after the coordinator's own turn failed too, now carries `fit` with why best fit missed (FIX-1909, FIX-1912).

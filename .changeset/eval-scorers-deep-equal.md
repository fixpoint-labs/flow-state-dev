---
"@flow-state-dev/testing": patch
---

Eval scorers `exactMatch` and `jsonPath` now use the framework's structural `deepEqual` helper instead of `JSON.stringify` comparison, so key order and other JSON-shaped values compare correctly.

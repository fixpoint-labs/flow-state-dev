---
"@flow-state-dev/core": patch
"@flow-state-dev/testing": patch
---

Eval scorers `exactMatch` and `jsonPath` compare values with stable JSON serialization (sorted object keys) instead of raw `JSON.stringify`, fixing false mismatches on key order while preserving JSON equality semantics for optional fields and non-plain outputs. `stableStringify` is shared from `@flow-state-dev/core/helpers`.

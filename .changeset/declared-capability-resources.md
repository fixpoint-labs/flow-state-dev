---
"@flow-state-dev/core": patch
---

Capability helper factories infer resource handles from their `resources` declarations (FIX-1580). View input types reflect the input schema before parsing, so callers can omit fields with schema defaults.

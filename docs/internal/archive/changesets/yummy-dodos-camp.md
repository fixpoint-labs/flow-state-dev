---
---

Kitchen-sink: add a `persistedSelectedModelSchema` that coalesces stale persisted model ids before enum validation, and coerce stale ids at generator read time so removed catalog models fall back to the default instead of reaching the model resolver. Internal reference-app change only.

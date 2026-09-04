---
"@flow-state-dev/store-sqlite": patch
---

Implement the `patchField` / `incField` / `pushToArray` delta verbs so single-field scope-state writes mutate only the targeted field instead of rewriting the whole record. All four SQLite stores pick them up automatically.

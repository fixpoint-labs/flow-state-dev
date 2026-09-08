---
"@flow-state-dev/engine": patch
---

Resource state writes now reject whole-row Zod `.catch()` fallbacks on the write path (FIX-1264), including when the catch sits under `.nullable()` / `.default()` / `.readonly()`, leaving the stored row untouched instead of persisting the schema fallback.

---
"@flow-state-dev/engine": patch
---

Resource state writes now reject consecutive top-level Zod `.catch()` fallbacks on the write path (FIX-1264), leaving the stored row untouched instead of persisting the schema fallback.

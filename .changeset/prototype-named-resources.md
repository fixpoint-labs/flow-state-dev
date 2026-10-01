---
"@flow-state-dev/engine": patch
---

A resource whose name or `ref` matches a built-in object member (`__proto__`, `toString`, `constructor`, …) now seeds its default state and content, reads back what was stored, and writes without failing on its version. Previously its default was skipped and `patchState` threw `expectedVersion ... received NaN` (FIX-1254).

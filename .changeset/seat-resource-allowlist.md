---
"@flow-state-dev/workforce": minor
---

A `WORKER.md` can declare `resources:`, the documents that seat may touch — naming one grants read, `rw` grants write — and the app supplies its documents through a new `documents` option on `hireWorkforce` (FIX-1381).

Migration: `resources` is now read by the hire step rather than passed on as a setting, so a worker kind that declared a `resources` setting of its own no longer receives an authored one. A seat that declares no `resources:` key keeps the reach it has today.

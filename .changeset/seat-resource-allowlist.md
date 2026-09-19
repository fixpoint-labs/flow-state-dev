---
"@flow-state-dev/workforce": minor
---

A `WORKER.md` can declare `resources:`, the documents that seat may touch — naming one grants read, `rw` grants write. The app supplies its documents through a new `documents` option on `hireWorkforce`, and each seat is minted with a map narrowed to what its own file names; the app's other flow-level resources are untouched. A seat that declares no `resources:` key keeps the reach it has today. `resources` is now read by the hire step rather than passed on as a setting, so a kind that declared a `resources` setting of its own no longer receives an authored one (FIX-1381).

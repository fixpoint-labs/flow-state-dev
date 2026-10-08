---
"@flow-state-dev/workspace": minor
---

A workspace host can now hold a repository run's commits and uncommitted files off the machine, and rebuild the checkout on another host. Off by default: pass `heldWork: fileHeldWorkStore({ dir })` (or your own `HeldWorkStore`) to `localWorkspaceHost`, and have the run source answer a `heldPrefix`. `checkpoint(place, recorded?)` now returns the hold (or `null`) instead of nothing; new `dropHeld`, `hostId` and `holds` on the host; `provision` takes the run's `recorded` place and hold, returns `origin`, and rejects with `HeldWorkMismatchError` when held work disagrees with the record. A host without a store rejects a recorded hold with `field: "disabled"` instead of starting the run over (FIX-1766).

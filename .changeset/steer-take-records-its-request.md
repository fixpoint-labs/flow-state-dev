---
"@flow-state-dev/orchestration": minor
---

A stopped request now gives back every steer it took, whatever its read was named: `takeSteers` records the request that took each steer, so the board no longer has to find the request id inside the `takenIn` label (FIX-2899).

- **Breaking: `takeSteers(id, { claim, takenIn, requestId })` needs `requestId`**, the id of the request taking the steers. `takeRunningSteers(running, takenIn, requestId, show?)` takes it too, before `show`.
- A taken steer carries the new `takenFor` field. A steer taken before this release has none, and is still matched on its `takenIn` label, so a task that was mid-attempt during an upgrade keeps working.

Docs: apps/docs reference for task collections (the `takeSteers` options and the steer record's `takenFor` field).

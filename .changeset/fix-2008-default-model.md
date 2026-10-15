---
"@flow-state-dev/core": patch
"@flow-state-dev/shift-manager": patch
---

The DevTeam and `fsd` Labs now ship a default model, so a worker that names no `model:` answers instead of failing every turn, and an `intent/<name>` with no model to fall back to fails with a setup error that names where to set one (FIX-2008).

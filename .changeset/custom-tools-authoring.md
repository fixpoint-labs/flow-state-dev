---
"@flow-state-dev/workforce": minor
"@flow-state-dev/fsdev": minor
---

A `blocks/` folder registers a block name for the workers that can see it — the app's own folder for everyone, a team's for that team, a worker's own for that one seat — and a worker's `tools:` resolves a name nearest first. Registering does not grant use: the worker still names the block. `fsdev gen` exports the per-seat map as `seatBlocks`, which `hireWorkforce` now takes, and refuses a `blocks/` folder at a level no seat reads or a `tools/` folder anywhere. `workerConfigSchema()` declares a fourth key, `seatTools`, so a kind that hand-declares the contract must add it. A map key that disagrees with its block's own `name` is refused, and a catalog tool's declared resources are installed on the kind instead of being advertised with nothing behind them (FIX-1416).

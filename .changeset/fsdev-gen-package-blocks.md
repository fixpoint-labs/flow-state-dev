---
"@flow-state-dev/fsdev": minor
---

`fsdev gen` now finds the blocks in every package's `blocks/` folder and writes them to a new `packageBlocks` export, so `fsdev gen --check` reports a generated file that predates them as out of date (FIX-1459).

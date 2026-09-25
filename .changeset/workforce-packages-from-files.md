---
"@flow-state-dev/workforce": minor
---

A worker can now hold packages, folders of a `PACKAGE.md` and a `blocks/` folder found in its own `packages/` folder or taken by name from its team's or the org's through `packages:`: the built-in `agent` kind adds their instructions to its prompt and, when the worker writes no `tools:` line, their blocks to its tools, with `readWorkforce` returning them on each record, `hireWorkforce` taking the generated `packageBlocks`, and a custom kind receiving them under `seatPackages` (FIX-1459).

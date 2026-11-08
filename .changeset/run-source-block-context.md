---
"@flow-state-dev/workspace": minor
"@flow-state-dev/workforce": minor
---

A `RunSource` is now handed the run's `BlockContext` instead of a `LooseBlockContext`, so a source can pass it to any helper typed `BlockContext` without a cast (FIX-2609). A source written against `LooseBlockContext` still compiles. Code that calls a `RunSource` itself must pass a full `BlockContext`, as harness-manager does. `ProjectChecksResolver` (from `projectChecks()`) is likewise typed `(run: { ctx: BlockContext })` instead of taking `ctx: unknown`.

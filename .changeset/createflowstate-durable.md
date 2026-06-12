---
"@flow-state-dev/server": minor
"@flow-state-dev/core": patch
---

Add a `durable: true` option to `createFlowState`. When set, the runtime builds the default checkpoint durability provider from its own resolved stores, so actions marked `durable: true` get `ctx.suspend()` human-in-the-loop suspend/resume and checkpoint-based crash recovery without manually wiring a provider. Pairs with `durabilityRetention` for the retention sweeper.

`ctx.suspend({ resumeSchema })` now accepts a Zod schema (the framework's schema language) and normalizes it to a plain JSON Schema before storage. Previously a Zod instance leaked into the suspension record and the request items log, where it failed structured-clone (in-memory store) and JSON serialization (filesystem/SQLite/Postgres); a pre-built JSON Schema object still passes through unchanged.

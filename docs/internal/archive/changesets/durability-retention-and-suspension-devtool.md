---
"@flow-state-dev/engine": minor
"@flow-state-dev/client": minor
"@flow-state-dev/store-sqlite": minor
"@flow-state-dev/store-postgres": minor
"@flow-state-dev/devtool": minor
"@flow-state-dev/core": minor
---

Add an opt-in durability retention policy that bounds checkpoint, suspension, and lease growth on long-lived hosts. Configure `durabilityRetention` alongside a `durabilityProvider` and the runtime runs a periodic sweeper that enforces suspension expiry, prunes resolved suspensions and expired leases past their windows, and reclaims orphaned checkpoints — never touching the checkpoints of an in-progress or suspended run.

Add a `resumeSuspension()` method to the client for approving or rejecting a suspended request.

Add SQLite and Postgres support for the new suspension-pruning and checkpoint-cleanup store operations.

Add a Suspensions tab to the DevTool for browsing pending and resolved human-in-the-loop suspensions and approving or rejecting them, plus inline rendering of suspension items and the `suspended` request status.

Add `createdBefore` / `resolvedBefore` fields to `SuspensionFilter`.

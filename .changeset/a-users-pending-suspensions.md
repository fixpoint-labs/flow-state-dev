---
"@flow-state-dev/contracts": minor
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/client": minor
"@flow-state-dev/react": minor
"@flow-state-dev/store-sqlite": minor
"@flow-state-dev/store-postgres": minor
---

A server block can read the running user's pending asks across every session in one call, `sessions.userSuspensions({ flowKinds })`, and a view that reads it wakes only when a suspension changes (FIX-2770).

- **engine (breaking for custom stores):** `SuspensionStore` has a new required method, `listPendingForUser(query)`: one query that joins each suspension to its request and applies the user, tenant, organization, flow, pending status, expiry and waits-on-a-person checks inside it, returning rows built with `projectUserSuspension`. A custom suspension store gets a type error until it implements it; run `createPendingUserSuspensionsConformanceTests` from `@flow-state-dev/engine/testing` against it. `createInMemorySuspensionStore({ requests })` and `createFilesystemSuspensionStore(rootDir, { requests })` take the request store they join to; built without it, the method throws a `FlowStateConfigError`. `createInMemoryStores` and `createFilesystemStores` pass it for you.
- **core:** the request host's `sessions` gains `userSuspensions({ flowKinds, after? })`: the principal's pending suspensions on 0 to 50 named flow kinds (more throws `FlowStateConfigError`), oldest first, 200 a page, with `more` and a `next` cursor `{ createdAt, requestId, suspensionId }` to pass back as `after`. Each row carries the ids, flow, session, kind, card shape, title, message, allowed actions, schema, render and times, never the run's `stepInput`, `resumeData` or `data`. A user or session view may call it; an org view may not.
- **contracts / client:** a new change kind, `"suspension"`, published on a user's topic when a suspension waiting on them is written or deleted (never for a wait gate or an outside event's stop). A client that switches over every `ChangeKind` gets a new case.
- **core:** `suspensionShape`, `SuspensionShape` and `USER_SUSPENSION_REASONS` (every stored reason that waits on a person) are exported from `@flow-state-dev/core/types`, beside `isUserSuspension`, along with `projectUserSuspension` and the row and query types a store builds. `@flow-state-dev/react` still exports `suspensionShape`, `SuspensionShape`, `SchemaField` and `SuspensionValueKind`, the same functions and types it had.
- **contracts:** the card shape and schema analysis (`suspensionShape`, `analyzeResumeSchema`) and `USER_SUSPENSION_REASONS` live on the `@flow-state-dev/contracts/types/suspension` subpath, which core and react re-export from.

Docs: packages/core/README.md (request host section: `sessions.userSuspensions`), packages/engine/README.md (the store method an adapter implements), apps/docs/docs/api/client.md (the `suspension` notice kind)

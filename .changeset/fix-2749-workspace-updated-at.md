---
"@flow-state-dev/workspace": minor
"@flow-state-dev/tools": minor
---

A file a workspace saves keeps that workspace's path, content hash, and `updatedAt`, which is an ISO timestamp. `entryState` and bash `createState` can still add other fields. A `path`, `hash`, or `updatedAt` they return is ignored (FIX-2749).

Docs: apps/docs/docs/tools/workspace.md

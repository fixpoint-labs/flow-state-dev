---
"@flow-state-dev/workspace": minor
"@flow-state-dev/tools": minor
---

A file a workspace saves keeps that workspace's path, content hash, and `updatedAt`, which is an ISO timestamp. Fields added with `entryState` or bash `createState` are still saved, and they no longer replace those three (FIX-2749).

Docs: apps/docs/docs/tools/workspace.md

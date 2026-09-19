---
"@flow-state-dev/workforce": patch
---

`readDeclaredRoster(root)` on `@flow-state-dev/workforce/loader` reads a whole workforce tree in one call — workers, teams, documents and channels — and returns one flattened `problems` list, each entry tagged with the layer that reported it. Problems are collected rather than thrown, so the caller decides what is fatal; only an unreadable or symlinked root throws (FIX-1405).

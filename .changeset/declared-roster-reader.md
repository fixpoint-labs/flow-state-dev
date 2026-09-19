---
"@flow-state-dev/workforce": patch
---

`readDeclaredRoster(root)` on `@flow-state-dev/workforce/loader` reads a whole workforce tree in one call — workers, teams, documents and channels — and returns one flattened `problems` list, each entry tagged with the layer that reported it. It joins the existing readers rather than walking the tree itself, and collects rather than throws, so the caller keeps its own boot policy; only an unreadable or symlinked root throws (FIX-1405).

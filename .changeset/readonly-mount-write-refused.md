---
"@flow-state-dev/workspace": minor
"@flow-state-dev/tools": patch
---

A write to a read-only mount is now refused instead of reported as saved (FIX-1284).

`Projection.put` used to resolve `undefined` for a read-only mount, the same
answer it gives for a collection's own metadata. The bash `writeFile` tools
read that silence as success, so an agent editing a file under a read-only
mount was told its work had been saved — it hadn't, and no retry would ever
save it.

`put` now returns a `readonly` outcome naming the mount's prefix, and both
`writeFile` doors relay it as `{ success: false, refused }`. Metadata writes
still resolve `undefined`. A flush is unchanged: it holds no baseline on a
read-only mount, so it still passes over those paths without deciding.

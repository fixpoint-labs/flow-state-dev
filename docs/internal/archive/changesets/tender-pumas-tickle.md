---
"@flow-state-dev/workspace": minor
---

New package: `@flow-state-dev/workspace`, the file projection between resource collections and wherever an agent works (FIX-150).

`createProjection({ mounts, place })` hydrates mounted collections into a place and flushes them back, reporting an outcome for every path it reached — including `conflict` when two writers touched one path, with the three hashes needed to say why. Ships `createHostPlace` (a real directory, contained, symlinks neither listed nor followed) and `createMemoryPlace` (a `Map`, for tests).

A mount can supply `entryState(key)` to stamp its own fields — a title, an author, a timestamp in the shape its UI expects — on every entry the projection commits. It applies last, so a mount can override a field the projection also sets.

---
"@flow-state-dev/server": patch
---

Fix: `FilesystemResourceStateStore.set` could throw `ENOENT` mid-write under a concurrent-write race, failing the whole operation (e.g. a portfolio import that writes many resources at once would abort, surfacing as a stray `…/<scope>/<key>.tmp-…` path).

`set` creates the scope directory (`mkdir -p`) and then writes via a temp file + `rename`. The scope dir could be transiently absent at the write step — concurrent writers racing to create a fresh scope tree, or a sibling scope teardown — leaving `writeFile`/`rename` to `ENOENT` on the just-ensured directory. `set` now re-creates the directory and retries the write once on `ENOENT`, cleaning up the orphaned temp file; a second consecutive `ENOENT` (or any other error) still propagates. No API change.

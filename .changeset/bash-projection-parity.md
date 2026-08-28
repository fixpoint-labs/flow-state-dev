---
"@flow-state-dev/tools": patch
---

Both bash entry points now share one projection wiring (FIX-150).

`createBashBlocks` and `createBashTool` are two doors onto one projection, and they were two partial integrations of it. Each gap was a bug in exactly the door that lacked it:

- **`createBashTool` seeds the workspace markers.** On an exec-backed sandbox a flush walks with `find <destination>/<prefix>`, which exits non-zero for a directory hydrate never created — so an *empty* collection made the first successful command fail during its own flush.
- **A failed walk no longer fails the command.** The projection throws on an unreadable place deliberately, because a flush that no-ops is recoverable where one that deletes is not. That is a reason to log, not to reject a command that already ran.
- **`createBashTool` reports what a flush decided.** Orphans and conflicts reached the console on one path and were discarded on the other, so a refused write looked like a success.
- **The tool's file listing names mounted paths.** A collection matching `files/*` mounts at `files/`, so its `hello.txt` lives at `files/hello.txt`; the listing advertised the bare key and pointed the model at a path that does not exist.

**A cold `bash-write-file` can update a file the collection already holds.** The bind-mount fast path built its projection with no place and no baseline, so every existing path came back a conflict and the write was refused — while the host file took the edit anyway, leaving the two to disagree until the next hydrate erased the run's work. It now projects over the host directory it is already writing to, and hydrates first.

**Three things a flush got wrong about what it was looking at.**

- **A `.keep` a collection holds is no longer deleted.** The workspace seeds `.keep` markers so an empty mount still has a directory to walk, and the listing filtered them back out by basename — which also removed a `.keep` the collection itself owned. The baseline still claimed it, so the next flush read the gap as a deletion and dropped the entry. Only the seeded paths are filtered now.
- **A failed collection write reaches the caller.** A flush that cannot read the workspace is swallowed on purpose: nothing was decided, so nothing was lost. A flush whose *collection* write fails is the opposite, and it was being swallowed alongside — the command returned success while its files stayed in the sandbox. Only the walk failure is caught — the projection names it `PlaceUnreadableError`, which is what makes the two distinguishable.
- **A stray file beside the mounts is reported.** The walk visited the mount prefixes and nothing else, so a shell command writing at the workspace root produced a file no outcome ever mentioned, dropped without a word when the sandbox was released. The walk now also reads the workspace root. It still does not descend into unmounted subdirectories.

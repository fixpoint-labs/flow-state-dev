---
"@flow-state-dev/workspace": patch
---

Three more projection fixes from review (FIX-150).

**A host place lists a file once when nested prefixes both cover it.** The walk runs per prefix, so a file under `artifacts/drafts` was reached by both the `artifacts` walk and the `artifacts/drafts` one — and a flush decided one physical file twice, reporting `written` and then `unchanged` for the same path. The in-memory place filters one key set and never doubled; the two now agree.

**A read-only mount's files are no longer claimed as owned.** `ownedPaths()` answers "is another run holding this?". A read-only mount is projected and then never written or deleted, so claiming its reference files refused an overlap that was always safe.

**Symlink refusal at the leaf is now the kernel's, not a check the caller can race.** Validating a path and then writing it are two syscalls with an await between them, so something that can write in the place could swap the leaf for a symlink in the gap. Reads and writes now open with `O_NOFOLLOW`, which refuses in the open itself. A symlinked *parent* directory remains check-then-use — closing that needs `openat` on directory descriptors, which Node does not expose.

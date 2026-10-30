---
"@flow-state-dev/cursor": patch
---

A Cursor run in a deep working directory no longer fails with `ENAMETOOLONG` before it starts. Cursor names its state folder after the whole path, so when that name would pass 255 bytes the block now hands Cursor a short link to the directory (under `<tmpdir>/fsd-cursor-<uid>/`, private to the OS user) instead. Directories that already fit are passed as before (FIX-2344).

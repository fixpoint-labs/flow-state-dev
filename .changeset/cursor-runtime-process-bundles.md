---
"@flow-state-dev/cursor": patch
---

With `env` set, `cursorAgent` now starts Cursor's runtime process with `spawn` of the current Node and an IPC channel instead of `fork`, so a Next.js app that bundles the package with Turbopack builds. The process and its environment are unchanged (FIX-1917).

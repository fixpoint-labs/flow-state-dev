---
"@flow-state-dev/cursor": patch
---

Add `cursorSignIn(env)` and its `CursorSignIn` type: whether Cursor is signed in for a run with that environment, by `CURSOR_API_KEY` (`key`) or the SDK's stored login (`login`), or `none` with a reason. It starts no run, and loads `@cursor/sdk` only when there is no key (FIX-2014).

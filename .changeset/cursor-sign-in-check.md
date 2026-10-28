---
"@flow-state-dev/cursor": patch
---

Add `cursorSignIn(env)` and its `CursorSignIn` type, which check whether Cursor is signed in without starting a run (FIX-2014). The result is `key` when `env` has a non-empty `CURSOR_API_KEY`, which works even without `@cursor/sdk` installed. It is `login` when the SDK finds an unexpired stored login (from `Cursor.auth.login()`) under the calling process's `HOME`, and `none` with a reason otherwise.

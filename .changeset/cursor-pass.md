---
"@flow-state-dev/cursor": patch
---

`@flow-state-dev/cursor` exports `CURSOR_PASS`, the environment pass-list a Cursor run needs, for `env: harnessEnv({ pass: CURSOR_PASS })`, as `CODEX_PASS` and `CLAUDE_CODE_PASS` do for their harnesses (FIX-2390).

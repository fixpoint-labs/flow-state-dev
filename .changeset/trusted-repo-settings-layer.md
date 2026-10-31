---
"@flow-state-dev/claude-code": minor
"@flow-state-dev/cursor": minor
---

`claudeCodeAgent` takes `settings`, a settings layer in Claude Code's `settings.json` shape that sits above every source `settingSources` loads. `settingSources: ["project"]` with `settings: { disableAllHooks: true }` loads a trusted repository's `CLAUDE.md` and skills with its hooks off. With `mcpTools` set, `disableClaudeAiConnectors: true` is still merged in. `@flow-state-dev/cursor` exports `CURSOR_PASS`, the environment pass-list a Cursor run needs, for `harnessEnv({ pass: CURSOR_PASS })` (FIX-2421).

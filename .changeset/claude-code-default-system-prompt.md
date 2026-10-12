---
"@flow-state-dev/claude-code": minor
---

`claudeCodeAgent` now starts a run from Claude Code's own system prompt when `systemPrompt` is left out, matching the `claude` CLI, and accepts the Agent SDK's preset form to add instructions with `append`. Runs that relied on starting with no system prompt pass `systemPrompt: ""` (FIX-1185).

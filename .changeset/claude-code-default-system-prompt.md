---
"@flow-state-dev/claude-code": minor
---

`claudeCodeAgent` now starts a run from Claude Code's own system prompt when `systemPrompt` is left out, the same one the `claude` CLI uses, instead of an empty one. It also accepts the Agent SDK's other prompt shapes, including the preset with `append` to add instructions. Runs that relied on starting with no system prompt pass `systemPrompt: ""` (FIX-1185).

---
"@flow-state-dev/claude-code": patch
---

`@flow-state-dev/claude-code/sdk` exports `probeClaudeAccount({ env, timeoutMs })`, which asks Claude Code whether it has an API key or a sign-in to run on, without starting a model turn, so a host can refuse to start with no credential (FIX-1904).

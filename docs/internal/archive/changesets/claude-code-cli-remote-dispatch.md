---
"@flow-state-dev/claude-code": minor
---

New package `@flow-state-dev/claude-code` with a `/cli` entry point for dispatching Claude Code cloud tasks. `claudeRemoteDispatch()` shells out to the local `claude --remote "<instructions>"`, persists the returned task handle in session state, and emits a status item with the claude.ai session URL. Use it directly as a sequencer step or expose it to a generator via `createClaudeCliCapability()`. Dispatch is fire-and-forget: the CLI offers no headless way to poll cloud-task progress yet. The package root exports a source-agnostic `RemoteAgentTaskHandle` envelope shared with the forthcoming SDK entry point.

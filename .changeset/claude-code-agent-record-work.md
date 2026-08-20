---
"@flow-state-dev/claude-code": minor
---

`claudeCodeAgent` and `createClaudeCodeAgentCapability` take `recordWork: true`,
which records what a coding run **did** — the file operations its tools
performed and the to-do list it kept — as resource collections you can read back
over the resource route (LAB-134).

Off by default. The file record covers tool-driven operations only: a run that
edits through the shell makes no file-tool call, so nothing is recorded for it.
Paths are recorded, contents are not. See the
[Claude Code SDK agent guide](https://flow-state.dev/docs/tools/claude-code-sdk)
for what lands in each collection and how to read it back.

---
"@flow-state-dev/claude-code": minor
---

`claudeCodeAgent({ mcpTools })` hands a run tools your process serves, as in-process MCP servers: each tool is a name, a description, a JSON Schema and a `call`, with no field for an address or headers. A value, or a resolver called once per run. Set, even to `{}`, it is the run's whole MCP set (`strictMcpConfig`, and no claude.ai connectors); the tools are allowed without asking, and each server's `close` runs when the run ends, once even when several servers share it; an abort while the resolver is connecting stops the wait and closes what it answers later. Unset, the SDK call is unchanged (FIX-1905).

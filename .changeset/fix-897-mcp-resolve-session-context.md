---
"@flow-state-dev/core": patch
"@flow-state-dev/mcp": patch
---

Flows may set `mcp.resolveSessionId` so an MCP `tools/call` can derive a stable framework `sessionId` from merged tool input (stateless transport by default; optional caller-supplied grouping).

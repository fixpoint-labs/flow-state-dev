---
"@flow-state-dev/core": minor
"@flow-state-dev/mcp": minor
---

Add a per-action `mcp.session` directive so an MCP `tools/call` can derive its own flow session id instead of always minting a fresh one. A string template mints a fresh id (`"ctx_*"` → `ctx_1784…`); `{ fromInput: "field" }` reuses a caller-supplied id, so related calls group into one session. Undefined keeps today's stateless-per-call behavior.

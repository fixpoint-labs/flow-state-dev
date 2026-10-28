---
"@flow-state-dev/workforce": minor
---

Projects name the MCP servers their coding runs get. The row gains `mcpServers` (a row stored before reads `[]`); `createProject` takes it and the new members-only `setMcpServers` replaces it, checked against `defineProjectBlocks({ mcpServers })` (`unknown-mcp-server`, `invalid-mcp-server`). `projectMcpTools(servers, { operator })` resolves a run's servers from the same read as `projectWorkspace()` and relays their tools through FSD's own connection with the run owner's key, read from the new user-scoped `mcp-credentials/*` collection (client read: `setAt` only) (FIX-1905).

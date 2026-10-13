---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/workforce": patch
---

Resources and collections take a `secret` list of state fields that never leave the server. The engine omits them from the client snapshot, the list-state and get-state routes, live deltas and the debug routes, and a `client.data` projection is handed state without them. A `secret` name not on the state schema, or one `client.expose` also names, throws at definition time. Workforce's `mcp-credentials/*` collection declares its `value` secret, so a stored MCP key no longer comes back from the debug routes (FIX-1955).

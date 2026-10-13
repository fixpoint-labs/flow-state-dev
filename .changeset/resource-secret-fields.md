---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/workforce": patch
---

`defineResource` and `defineResourceCollection` take a `secret` list of state fields the engine never sends to a client or returns from the debug routes, and Workforce marks a stored MCP key's `value` secret so the debug routes no longer show it (FIX-1955).

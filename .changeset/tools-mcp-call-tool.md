---
"@flow-state-dev/tools": patch
---

`createMcpManager` gains `callTool(name, args, { signal })`, which calls one tool by its namespaced name on its server's connection, and each catalog tool carries its input JSON Schema as plain JSON (`jsonSchema`). A connection failure's message no longer carries the server's header values, in the catalog or the log line (FIX-1905).

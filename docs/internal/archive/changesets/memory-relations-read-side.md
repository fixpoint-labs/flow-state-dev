---
"@flow-state-dev/memory": minor
---

Relations read-side: when the semantic relations tier is enabled, agents gain a `memory/connect` tool to traverse relationships between entities (path-finding and neighbourhood listing), `memory/recall` now expands to surface edges connected to entities named in the query, and `ctx.cap.memory` exposes `connections`/`relate`/`egoGraph` helpers.

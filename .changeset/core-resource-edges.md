---
"@flow-state-dev/core": minor
"@flow-state-dev/server": minor
---

Add typed-edge graph support. A new `@flow-state-dev/core/graph` module provides a directed, typed, bi-temporal `Edge` schema plus pure, depth-bounded traversal helpers (`egoGraph`, `shortestPath`, `neighbors`, `traverse`, `activeAt`). Resources can opt into a first-class relation graph with `defineResource({ edges: true })` (or `{ vocabulary, maxEdges }`): the framework stores an `edges` array in the resource's state and exposes an `.edges` API (`add` / `supersede` / `remove` / `all` / `neighbors` / `egoGraph` / `shortestPath` / `pruneDangling`) on the live resource reference. Resources without `edges` are unaffected.

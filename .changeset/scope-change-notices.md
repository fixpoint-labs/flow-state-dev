---
"@flow-state-dev/engine": minor
"@flow-state-dev/react": minor
"@flow-state-dev/contracts": minor
---

A live view hears other sessions' changes to the user and org state and the resources it reads (FIX-1506).

- **engine:** a session, user or org state write, and a write to a resource a client can read, publishes a `state` or `resource` notice on its scope's topic once it lands, from any run, with or without a stream, naming the request that made it. The resource routes publish the session's topic too.
- **react:** `useSession(id, { live: true })` subscribes its session, user and org topics: a state notice reads state again without the item history, a resource notice makes the resource hooks read again, and a notice from the view's own request is skipped. `Roster` and `BoardColumns` take `live` and read their collection again on another session's change to it.
- **contracts:** `ChangeKind` gains `"state"` and `"resource"`; a `switch` over it that lists every kind needs the two new cases. `getPatternPrefix` is exported from `@flow-state-dev/contracts/helpers` (still re-exported from `@flow-state-dev/core/types`).

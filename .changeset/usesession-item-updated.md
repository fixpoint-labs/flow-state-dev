---
"@flow-state-dev/react": patch
---

`useSession` now applies `item.updated` patches from its request stream as they arrive, so an in-flight item (a tool call's result, a container's status, a trace row's input) updates in `session.items` before the item finishes. A patch to an item the view already holds finished, or to an item the item filter excludes, is ignored (FIX-2038).

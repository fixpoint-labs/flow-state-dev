---
"@flow-state-dev/client": minor
"@flow-state-dev/contracts": patch
---

**Breaking:** the client's root carries only what an app reads (FIX-2449). `ExecuteActionRequestBody` and `QueryValue`, which nothing outside the client reads, are no longer exported, and `clientPackageMarker` is removed, with no deprecated aliases. `ChildSessionStatus` and `ChildSessionSummary` are unchanged, now declared once in contracts (`@flow-state-dev/contracts/types/child-session`) and re-exported. `CollectionResourceHandle` stays on the root: React's collection hooks return it.

Docs: packages/client/README.md (add `CollectionResourceHandle`: the item `useResourceCollectionList` and the collection hooks return, `{ topic, clientData, fetchContent() }`)

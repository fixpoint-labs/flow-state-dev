---
"@flow-state-dev/orchestration": patch
---

Durable (resource-backed) task boards now pick up a mid-drain add promptly and no longer retire while work is outstanding. Every `TaskCollectionRef` resolved over the same resource collection inside one request shares one record of which tasks exist, so a task added through any resolution is immediately visible through the ref an idle worker cached before it went to sleep. Previously each resolution hydrated a private view: a sibling's mid-drain add was invisible to a waiting worker, so the event-driven wake never fired (the board fell back to its full poll interval), and a worker whose view read "nothing in flight" spun through its entire iteration budget in milliseconds and retired silently — after which the drain could end with a task still outstanding.

The freshness guarantee is scoped to one request. A concurrently running separate action writing to the same durable collection is still invisible to a drain already waiting; sequential access across requests reads persisted state as before. The task board's wake predicate and exit check now also share one classifier for "does this board still have work", replacing two hand-written spellings that had drifted. No API changes.

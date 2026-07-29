---
---

Internal-only: add a regression test documenting that a resource-backed task board's `.waitForCondition` wake predicate reads a `TaskCollectionRef` resolved once per drain invocation and cached, while `createResourceBackedTaskCollection` hydrates a brand-new sync mirror per call — so a task added through a separately-resolved ref (e.g. a sibling using `board.capability`) while a worker is mid-wait is not claimed promptly; the worker only picks it up after its full poll timeout elapses. `claimStep`/`checkBoard` are unaffected (they re-resolve fresh per call); only the cached wait-predicate ref is stale. No fix included — filed for triage.

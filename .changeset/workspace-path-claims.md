---
"@flow-state-dev/workspace": minor
"@flow-state-dev/tools": minor
"@flow-state-dev/claude-code": minor
---

Two runs can no longer write the same file at the same time without one of them being told (FIX-150).

The baseline answers "has this path changed since I last wrote it". It cannot answer "is somebody else writing it right now" — a second projection that has never committed the path holds no baseline for it and reads the collection as untouched. Both would write, the later would win, neither would know.

A projection now claims each path it commits, for the duration of the flush doing the committing. A second projection reaching a claimed path gets a `contested` outcome naming the path instead of writing. Claims are per **path**, so two runs sharing a collection while touching disjoint files both land and neither is refused — that case is the point of the design, not a gap in it.

On by default, for both the bash tool and the workspace agent capability. The bash tool warns and names the path; the coding-agent capability records a `contested` row in its `workspace-outcomes` collection alongside the `conflict` and `orphan` rows it already writes. In-process only: this is the same scope the baseline already has, and two servers writing one collection is a larger problem this does not claim to solve.

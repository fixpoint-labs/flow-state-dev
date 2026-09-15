---
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": minor
---

Each worker on a roster now holds its own skills, seeded from its own org, team and worker folders instead of one shared bucket — a catalog already seeded under the shared key is re-seeded under the worker's own and its old rows are left behind (FIX-1362).

---
"@flow-state-dev/orchestration": patch
---

Delegation now rejects an unknown task assignee when the task is created, listing the agents that do exist, instead of silently running it on the default worker at drain time.

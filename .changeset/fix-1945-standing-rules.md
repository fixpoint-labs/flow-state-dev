---
"@flow-state-dev/workforce": patch
---

Standing rules (FIX-1945): workers on `agent` and coordinators keep notes a user asks them to keep, one list per worker per user, read on every turn. The worker edits them with `rules/read`, `rules/add`, `rules/change` and `rules/remove`, offered only on a turn the user started, and each write shows a line in the conversation. Both flows declare a `standingRules` action, and `createWorkforceClient().standingRules(worker, input)` reads and edits the list for the signed-in user, and a worker's inventory row carries `rules`, true when its flow declares that action. Limits: 20 rules of up to 300 characters, one line each; every write names the version it read.

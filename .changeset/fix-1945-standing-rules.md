---
"@flow-state-dev/workforce": minor
---

Standing rules (FIX-1945): workers on `agent` and coordinators keep notes a person asks them to keep, one list per worker per person, read on every turn. The worker edits them with `rules/read`, `rules/add`, `rules/change` and `rules/remove`, offered only on a turn the person started, and each write shows a line in the conversation. Both flows declare a `standingRules` action, and `createWorkforceClient().standingRules(worker, input)` reads and edits the list for the signed-in person. Limits: 20 rules of up to 300 characters, one line each; every write names the version it read.

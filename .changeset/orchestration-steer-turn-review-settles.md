---
"@flow-state-dev/orchestration": patch
---

A task whose worker stops for a person in the turn an answered question owes, such as a `waitForUser({ kind: "review" })` after `askQuestion`, now settles when that stop is answered and the turn ends. Before, the stop's hold stayed open on the row and the task never left `in_progress`. (FIX-2283, found while wiring FIX-2157)

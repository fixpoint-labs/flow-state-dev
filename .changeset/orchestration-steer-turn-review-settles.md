---
"@flow-state-dev/orchestration": patch
---

A task whose worker stops for a person in the turn an answered question owes, such as a `suspendForUser({ kind: "review" })` after `holdTaskForUser`, now settles when that stop is answered and the turn ends (FIX-2283). Before, the stop's hold stayed open on the row and the task never left `in_progress`.

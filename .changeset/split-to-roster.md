---
"@flow-state-dev/workforce": patch
"@flow-state-dev/orchestration": patch
---

A worker on a task can split it into pieces for any worker on the user's roster that takes tasks, not only its own delegates; an unassigned piece still goes to its only delegate, and the chain limits still apply. A split task now completes with `{ answer, pieces }`: the answer of the turn the last piece's ending woke, with the pieces' outputs under it. It settles only once every piece has ended and its ending has been heard. When it settles with no such turn (a settle replayed after a restart), the output is `{ pieces }` alone, as before. On a task turn, a worker files its pieces and ends the turn: each piece's ending wakes the task (FIX-1997).

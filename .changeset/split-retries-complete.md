---
"@flow-state-dev/workforce": patch
---

A split task whose failed piece is filed again completes once the retry does. A piece filed in the turn a piece's failure woke is that piece's retry: the failure no longer counts against the task, and the retry is judged in its place, so the task fails naming the retry only if the retry fails for good too. A piece filed in any later turn is no retry (FIX-1802).

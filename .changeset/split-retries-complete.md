---
"@flow-state-dev/workforce": patch
---

A split task whose failed piece is filed again, in the turn that failure woke, now completes once the retry does, and fails naming the retry only if the retry fails for good too (FIX-1802).

---
"@flow-state-dev/workforce": patch
---

A coordinator conversation retries its state writes more times before giving up, so when many delegates answer at once a closed round's answers still go back out instead of being lost (FIX-1840).

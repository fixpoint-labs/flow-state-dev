---
"@flow-state-dev/workforce": minor
---

A mailbox can no longer declare a board named `lock`, in any case. It would mint an id ending in `.lock`, which no git branch can carry, so a coding run could never work that board. A tree that declares one now fails to load with the board-name rule's wording (FIX-1667).

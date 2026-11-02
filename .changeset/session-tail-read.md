---
"@flow-state-dev/client": patch
---

`@flow-state-dev/client` exports `readSessionTail`, `readSessionEarlier` and `refreshSessionWindow`: read a long session from its newest end, add earlier items on request, and read the window again, so a conversation past a few hundred items still shows its newest reply (FIX-2408).

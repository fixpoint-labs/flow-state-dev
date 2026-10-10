---
"@flow-state-dev/workforce": patch
---

A task notice that reaches a coordinator conversation mid-reply now waits for the replies running when it arrives and any that start within 30 seconds of it, instead of running beside them, while a person's next message still starts at once (FIX-1834).

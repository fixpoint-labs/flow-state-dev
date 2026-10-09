---
"@flow-state-dev/workforce": patch
---

A coordinator conversation now answers one reply at a time when a task it filed ends. If the task's notice arrives while the coordinator is still replying, the notice waits for that reply to end and then runs, instead of starting a second reply beside it. That covers a reply to a person's message and a reply over a round of delegates' answers, and a reply that fails or is cancelled ends the wait the same way. A person's own next message still starts at once, and a delegate's answer still lands without waiting for the reply. This applies to requests run in the process that accepted them; a deployment that hands requests to a queue worker runs notices as before (FIX-1834).

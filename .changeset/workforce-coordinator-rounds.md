---
"@flow-state-dev/workforce": minor
---

A coordinator can route by `round-robin` (the next delegate in list order) and `everyone` (each delegate that can be reached), and `rounds:` from 1 to 3 is now accepted: a delegate's answer goes back out that many times. Under `best-fit` and `round-robin` each answer is routed again as it lands, never to its own author; under `everyone` each delegate gets the other delegates' answers when the round closes; under `judgment` the coordinator's turn runs once per closed round, and its hand-offs go out in the next round. A round closes when each delegate in it has answered or failed, or at its deadline, which `defineCoordinatorFlow({ roundDeadlineMs })` sets (five minutes by default). The routing record's `by` adds `round-robin` and `everyone`. `delegatedPostEntry` now tells the coordinator when it has no answer for a post whose answer can go back out, and `delegatedPostSchema` carries that post's optional `deadlineAt` (FIX-1791).

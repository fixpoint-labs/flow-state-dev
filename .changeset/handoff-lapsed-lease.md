---
"@flow-state-dev/orchestration": patch
---

A task handed to a child session no longer fails when the child waits longer than the lease to start (FIX-1305).

Nothing renews a handed-off row's lease between the parent's hand-off and the child's first step, so a child queued behind a backlog used to arrive at a row the substrate counted as free and refuse its own claim as stale — leaving the row for the next drain, which spent an attempt to re-dispatch it into the same queue. The claim gate now takes the row back instead: it renews the lease against the claim it was dispatched with, on the same attempt, and refuses only when that renewal is declined, which is the case another drain genuinely reclaimed the row.

`TaskTransitionOptions` gains `adoptLapsedLease`, honoured on `renewLease` only. It renews a row whose lease has run out while the ticket still names it and the attempt is still the row's, for a claimant that has not started yet; every other ownership guard still runs inside the same atomic write, so a reclaim that got there first declines it `lost-claim`. A settlement on a lapsed lease is still refused, with or without the flag. A `TaskCollectionRef` written by hand that ignores the option keeps today's behaviour.

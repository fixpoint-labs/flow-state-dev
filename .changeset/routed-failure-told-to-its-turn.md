---
"@flow-state-dev/workforce": patch
---

A routed task that a coordinator's own turn filed (under `judgment`, or `best-fit` when it takes a message itself) now tells the conversation when it fails: the failure lands once as the delegate's line, naming the task and its error, and wakes the coordinator's turn so it can file the work again. A routed task a routing policy filed still ends only that delegate's part of the round, with no line (FIX-2115).

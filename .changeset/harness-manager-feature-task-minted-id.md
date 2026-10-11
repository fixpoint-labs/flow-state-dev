---
"@flow-state-dev/harness-manager": patch
---

A feature task (one naming an `issue` and a `phase`) on a board read from the claim now runs under the id its board minted, keyed by that task id, instead of being refused for not carrying the id its payload derives (FIX-1792). A fixed board still refuses such a row.

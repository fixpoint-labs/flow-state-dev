---
"@flow-state-dev/workforce": minor
---

`createWorkforceCapability` loses the `agents` and `catalog` option types and refuses either at runtime with `RetiredNameError`, naming `roster` and `inventory`, or `defineAgentWorkerFlow({ catalog })`, and workforce 0.7.0 as the version that removes the refusal. The refusals of `messages.hopLimit` and a worker naming the `handOff` tool, and the reads of a coordinator's saved `handOffs` and `deliveries`, are gone: no published workforce accepted or wrote them (FIX-2454).

Docs: none

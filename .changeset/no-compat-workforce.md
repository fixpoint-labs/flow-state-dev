---
"@flow-state-dev/workforce": minor
---

`createWorkforceCapability` drops the `agents` and `catalog` option types; either is now an unknown option, rejected by TypeScript and ignored at runtime. Pass `roster` and `inventory`; a tool catalog reaches a worker flow through `defineAgentWorkerFlow({ catalog })`. The refusals of `messages.hopLimit` and a worker naming the `handOff` tool, and the reads of a coordinator's saved `handOffs` and `deliveries`, are gone, and the conversation ledger no longer lists a row's `questions` (FIX-2454).

Docs: none. The old names and shapes are removed outright, with no refusal message.

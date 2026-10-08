---
"@flow-state-dev/orchestration": minor
---

Skill sub-agents are removed: a `SKILL.md` that declares `agents:` is refused when it loads, `createSkillsLibrary` drops its `workerModelId`, `maxTotalTasks`, `maxEnqueuedTasks`, `agentRegistry`, `materializeAgent`, `capabilityCatalog` and `toolSeatFence` options and the `delegation` and `guidance` binding keys, and `runBoard`, `materializeWorker`, `buildUserMessage`, `workerInputSchema`, `DEFAULT_WORKER_PROMPT` and `FLOOR_WORKER_KEY` are gone, so delegate to workers through the task board and its task tools instead (FIX-1814).

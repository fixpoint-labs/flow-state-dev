---
"@flow-state-dev/workforce": minor
---

Removed the Agent factory — `defineAgent`, `createAgentRegistry`, `materializeAgent`, `agentBlock`, `AgentCapabilityError` and `AGENT_CAPABILITY_UNRESOLVED` are no longer exported, so declare a worker as a `WORKER.md` record and hire it with `hireWorkforce`, and supply your own `agentRegistry`/`materializeAgent` to `createSkillsLibrary` for any skill that staffs a seat with `agent-ref` (FIX-1344).

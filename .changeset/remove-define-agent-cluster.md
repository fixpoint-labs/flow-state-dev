---
"@flow-state-dev/workforce": minor
---

Removed the Agent factory: `defineAgent`, `createAgentRegistry`, `materializeAgent`, `agentBlock`, `AgentCapabilityError` and `AGENT_CAPABILITY_UNRESOLVED` are no longer exported. A worker is a flow kind plus its instructions — declare one with a `WORKER.md` record and hire it with `hireWorkforce`. A skill's team is declared in its own `agents:` frontmatter with `prompt` or `prompt-ref`. A skill that declares an `agent-ref` agent still needs an `agentRegistry`/`materializeAgent` pair supplied to `createSkillsLibrary`, and now refuses to bind without one, since this package no longer ships an implementation of either (FIX-1344).

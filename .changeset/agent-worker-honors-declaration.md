---
"@flow-state-dev/workforce": minor
---

`materializeAgent` now throws `AgentCapabilityError` when an agent declares a capability by catalog key and no `capabilityCatalog` was supplied, instead of silently building the agent without it (FIX-1327).

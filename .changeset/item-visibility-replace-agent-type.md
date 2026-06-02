---
"@flow-state-dev/core": minor
"@flow-state-dev/server": minor
"@flow-state-dev/client": minor
"@flow-state-dev/react": minor
"@flow-state-dev/testing": minor
"@flow-state-dev/skills": minor
"@flow-state-dev/memory": minor
"@flow-state-dev/patterns": minor
"@flow-state-dev/devtool": minor
"@thought-fabric/core": minor
---

Replace overloaded `agentType` enum with explicit `itemVisibility: { client: boolean; history: boolean }`.

**Breaking changes:**
- `OutputItemBase.agentType` removed; use `itemVisibility` or `resolveItemVisibility()`.
- Generator config field `agentType` renamed to `itemVisibility`.
- `useSession().getItemsByAgentType()` replaced by `getItemsByVisibility(predicate)`.
- `ItemQuery.agentType` replaced by `ItemQuery.itemVisibility`.
- Pattern config options renamed: `*AgentType` → `*Visibility` (e.g. `synthesizerAgentType` → `synthesizerVisibility`).
- Skill YAML key `agent-type:` renamed to `visibility:`.
- Capability config `agentType` renamed to `itemVisibility`.
- `testItems().byAgentType()` replaced by `byVisibility()`.

**New:** The fourth visibility corner `{ client: false, history: true }` (private injected context) is now expressible. Trace types resolve by `item.type` without needing a stamp.

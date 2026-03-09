---
status: pending
priority: p3
issue_id: "014"
tags: [agent-native, context]
dependencies: []
---

# Context Starvation: Agent is Unaware of Input Modality

## Problem Statement
The agent receives transcribed text exactly like typed text. It would be highly beneficial for the agent to know if the user *spoke* the message vs *typed* it.

## Findings
- **Location:** `examples/kitchen-sink/app/page.tsx` (`buildInput`)
- **Impact:** Spoken messages often imply a desire for a spoken, conversational response.

## Proposed Solutions
1. **Pass Modality:** Update `buildInput` in `useVoice` to optionally pass the input modality (`modality: "voice" | "text"`) so the agent knows the user is speaking.

## Recommended Action

## Acceptance Criteria
- [ ] Input modality is passed to the agent.

## Work Log
### 2026-03-08 - Code Review
**By:** Review Agent
**Actions:** Identified missing input modality context during PR 50 review.

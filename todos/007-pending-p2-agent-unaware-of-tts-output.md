---
status: pending
priority: p2
issue_id: "007"
tags: [agent-native, context]
dependencies: []
---

# Context Starvation: Agent is Unaware of TTS Output

## Problem Statement
If the agent doesn't know its output is being read aloud, it will generate standard text-based responses (markdown tables, long code blocks, bulleted lists) which sound terrible and robotic when synthesized by TTS.

## Findings
- **Location:** `packages/core/src/flow/defineFlow.ts` / `examples/kitchen-sink/src/flows/kitchen-sink/flow.ts`
- **Impact:** Poor user experience when TTS reads out formatting characters.

## Proposed Solutions
1. **Inject Voice Context:** When `voice.tts` is active, automatically inject a system prompt instruction, or update the `kitchen-sink` example to demonstrate injecting context.

## Recommended Action

## Acceptance Criteria
- [ ] The agent is made aware of TTS output via system prompt instructions.
- [ ] Responses are optimized for spoken audio when TTS is active.

## Work Log
### 2026-03-08 - Code Review
**By:** Review Agent
**Actions:** Identified context starvation issue during PR 50 review.

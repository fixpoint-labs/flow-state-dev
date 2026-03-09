---
status: pending
priority: p3
issue_id: "010"
tags: [simplicity, cleanup]
dependencies: []
---

# Remove VAD Abstraction

## Problem Statement
The Voice Activity Detection (VAD) implementation in `vad.ts` is exported but never used. `useVoice` defines a `VoiceMode` but only implements the push-to-talk behavior.

## Findings
- **Location:** `packages/react/src/voice/vad.ts`
- **Impact:** Unused code adds complexity and maintenance burden (YAGNI violation).

## Proposed Solutions
1. **Delete VAD:** Delete `vad.ts`, remove the `mode` option from `useVoice`, and stick to the implemented push-to-talk behavior.

## Recommended Action

## Acceptance Criteria
- [ ] `vad.ts` is removed.
- [ ] `mode` option is removed from `useVoice`.

## Work Log
### 2026-03-08 - Code Review
**By:** Review Agent
**Actions:** Identified unused VAD implementation during PR 50 review.

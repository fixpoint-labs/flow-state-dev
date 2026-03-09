---
status: pending
priority: p3
issue_id: "011"
tags: [simplicity, types]
dependencies: []
---

# Remove Streaming TTS Types

## Problem Statement
`SpeechModel` defines an optional `stream?` method and a `SpeechStreamChunk` type, but the TTS pipeline only uses `generate()`.

## Findings
- **Location:** `packages/core/src/types/speech.ts`
- **Impact:** Unused implementation path clarifies the provider contract.

## Proposed Solutions
1. **Remove Streaming Types:** Remove `stream?` method and `SpeechStreamChunk` type from `SpeechModel`.

## Recommended Action

## Acceptance Criteria
- [ ] `stream?` and `SpeechStreamChunk` are removed from `SpeechModel`.

## Work Log
### 2026-03-08 - Code Review
**By:** Review Agent
**Actions:** Identified unused streaming types during PR 50 review.

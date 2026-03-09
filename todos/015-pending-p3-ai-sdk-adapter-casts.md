---
status: pending
priority: p3
issue_id: "015"
tags: [typescript, documentation]
dependencies: []
---

# AI SDK Adapter Casts

## Problem Statement
There is heavy use of `as any` in `createAiSdkSpeechResolver.ts` and `createAiSdkTranscriptionResolver.ts`.

## Findings
- **Location:** `packages/server/src/models/createAiSdkSpeechResolver.ts` and `packages/server/src/models/createAiSdkTranscriptionResolver.ts`
- **Impact:** Lack of explanation for bypassing the type checker.

## Proposed Solutions
1. **Add Comments:** Add a brief comment above these casts explaining *why* we're bypassing the type checker (e.g., `// AI SDK experimental types are incompatible with our generic wrapper`).

## Recommended Action

## Acceptance Criteria
- [ ] Explanatory comments are added above `as any` casts in AI SDK adapters.

## Work Log
### 2026-03-08 - Code Review
**By:** Review Agent
**Actions:** Identified missing comments for type casts during PR 50 review.

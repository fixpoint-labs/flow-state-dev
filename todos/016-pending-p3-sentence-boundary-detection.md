---
status: pending
priority: p3
issue_id: "016"
tags: [typescript, maintainability]
dependencies: []
---

# Sentence Boundary Detection Limitation

## Problem Statement
In `sentence-buffer.ts`, the regex `/[.!?]\s+/` is used to split sentences. This will break on common abbreviations (e.g., "Dr. Smith").

## Findings
- **Location:** `packages/server/src/voice/sentence-buffer.ts`
- **Impact:** Future developers might be confused by weird TTS pauses.

## Proposed Solutions
1. **Add Comment:** Add a comment acknowledging this limitation so the next developer debugging weird TTS pauses knows exactly where to look.

## Recommended Action

## Acceptance Criteria
- [ ] A comment is added to `sentence-buffer.ts` acknowledging the limitation of the sentence boundary regex.

## Work Log
### 2026-03-08 - Code Review
**By:** Review Agent
**Actions:** Identified missing comment for regex limitation during PR 50 review.

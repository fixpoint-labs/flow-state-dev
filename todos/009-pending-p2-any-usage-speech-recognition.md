---
status: pending
priority: p2
issue_id: "009"
tags: [typescript, quality]
dependencies: []
---

# any Usage in speech-recognition.ts

## Problem Statement
The `SpeechRecognition` API events use `any` instead of a minimal interface.

## Findings
- **Location:** `packages/react/src/voice/speech-recognition.ts`
- **Impact:** Potential for typos when accessing properties and lack of documentation for API shape assumptions.

## Proposed Solutions
1. **Define Minimal Interface:** Define a minimal interface for the parts of the event we actually care about.

## Recommended Action

## Acceptance Criteria
- [ ] `any` usage is replaced with a minimal interface for `SpeechRecognition` events.

## Work Log
### 2026-03-08 - Code Review
**By:** Review Agent
**Actions:** Identified `any` usage during PR 50 review.

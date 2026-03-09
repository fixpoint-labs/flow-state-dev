---
status: pending
priority: p3
issue_id: "012"
tags: [simplicity, metadata]
dependencies: []
---

# Strip Unused Metadata

## Problem Statement
Transcription and Audio metadata (`duration` and `segments`) are passed through the stack but never used by the client.

## Findings
- **Location:** `packages/core/src/types/speech.ts`, `packages/core/src/items/content.ts`, `packages/client/src/transcription/transcribe.ts`, `packages/server/src/models/createAiSdkTranscriptionResolver.ts`, `packages/server/src/routes/http-handlers.ts`
- **Impact:** Unnecessary payload size and complexity.

## Proposed Solutions
1. **Remove Metadata:** Remove unused `duration` and `segments` fields from types, server resolvers, and HTTP handlers.

## Recommended Action

## Acceptance Criteria
- [ ] `duration` and `segments` fields are removed from relevant types and handlers.

## Work Log
### 2026-03-08 - Code Review
**By:** Review Agent
**Actions:** Identified unused metadata fields during PR 50 review.

---
status: pending
priority: p1
issue_id: "002"
tags: [performance, client]
dependencies: []
---

# Client-side Base64 Encoding Blocks Main Thread

## Problem Statement
The client manually encodes audio to base64 using a `for` loop with string concatenation (`binary += String.fromCharCode(bytes[i])`). For a typical 1-minute audio recording, this loop executes 1.5 million times, creating massive memory churn and completely blocking the browser's main thread.

## Findings
- **Location:** `packages/client/src/transcription/transcribe.ts` (`uint8ArrayToBase64`)
- **Impact:** Severe UI freezes during transcription of anything longer than a few seconds.

## Proposed Solutions
1. **Send Raw Binary:** The server's `POST /api/flows/transcribe` endpoint already supports receiving raw binary data. The client should send the raw `Blob` or `Uint8Array` directly as the request body instead of JSON-encoding it.

## Recommended Action

## Acceptance Criteria
- [ ] The `transcribe` function sends raw binary audio instead of base64 JSON.
- [ ] `uint8ArrayToBase64` is removed from the client package.

## Work Log
### 2026-03-08 - Code Review
**By:** Review Agent
**Actions:** Identified critical performance bottleneck during PR 50 review.

This may already have ben completed, check first before doing.

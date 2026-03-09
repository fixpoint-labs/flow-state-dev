---
status: pending
priority: p2
issue_id: "005"
tags: [security, performance]
dependencies: []
---

# Event Loop Blocking via Inefficient Base64 Decoding

## Problem Statement
When receiving a JSON payload, the server decodes the base64 audio using `Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0))`. This $O(N)$ operation blocks the Node.js/Edge event loop for a significant amount of time for large audio files.

## Findings
- **Location:** `packages/server/src/routes/http-handlers.ts` and `packages/server/src/voice/tts-pipeline.ts`
- **Impact:** Denial of Service (DoS) for other concurrent requests while the event loop is blocked.

## Proposed Solutions
1. **Use Buffer:** Use `Buffer.from(audioBase64, 'base64')` when `Buffer` is available, and fallback to a chunked array processing approach for Edge environments.

## Recommended Action

## Acceptance Criteria
- [ ] Server base64 decoding uses `Buffer.from` when available.
- [ ] Edge fallback uses a chunked array processing approach.

## Work Log
### 2026-03-08 - Code Review
**By:** Review Agent
**Actions:** Identified event loop blocking issue during PR 50 review.

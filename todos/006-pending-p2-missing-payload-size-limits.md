---
status: pending
priority: p2
issue_id: "006"
tags: [security, api]
dependencies: []
---

# Missing Request Payload Size Limits

## Problem Statement
The transcription endpoint reads the entire request body into memory without enforcing any size limits.

## Findings
- **Location:** `packages/server/src/routes/http-handlers.ts`
- **Impact:** An attacker can send a massive payload to cause an Out-Of-Memory (OOM) crash, leading to a Denial of Service.

## Proposed Solutions
1. **Enforce Size Limit:** Enforce a maximum payload size limit for the transcription endpoint (e.g., 25MB) before reading the entire body into memory.

## Recommended Action

## Acceptance Criteria
- [ ] The transcription endpoint enforces a maximum payload size limit.
- [ ] Requests exceeding the limit are rejected with a 413 Payload Too Large status.

## Work Log
### 2026-03-08 - Code Review
**By:** Review Agent
**Actions:** Identified missing payload size limits during PR 50 review.

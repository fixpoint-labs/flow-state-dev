---
status: pending
priority: p1
issue_id: "001"
tags: [security, api]
dependencies: []
---

# Unauthenticated STT Endpoint

## Problem Statement
The new `POST /api/flows/transcribe` endpoint does not enforce any authentication or authorization. It is completely detached from any flow context and is open to the public by default.

## Findings
- **Location:** `packages/server/src/routes/http-handlers.ts`
- **Impact:** An attacker can repeatedly send audio payloads to this endpoint, consuming the server's AI provider credits (e.g., OpenAI) and leading to massive cost exhaustion.

## Proposed Solutions
1. **Require userId/sessionId:** Implement an authentication mechanism for transcription requests.
2. **Dedicated Seam/Middleware:** Provide a dedicated seam/middleware hook for developers to protect this specific route.

## Recommended Action

## Acceptance Criteria
- [ ] The `/api/flows/transcribe` endpoint requires authentication.
- [ ] Unauthenticated requests are rejected with a 401/403 status code.

## Work Log
### 2026-03-08 - Code Review
**By:** Review Agent
**Actions:** Identified critical security vulnerability during PR 50 review.

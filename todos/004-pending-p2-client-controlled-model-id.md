---
status: pending
priority: p2
issue_id: "004"
tags: [security, api]
dependencies: []
---

# Client-Controlled Model ID / Cost Exhaustion

## Problem Statement
The `transcribe` endpoint accepts a `model` parameter directly from the client request and passes it directly to the developer's `transcriptionResolver`.

## Findings
- **Location:** `packages/server/src/routes/http-handlers.ts` and `examples/kitchen-sink/lib/server.ts`
- **Impact:** An attacker can specify *any* OpenAI model ID, potentially forcing the use of more expensive models or bypassing intended limits.

## Proposed Solutions
1. **Document Risk:** Document this risk clearly so developers know they must validate/sanitize the `modelId` in their resolver.
2. **Enforce Allowlist:** Enforce an allowlist of STT models at the router configuration level.

## Recommended Action

## Acceptance Criteria
- [ ] Documentation includes explicit security warnings about validating the `modelId`.
- [ ] (Optional) Router configuration supports an allowlist of STT models.

## Work Log
### 2026-03-08 - Code Review
**By:** Review Agent
**Actions:** Identified high-severity security issue during PR 50 review.

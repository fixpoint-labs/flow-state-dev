---
status: pending
priority: p3
issue_id: "013"
tags: [performance, client]
dependencies: []
---

# AudioContext Hardware Limits in VAD

## Problem Statement
`packages/react/src/voice/vad.ts` creates a `new AudioContext()` every time `start()` is called and closes it on `stop()`.

## Findings
- **Location:** `packages/react/src/voice/vad.ts`
- **Impact:** Browsers have a strict limit on concurrent hardware audio contexts. If `stop()` is missed, the application will eventually crash.

## Proposed Solutions
1. **Reuse AudioContext:** Reuse a single lazily-initialized `AudioContext` singleton, or ensure it is wrapped in a `try/finally` block during component unmounts.

## Recommended Action

## Acceptance Criteria
- [ ] `AudioContext` is properly managed to avoid exceeding hardware limits.

## Work Log
### 2026-03-08 - Code Review
**By:** Review Agent
**Actions:** Identified potential AudioContext leak during PR 50 review.

---
status: pending
priority: p1
issue_id: "003"
tags: [agent-native, architecture]
dependencies: []
---

# Server Generates TTS Even When Muted by UI

## Problem Statement
The server continues to generate expensive TTS audio even when `autoPlayTTS` is false on the client.

## Findings
- **Location:** `examples/kitchen-sink/app/page.tsx` and `packages/server/src/voice/tts-pipeline.ts`
- **Impact:** The server will continue to call the expensive TTS API for every sentence, and the client will simply drop the audio. This is a massive waste of resources and breaks the principle that the UI state should reflect the agent's execution context.

## Proposed Solutions
1. **Dynamic TTS Generation:** Allow the client to pass a `ttsEnabled` flag in the action request, and have the server conditionally bypass the `TTSPipeline` if TTS is disabled for that specific request.

## Recommended Action

## Acceptance Criteria
- [ ] The server execution layer accepts a client-provided flag to disable TTS generation.
- [ ] The UI's `VoiceToggle` state is linked to the server's `TTSPipeline`.

## Work Log
### 2026-03-08 - Code Review
**By:** Review Agent
**Actions:** Identified agent-native context disconnect during PR 50 review.

---
"@flow-state-dev/claude-code": patch
---

A deadline on a `claudeCodeAgent` step now ends the run the instant it fires (FIX-1301), instead of waiting for the SDK's stream to settle first.

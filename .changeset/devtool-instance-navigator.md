---
"@flow-state-dev/devtool": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/core": patch
---

The DevTool now identifies flows by instance rather than by kind, so two registered copies of one flow each show their own sessions, requests and controls instead of one copy's work appearing under the other (FIX-1324).

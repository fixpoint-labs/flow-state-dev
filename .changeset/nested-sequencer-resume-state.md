---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
---

A request that resumes after `suspendForUser` restores the state of every sequencer it was inside, nested ones included, so a step after the resume sees what the steps before it wrote (FIX-2163). Two `loopBack`s that target the same step give each pass its own child paths, so a resumed request no longer reuses an earlier pass's step outputs for a later pass.

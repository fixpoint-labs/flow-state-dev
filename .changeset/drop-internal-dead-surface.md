---
"@flow-state-dev/core": minor
---

`BlockContext` no longer declares the `_outputTracker` slot. Nothing read it — no sequencer, no runtime path — so behaviour is unchanged, but the property was annotated `@internal` without `stripInternal` being enabled, so it did reach the published `.d.ts`. Code that referenced `ctx._outputTracker` stops compiling and should be deleted.

The rest of this change removes internal symbols that nothing referenced and that were never reachable from a package entry or its `exports` map, so nothing published moves for them: the pre-`resolveItemVisibility` `CLIENT_AUDIENCE_TYPES` set, a second dead `depsSatisfied` and an uncalled `sleep` in the task board, an unused positions-ref forwarder, two test-only hooks no test used, and five unreferenced type/constant declarations across `chat-sdk`, `core`, `engine`, `orchestration`, `patterns`, `react`, and `thought-fabric`. (FIX-1216)

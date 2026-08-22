---
"@flow-state-dev/chat-sdk": patch
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/orchestration": patch
"@flow-state-dev/patterns": patch
"@flow-state-dev/react": patch
"@thought-fabric/core": patch
---

Remove internal symbols that nothing referenced: the pre-`resolveItemVisibility` `CLIENT_AUDIENCE_TYPES` set, a second dead `depsSatisfied` and an uncalled `sleep` in the task board, the `_outputTracker` slot no sequencer ever read, an unused positions-ref forwarder, two test-only hooks no test used, and five unreferenced type/constant declarations. None were reachable from a package entry or its `exports` map, so no published API changes. (FIX-1216)

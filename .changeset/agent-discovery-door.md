---
"@flow-state-dev/core": minor
"@flow-state-dev/contracts": patch
---

An agent can now ask what it can work with: `discoveryTools(createManifestRegistry([...]))` returns one `discover` tool that answers from whatever domains a scope registers a source for, and `resourcesManifestSource()` ships the resources domain. Two enumerators that ignored the `llmReadable` gate are closed with it — `resourceTools().listResources` is **removed** (it had no caller), and `globResources` now lists only resources the agent may read (FIX-817).

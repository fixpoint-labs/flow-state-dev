---
"@flow-state-dev/bullmq": patch
"@flow-state-dev/claude-code": patch
"@flow-state-dev/client": patch
"@flow-state-dev/codex": patch
"@flow-state-dev/contracts": patch
"@flow-state-dev/core": patch
"@flow-state-dev/cursor": patch
"@flow-state-dev/devtool": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/fsdev": patch
"@flow-state-dev/harness-manager": patch
"@flow-state-dev/mcp": patch
"@flow-state-dev/memory": patch
"@flow-state-dev/next": patch
"@flow-state-dev/node": patch
"@flow-state-dev/orchestration": patch
"@flow-state-dev/patterns": patch
"@flow-state-dev/react": patch
"@flow-state-dev/scheduled": patch
"@flow-state-dev/store-postgres": patch
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/testing": patch
"@flow-state-dev/tools": patch
"@flow-state-dev/vercel": patch
"@flow-state-dev/voice-openai": patch
"@flow-state-dev/workforce": patch
"@flow-state-dev/workspace": patch
---

Importing any package now works. In 0.1.1 every package failed immediately with `ERR_MODULE_NOT_FOUND`, because the published JavaScript carried relative imports with no file extension — `./items/predicates` rather than `./items/predicates.js` — which Node's ESM resolver rejects. The build now emits the extensions, and subpath exports and the `fsdev` binary work alongside the main entry points.

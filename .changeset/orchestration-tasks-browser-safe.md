---
"@flow-state-dev/core": patch
"@flow-state-dev/orchestration": patch
---

`@flow-state-dev/orchestration/tasks` no longer reaches `node:module` or `node:url`, so a browser bundle can import it. Core adds two subpaths, `@flow-state-dev/core/blocks/handler` and `@flow-state-dev/core/blocks/sequencer`, that expose the block builders without the main entry's Node-only model resolver (FIX-1608).

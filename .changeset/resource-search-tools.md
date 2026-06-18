---
"@flow-state-dev/core": minor
---

Add `resourceSearchTools()` — three handler blocks an agent can call to find resources without dropping to bash: `globResources` (match resource paths by glob pattern), `grepResourceContent` (regex or substring search over content bodies), and `searchResources` (lexical, term-frequency ranked search). Grep and search read only `llmReadable` content; glob lists paths. Search is lexical, not semantic.

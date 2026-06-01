---
"@flow-state-dev/core": minor
"@flow-state-dev/server": minor
---

Resources can render content from `.md` prompt templates via `contentTemplate` and `contentTemplateRef` on `defineResource()` and `defineResourceCollection()`. `contentTemplate` accepts a file path string (resolved at server startup) or a pre-parsed `ResourceTemplate` object.

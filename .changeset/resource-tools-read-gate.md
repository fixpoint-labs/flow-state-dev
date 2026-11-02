---
"@flow-state-dev/core": minor
---

`resourceTools()`'s `readResource` now reads only from a collection that opted in with `llmReadable`, and leaves out the fields the collection names in `secret`. A path into a collection that didn't opt in answers as a path no collection matches. Mark a collection `llmReadable: true` if a model should read its state through this tool (FIX-2436).

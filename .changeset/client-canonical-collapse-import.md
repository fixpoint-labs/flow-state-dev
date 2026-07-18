---
"@flow-state-dev/client": patch
"@flow-state-dev/testing": patch
---

Import canonical item-log collapse from `@flow-state-dev/contracts/items` in the request-stream store so live SSE views keep completed sibling `tool_output` rows after generator suspend/resume (FIX-814 Rule 4).

Use framework `deepEqual` in eval `exactMatch` / `jsonPath` scorers instead of `JSON.stringify` equality.

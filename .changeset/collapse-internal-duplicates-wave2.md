---
"@flow-state-dev/engine": patch
"@flow-state-dev/orchestration": patch
---

Collapse six internal duplicates onto one implementation each: resource state normalization (now `resources/normalize-resource-state`), the conformance suite's four identical `withStore` helpers, the two task-collection backings' identical change emitters, the webhook transport's second `jsonResponse`, and the in-memory and filesystem stores' identical field-path depth guard. Behaviour is unchanged except that webhook error responses now send `Content-Type: application/json; charset=utf-8`, matching every other engine route. (FIX-1217)

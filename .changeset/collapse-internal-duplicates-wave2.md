---
"@flow-state-dev/engine": patch
---

Webhook error responses now send `Content-Type: application/json; charset=utf-8` instead of `application/json`, matching every other engine route. The webhook transport was carrying its own `jsonResponse` copy; it now uses the shared one.

The rest of this change collapses internal duplicates onto one implementation each, with no observable change: resource state normalization (now `resources/normalize-resource-state`), the conformance suite's four identical `withStore` helpers, the two task-collection backings' identical change emitters, and the in-memory and filesystem stores' identical field-path depth guard. None of those symbols is reachable from a package entry or its `exports` map, so `@flow-state-dev/orchestration` publishes nothing here and is not bumped. (FIX-1217)

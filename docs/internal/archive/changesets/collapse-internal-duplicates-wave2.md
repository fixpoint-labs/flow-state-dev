---
"@flow-state-dev/engine": patch
---

Webhook JSON responses now send `Content-Type: application/json; charset=utf-8` instead of `application/json`, matching every other engine route. (FIX-1217)

---
"@flow-state-dev/store-postgres": patch
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/core": patch
---

Collection reads by key prefix now walk an index range on the key instead of scanning the scope; on Postgres, the first start after upgrading builds `idx_resource_state_key` and `idx_resource_content_key` concurrently and drops `idx_resource_state_scope` and `idx_resource_content_scope`, and `@flow-state-dev/core/helpers` exports `keyPrefixSuccessor` for store adapters (FIX-2944).

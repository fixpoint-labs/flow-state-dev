---
"@flow-state-dev/engine": patch
---

Single-resource `writeContent` now emits a `resource_change` notification, matching collection-instance content writes — a `live: true` single resource's content update is no longer invisible to clients.

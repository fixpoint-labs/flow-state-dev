---
"@flow-state-dev/core": minor
---

Export an `InvalidationItem` base type that `state_change` and `resource_change` now derive from. It carries the fields both items share (`scope`, `delta`, `version`) so consumers can react to "something changed in a scope" generically, without enumerating both leaf types. It is a base type, not a member of the `OutputItem` union. Both items keep their existing observable contracts: `state_change` always carries a version and can be `block_instance`-scoped; `resource_change` keeps its narrower scope set and may omit a version.

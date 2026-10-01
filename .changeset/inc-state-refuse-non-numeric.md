---
"@flow-state-dev/engine": patch
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
---

`incState` now refuses a field that holds something other than a number (a string, boolean, object or array): the call throws and the stored value is left as it was, instead of being silently replaced by the delta. An absent or `null` field still starts from `0`. Custom stores implementing `incField` should throw the same way (FIX-1273).

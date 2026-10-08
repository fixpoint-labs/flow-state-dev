---
"@flow-state-dev/engine": patch
---

`pushState` on a scope with no store (sequencer and block state) now throws when the field holds something other than an array, `null` included, and leaves the value as it was. It used to replace the value with a new array. Store-backed scopes already refused (FIX-1704).

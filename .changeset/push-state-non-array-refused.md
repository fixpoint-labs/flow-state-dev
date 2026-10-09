---
"@flow-state-dev/engine": minor
---

`pushState` on sequencer and block state now throws, leaving the value intact, when the field holds something other than an array (`null` included), matching the existing refusal on store-backed scopes instead of replacing the value (FIX-1704).

---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": patch
---

`defineResourceCollection` and flow registration no longer refuse collection patterns for Workforce's roster unless Workforce's private roster collection is registered, keys under `workforce/roster/~` are readable only through that collection in every app, and `@flow-state-dev/core` no longer exports `assertRosterCollectionIsNotDeep` (FIX-1549).

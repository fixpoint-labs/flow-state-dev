---
"@flow-state-dev/engine": patch
---

A resource write whose `stateSchema` parses a non-null value to `null` is now refused with a `ValidationError` instead of being stored as the cleared `{}` and reported as a success. This covers `setState`, `patchState` and `updateState`, `collection.create`, and the client create route, which now answers `400` rather than creating a row from a seed the schema parses to `null`. An explicit `setState(null)` on a `.nullable()` resource still clears it (FIX-1281).

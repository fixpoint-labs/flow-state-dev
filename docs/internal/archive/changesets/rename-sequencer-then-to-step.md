---
"@flow-state-dev/core": minor
---

Rename the sequencer DSL's `then`-prefix methods — `.then()`, `.thenIf()`, `.thenAll()`, `.thenAny()` — to `.step()`, `.stepIf()`, `.stepAll()`, `.stepAny()`. The old names collided with the JavaScript Promise/thenable protocol, so returning a sequencer from an `async` function (or passing it to `Promise.resolve`) could invoke `.then(resolve, reject)` as if it were a chained step. This is a hard cutover with no deprecation alias: update every `.then`-family call on a sequencer builder to its `.step`-family equivalent. Block-instance-id path segments now serialize as `step[N]` / `stepIf[N]` / `stepAll[N]` / `stepAny[N]`, so any locally-cached `sequencer_checkpoints` written before the rename will cold-start instead of resuming.

---
"@flow-state-dev/orchestration": minor
---

`getOrCreateTaskCollection` now has two backings, `state` and `resource` (FIX-960). The
`sequencer` and `request` backings merge into `state`: write `backing: "state", state: ref` where you wrote
`backing: "sequencer", sequencer: ref`, and `backing: "state"` with no `state` where you wrote
`backing: "request"`. Default slots are unchanged (`tasks` on a passed ref, the `collectionId` on
the request), so stored tasks stay where they are. Renamed exports:
`createSequencerBackedTaskCollection` → `createStateBackedTaskCollection`,
`SequencerBackedOptions` (field `sequencer` → `state`) → `StateBackedOptions`, and
`SequencerBackingSpec` / `RequestBackingSpec` → `StateBackingSpec`. `taskBoard` options are
unchanged.

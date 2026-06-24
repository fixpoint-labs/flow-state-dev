---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/client": minor
"@flow-state-dev/react": minor
---

Add an opt-in live projection channel for resources (FIX-739). Setting
`client: { live: true }` on a resource or collection streams its projected
`clientData` as an inline delta on every mutation, which the React layer merges
into the cached snapshot mid-stream — the resource-side analog of `state_change`
live merge. A subscribed `useResource` or `useResourceCollectionItem` reflects a
`pending → writing → published` transition with no refetch, so apps no longer
need to mirror resource status onto exposed session state.

`live` requires the resource's `clientData` to be client-visible
(`state.read: true` or a projection on collections; a projection on single
resources) and throws at definition time otherwise. Default resources are
unchanged: they keep the batched-refetch-at-completion behavior and never ship
a per-mutation payload.

Also adds `lifecycleSchema(statuses)`, a convenience export from
`@flow-state-dev/core` that returns a `status` enum plus nullable
`startedAt` / `completedAt` / `errorMessage` fields to spread into a
status-bearing resource `stateSchema`.

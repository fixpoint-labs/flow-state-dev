---
---

Kitchen-sink gains a Background Work demo, and the `@flow-state-dev/ui` registry's
`request-group` component gets two keying fixes it surfaced (FIX-1013).

Empty on purpose. Both affected workspaces — `@flow-state-dev/kitchen-sink` and
`@flow-state-dev/ui` — are `private`, so Changesets excludes them from versioning
and publishing entirely. A fragment naming `@flow-state-dev/ui` produces neither
the bump it advertises nor a release note; it just looks like one. BP-022 asks for
`--empty` in exactly this case.

The `request-group` changes, for anyone tracing them later: segments no longer
collide on `requestId` when a keyed item splits one request into several, and the
keys are no longer positional, so re-emitting an earlier keyed item under a new
`requestId` no longer remounts every later segment and resets its expanded state.

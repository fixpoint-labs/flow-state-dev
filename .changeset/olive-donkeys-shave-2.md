---
"@flow-state-dev/client": minor
"@flow-state-dev/react": minor
---

Org scope state is removed (FIX-1153).

`@flow-state-dev/client`: `SessionStateSnapshotResponse.clientData.org` and
`SessionDetail.stateSummary.org` are gone — the engine no longer produces
either.

`@flow-state-dev/react`: `useClientData` no longer accepts an `org`
subscription, and an org `state_change` item is no longer reducible into the
cached snapshot. Org-scoped *resources* are unaffected and still surface
through the resource snapshot.

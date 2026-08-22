---
"@flow-state-dev/core": minor
---

Remove the scope-config `clientData` compatibility shim. A flow whose `session`, `user`, or `org` config still sets `clientData` now fails at `defineFlow` time with an error naming the replacement — move compute functions under `client.derived`, or use `client.expose` for verbatim passthrough. Previously `clientData` was normalized into `client.derived` behind a one-time deprecation warning. The wire shape is unchanged: clients still read `snapshot.clientData.<scope>.<name>`. (FIX-1209)

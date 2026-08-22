---
"@flow-state-dev/core": minor
---

Remove the scope-config `clientData` compatibility shim. A flow whose `session`, `user`, or `org` config still sets `clientData` now fails at `defineFlow` time with an error naming the replacement — move compute functions under `client.derived`, or use `client.expose` for verbatim passthrough. Previously `clientData` was normalized into `client.derived` behind a one-time deprecation warning. The key is rejected whenever it is present, including an empty `clientData: {}` that the shim treated as a no-op. The wire shape is unchanged: clients still read `snapshot.clientData.<scope>.<name>`.

Also removes `warnDeprecated` from `@flow-state-dev/core/helpers`. The shim was its last caller anywhere in the repo, leaving an exported, documented function with no consumer. `warnOnceDev` is unaffected. (FIX-1215)

---
"@flow-state-dev/core": minor
---

Setting `clientData` on a `session`, `user`, or `org` scope config now throws at `defineFlow` instead of being normalized behind a deprecation warning — move compute functions to `client.derived`, or use `client.expose` for verbatim passthrough. An empty `clientData: {}` is rejected too. The wire shape is unchanged: clients still read `snapshot.clientData.<scope>.<name>`. The now-unused `warnDeprecated` helper is also dropped from `@flow-state-dev/core/helpers`; `warnOnceDev` is unaffected and stays exported. (FIX-1215)

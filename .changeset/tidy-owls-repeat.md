---
"@flow-state-dev/engine": minor
"@flow-state-dev/testing": minor
---

Org scope state is removed (FIX-1153).

`@flow-state-dev/engine`: `ExecutionContext` and `CreateExecutionContextOptions`
lose their org state generic, and `CreateExecutionContextOptions.orgState` is
gone. `ctx.org` is identity-only — its state and mutation ops were removed. The
session state route no longer returns `clientData.org`.

`@flow-state-dev/testing`: `TestBlockResult.state.org` is removed, and the org
entry of `TestStateSeed` / `TestTargetSeed` narrows from `TestScopeSeed` to the
new `TestOrgSeed` (resources only) — org-scoped resources are still seedable.

Org-scoped resources, `ctx.org.identity`, `requiresOrg` and `isolateOrgState`
are unchanged. Move durable org data to `defineResource({ scope: "org" })`.

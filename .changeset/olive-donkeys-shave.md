---
"@flow-state-dev/core": minor
---

Remove org scope state. `orgStateSchema` (on `handler`, `generator`, `router`
and capabilities), the `org` scope config on `defineFlow`, `ctx.org.state` and
its mutation ops, and `contextFn`'s three-scope `{ session, user, org }`
overload are gone.

Org scope itself is unchanged: `ctx.org.identity`, `requiresOrg`, and
org-scoped resources (`defineResource({ scope: "org" })`) all work as before.
`isolateOrgState` also stays — it keeps its second role as the default
`flowIsolation` for org-scoped resources.

Durable org-scoped data belongs in a resource, which carries identity,
per-key versions and build-time collision detection that the shared state bag
never had. To migrate, replace an `orgStateSchema` declaration with a
`defineResource({ scope: "org", stateSchema })` and read it through
`ctx.resources.<name>` instead of `ctx.org.state`.

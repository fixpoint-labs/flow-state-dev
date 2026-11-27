---
"@flow-state-dev/engine": minor
---

One definition per name, in every scope (FIX-2943). A server now refuses to start when two flows declare one session-scoped resource name with incompatible shapes, and the error names both flows and the name; rename one, or reconcile the shapes. At user and org scope, a collection pattern now meets a resource or collection whose key it can reach (`files/*` meets `files/a`), so an incompatible pair there is refused too. Two flows may now declare one index name at two versions when the collections are isolated to their flows.

A server also refuses to start when two flows declare one shared user- or org-scoped resource (the same `ref`, or the same collection `pattern`) with different client settings (`client`, owner rules, `secret`), `runBy` or `canWrite`. The error's reason is `client-config-mismatch` and it names both flows. Before, the app started and every read or write of that resource by its address answered 409. `canWrite` and `client.data` are compared by identity, so declare the resource once and share the one definition between the flows, or set `flowIsolation: true` on one of them.

Docs: docs/architecture/state-and-scopes.md (cross-flow schema registry)

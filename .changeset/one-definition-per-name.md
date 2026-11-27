---
"@flow-state-dev/engine": minor
---

One definition per name, in every scope. A server now refuses to start when two flows declare one session-scoped resource name with incompatible shapes, and the error names both flows and the name; rename one, or reconcile the shapes. At user and org scope, a collection pattern now meets a resource or collection whose key it can reach (`files/*` meets `files/a`), so an incompatible pair there is refused too. Two flows may now declare one index name at two versions when the collections are isolated to their flows.

Docs: docs/architecture/state-and-scopes.md (cross-flow schema registry)

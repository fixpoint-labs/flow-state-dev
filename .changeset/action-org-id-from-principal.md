---
"@flow-state-dev/engine": patch
---

Derive an action's `orgId` from the resolved principal only. The action route
previously preferred a caller-supplied `body.orgId` over the principal's, so a
flow with a real `authentication.resolvePrincipal` (a JWT verifier, a bearer
check) could have its verified org overridden by the POST body — running the
request, and the org-scoped resources, state, and new-session binding it
touches, under an org the caller merely named.

Apps on the default resolver are unaffected: `defaultBodyUserIdPrincipalResolver`
reads `body.orgId` itself, so it still reaches the envelope by way of the
resolver that is allowed to trust it. A custom resolver that wants to honor a
body-supplied org can read the parsed body from `context.envelope.metadata.body`
and return it after checking it against the verified credential.

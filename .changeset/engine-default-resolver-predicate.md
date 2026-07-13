---
"@flow-state-dev/engine": patch
---

Export `isDefaultBodyUserIdPrincipalResolver(resolver)` — a package-instance-stable check (via a globally-registered brand) for whether a principal resolver is the framework default that trusts a caller-supplied `body.userId`. Lets tooling detect an unauthenticated flow without relying on function identity, which breaks across duplicate package instances.

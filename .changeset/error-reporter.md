---
"@flow-state-dev/workforce": minor
---

Add the Error Reporter (FIX-1983): `createErrorReporter`, `defineErrorReporterFlow` and `defineErrorReporterIntakeFlow`. A request that settles failed, a task that ends errored on a conversation's board, or a problem a person describes to the reporter becomes one report per fingerprint, capped per window, drafted by a harness from a redacted dossier, previewed to the operator as an ordinary form, and filed through the tracker project's MCP servers once they answer.

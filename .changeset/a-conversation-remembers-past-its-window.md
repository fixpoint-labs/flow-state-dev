---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/client": minor
"@flow-state-dev/workforce": minor
---

A conversation longer than its history window can keep what it said before the window (FIX-1613). `utility.historySummary({ summarize })` returns a `capability` for the generator that answers and a `fold` step to run before it: the fold writes the turns about to leave the window into a running summary, the capability hands that summary to the model and starts the generator's history after it. A capability preset may now declare `history` (a query added to that generator's history reads; generators only). The engine records `historyStart` on a request when earlier turns are out of view, exposes `ctx.session.window`, `ctx.session.items.turns()` and `history({ afterRequestId })`, and the client's request summary carries `historyStart`. Workforce's `defineAgentWorkerFlow` takes `beforeAnswer`, a block run before the worker answers.

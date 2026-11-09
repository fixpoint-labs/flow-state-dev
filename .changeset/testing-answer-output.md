---
"@flow-state-dev/testing": minor
---

The run `run.answer` and `run.resume` return now carries the action's `output`, and, when it failed after the answer, its `error` as a `FlowError` with the same `code` and `message` a first `testFlow` run's error has. Both are read from the request's status route, as a client reads them (FIX-2460).

Docs: packages/testing/README.md (in the *Testing a step that waits for a person* example, after `await run.answer({ action: "approve" })`, add `expect(after.output).toEqual({ refunded: 5 })`; one line that a run which fails after the answer comes back `failed` with `after.error`), apps/docs/docs/testing/testing-flows.md (the same `after.output` line in its *Testing a step that waits for a person* section), apps/docs/docs/api/testing.md (`output` and `error` on the result of `answer` and `resume`)

---
"@flow-state-dev/testing": minor
---

`testFlow` tests a step that waits for a person: it runs durably by default, so a `ctx.suspendForUser` or `ctx.suspend` stops the run with status `suspended` and the stop on `run.suspension`, and `run.answer({ action, data? })` and `run.resume(...)` continue it through the engine's own answer and resume routes, returning the run that followed (FIX-2460).

- `testFlow` takes `durable` (default `true`). With `durable: false`, a step that stops for a person fails the run, as it did before.
- The result carries `suspension`, the stop the run waits on, and `answer` / `resume`, which take `{ action, data?, suspensionId?, headers? }`. `suspensionId` defaults to the run's one pending stop. `headers` reach a flow's own `authentication.resolvePrincipal`.
- A refusal a screen would get (an action the stop doesn't allow, a second answer, data that fails the stop's schema, a stop that isn't there) throws a `StopRefusedError` carrying the route's `status` and message.
- The run that followed carries its status and the items emitted after the stop. Its `output` is not yet included.
- `vi.useFakeTimers()` stalls an answer: the route waits on real timers.

Docs: packages/testing/README.md (a *Testing a step that waits for a person* example: `testFlow` returns `suspended` with `run.suspension` matching `{ kind: "approval", message: "Refund 5?" }`, `await run.answer({ action: "approve" })` returns `completed`, a second answer throws `StopRefusedError` with status 409; `run.resume` for a developer's own `ctx.suspend`; the `durable` option; headers for a flow's own sign-in; the fake-timers note. Leave out reading `output` from the answered run until it ships), apps/docs/docs/testing/testing-flows.md (the same *Testing a step that waits for a person* section), apps/docs/docs/api/testing.md (`durable`, `suspension`, `answer`, `resume`, `TestFlowAnswer`, `StopRefusedError`), apps/docs/guides/human-in-the-loop.md (one line pointing to the testing section)

---
"@flow-state-dev/client": minor
"@flow-state-dev/react": minor
"@flow-state-dev/devtool": patch
---

A stop answered from a React screen is answered whatever started its run, a task board's or a webhook's included (FIX-2450).

- **react:** `useApproval`, `useSuspensionForm`, `useSuspensions` and `session.answerSuspension` answer a user's stop (`ctx.suspendForUser`, or a raw `user_approval` / `user_input`) through the client's `answer`, and a developer's own custom-reason `ctx.suspend` through `resume`. Before, they always called `resume`, which answers 404 for a task's or a webhook's run.
- **react:** `session.resumeSuspension` is renamed `session.answerSuspension`. The old name stays as a `@deprecated` alias of the same call until 0.6.0. To migrate, pass `session.answerSuspension` to `<SuspensionResolverProvider resolve>`.
- **react:** `resumedBy` is gone from the arguments of `answerSuspension`, `SuspensionResolver` and `resolveSuspension`. The server sets who answered; the field was ignored. Remove it from your calls.
- **client:** `request.answer(body, { stream: true })` returns the answer route's SSE `Response`, as `resume` and `continue` do. `resumedBy` is gone from `ResumeSuspensionBody`; it has been ignored since 0.3.0. Remove it from your calls.
- **devtool:** the suspension panel answers a user's stop through `answer`, so it approves a task's stop.

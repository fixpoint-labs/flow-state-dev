# POC · a test answers a stop through the engine's own answer route

Retained design evidence for [the spec](../../SPEC.md). Throwaway code, excluded from every
default test and typecheck run: nothing under `specs/` is in a package's vitest `include` or
`tsc` roots. `run.sh` copies the case into `packages/testing/test/` for one run and removes it
afterwards.

```bash
bash specs/issues/FIX-2460/poc/answer-in-process/run.sh
```

## The question

[D1](../../DECISIONS.md#d1) says a test answers a stop through the engine's answer route, in
process, not through a second resume path. That holds only if, using entries the engine
already exports from its root (`runAction`, `resolveDurabilityProvider`, `createFlowApiRouter`,
`createInProcessFetch`, `createFlowRegistry`, `createInMemoryStores`):

1. an action that calls `ctx.suspendForUser` over in-memory stores parks (`suspended`), with
   the stop listed;
2. a POST to the answer route, through `createInProcessFetch` on a router over the same stores,
   resumes it, and the request completes with the step's output;
3. the route's own refusals come with it (a second answer is `already-resolved`);
4. a developer's own `ctx.suspend` parks and the resume route continues it the same way.

## What it showed · 2026-11-05, on `main` at `d6a38c09`

```
[control] testFlow status: failed error: stopping for a person needs durable execution, … Nothing was held.
[park] status: suspended stop: {"kind":"approval","allow":["approve","reject"]}
[answer] route status: 202
[after] status: completed result: {"output":{"refunded":5}} seen: [ 'draft', 'answered:{"cancelled":false,"approved":true}' ]
[refusal] second answer: 409 … "refused":"already-resolved"
[control-2] run status: failed answer: 400 {"error":"No DurabilityProvider configured. Answering requires durable execution."}
[suspend] status: suspended source: http
[resume] route status: 202
[resume-after] status: completed result: {"output":{"got":{"ok":true}}}
Tests  4 passed (4)
```

- The step before the stop (`draft`) ran once: the continuation replays from the checkpoint,
  so a test sees what production does.
- A refused answer (an action the stop does not allow) came back as the route's 409 with its
  message, during the first draft of this POC. The helper inherits every check the route makes.
- **Controls:** today's `testFlow` fails the same flow with the engine's "needs durable
  execution" error; the same answer against a router with no durability provider is refused
  (400). Both fail where the change must pass.

## Verdict

**CONFIRMED.** The answer and resume routes run in process over a test's in-memory stores with
no engine change. What the POC leaves to the implementation: reading the continuation's items
(the 202 path returns none; the SSE path or the request store carries them), sharing one
runtime config so a generator after the answer uses the test's mocks, and disposing the router
so no timer outlives the test.

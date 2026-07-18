# Research team example

Runnable, tested companion code for the [Building a research team](https://flow-state.dev/guides/building-a-research-team) guide.

A small team of workers researches a subject together: analysts run in
parallel, then a synthesizer waits for them and stitches their findings.

## What's here

| File | What it shows |
|------|---------------|
| `src/workers.ts` | The analyst and synthesizer workers. Plain handlers so the example runs in tests without a model — swap a handler for a `generator` to call an LLM. The synthesizer reads its dependencies' outputs off `input.deps`. |
| `src/board.ts` | A **static** board: two analysts + a synthesizer, with a fixed dependency graph via `initialTasks` + `deps`. |
| `src/research-router.ts` | **Runtime fan-out**: a router reads a request, computes one analyzer task per competitor plus a synthesizer, and returns a board seeded with exactly those tasks. |
| `test/board.test.ts` | Runs the static board and asserts both analysts complete, the synthesizer runs after them, and dep outputs pass through. |
| `test/research-router.test.ts` | Drives the router with three competitors and asserts all four tasks (three analyzers + synthesizer) complete. |

## Run it

```bash
pnpm --filter @flow-state-dev/example-guide-research-team test
pnpm --filter @flow-state-dev/example-guide-research-team typecheck
```

The workers are deterministic, so the tests need no API keys.

# Research team example

Runnable, tested companion code for the [Building a research team](https://flow-state.dev/guides/building-a-research-team) guide.

A small team of workers researches a subject together: analysts run in
parallel, then a synthesizer waits for them and stitches their findings. The
example shows the same team two ways — a static board and a runtime fan-out
router — each wired into a flow you can run with `fsdev`.

## What's here

| File | What it shows |
|------|---------------|
| `src/workers.ts` | The analyst and synthesizer workers. Plain handlers so the example runs without a model — swap a handler for a `generator` to call an LLM. The synthesizer reads its dependencies' outputs off `input.deps`. |
| `src/board.ts` | A **static** board: two analysts + a synthesizer, with a fixed dependency graph via `initialTasks` + `deps`. |
| `src/research-router.ts` | **Runtime fan-out**: a router reads a request, computes one analyzer task per competitor plus a synthesizer, and returns a board seeded with exactly those tasks. |
| `src/flow.ts` | The `research-team` flow: one action per path — `research` and `researchCompetitors`. |
| `fsdev.config.ts` | Registers the flow so `fsdev` can run it. |
| `test/` | `board.test.ts` drives the code-first board deterministically (drain → completed tasks + stitched synthesizer output); `flow.test.ts` runs both actions end-to-end. |

## Run it with fsdev

Run these from this directory (`examples/guides/research-team`), after
`pnpm install` in the repository — `fsdev` config discovery is cwd-only.
To run it outside this repository, copy it out with [the recipe](https://github.com/fixpoint-labs/flow-state-dev/blob/main/examples/README.md#copy-an-example-out) first. Both actions use deterministic handler workers,
so they run with **no API key**:

```bash
# The static board — two analysts + a gated synthesizer.
npx fsdev run research-team research -i '{}'

# Runtime fan-out — one analyzer per competitor, then a synthesizer.
npx fsdev run research-team researchCompetitors \
  -i '{"subject":"Linear","competitors":["Jira","Asana","Trello"]}'
```

Both drain to a `task-board-meta` item with `terminationReason: "all-completed"`.

## Test it

```bash
npm test
npm run typecheck
```

The board and flow tests are deterministic and need no API keys.

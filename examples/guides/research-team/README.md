# Research team example

Runnable, tested companion code for the [Building a research team](https://flow-state.dev/guides/building-a-research-team) guide.

A small team of workers researches a subject together: analysts run in
parallel, then a synthesizer waits for them and stitches their findings. The
example shows the same team three ways — a static board, a runtime fan-out
router, and a `SKILL.md` — each wired into a flow you can run with `fsdev`.

## What's here

| File | What it shows |
|------|---------------|
| `src/workers.ts` | The analyst and synthesizer workers. Plain handlers so the example runs without a model — swap a handler for a `generator` to call an LLM. The synthesizer reads its dependencies' outputs off `input.deps`. |
| `src/board.ts` | A **static** board: two analysts + a synthesizer, with a fixed dependency graph via `initialTasks` + `deps`. |
| `src/research-router.ts` | **Runtime fan-out**: a router reads a request, computes one analyzer task per competitor plus a synthesizer, and returns a board seeded with exactly those tasks. |
| `src/skills/` | The same team as two delegation **skills** — each declares its team in `agents:` frontmatter and its body plans the board (`addTask` with assignees and deps, then `runBoard`). |
| `src/skills.ts` | Loads the `SKILL.md` folders and builds a skills library. The skills' `agent-ref:` agents resolve through a registry + a model-free materializer that returns the handler blocks, so the teams run without a model. |
| `src/flow.ts` | The `research-team` flow: one action per path — `research`, `researchCompetitors`, and `chat` (the delegation skills through a coordinator). |
| `fsdev.config.ts` | Registers the flow so `fsdev` can run it. |
| `test/` | `board.test.ts` drives the delegation surface exactly as the skills instruct (addTask → runBoard); `flow.test.ts` runs the two model-free actions end-to-end and checks the bundled skills parse. |

## Run it with fsdev

Run these from this directory (`examples/guides/research-team`) — `fsdev`
config discovery is cwd-only. The `research` and `researchCompetitors` actions
use deterministic handler workers, so they run with **no API key**:

```bash
# The static board — two analysts + a gated synthesizer.
pnpm fsdev run research-team research -i '{}'

# Runtime fan-out — one analyzer per competitor, then a synthesizer.
pnpm fsdev run research-team researchCompetitors \
  -i '{"subject":"Linear","competitors":["Jira","Asana","Trello"]}'
```

Both drain to a `task-board-meta` item with `terminationReason: "all-completed"`.

The `chat` action binds the delegation skills to a coordinator agent, which
plans tasks on its board and runs them — so it needs a model (the coordinator
is an LLM, even though these example workers aren't):

```bash
OPENAI_API_KEY=... pnpm fsdev run research-team chat \
  -i '{"message":"research ACME Corp"}'
```

## Test it

```bash
pnpm --filter @flow-state-dev/example-guide-research-team test
pnpm --filter @flow-state-dev/example-guide-research-team typecheck
```

The board and flow tests are deterministic and need no API keys — the
delegation tests drive the same tools the model would call, against the
example's handler workers.

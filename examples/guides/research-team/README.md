# Research team example

Runnable, tested companion code for the [Building a research team](https://flow-state.dev/guides/building-a-research-team) guide.

A small team of workers researches a subject together: analysts run in
parallel, then a synthesizer waits for them and stitches their findings. The
example shows the same team three ways — a static board, a runtime fan-out
router, and `SKILL.md` folders — each wired into a flow you can run with `fsdev`.

## What's here

| File | What it shows |
|------|---------------|
| `src/workers.ts` | The analyst and synthesizer workers. Plain handlers so the example runs without a model — swap a handler for a `generator` to call an LLM. The synthesizer reads its dependencies' outputs off `input.deps`. |
| `src/board.ts` | A **static** board: two analysts + a synthesizer, with a fixed dependency graph via `initialTasks` + `deps`. |
| `src/research-router.ts` | **Runtime fan-out**: a router reads a request, computes one analyzer task per competitor plus a synthesizer, and returns a board seeded with exactly those tasks. |
| `src/skills/` | The same team as two delegation **skills**. Each skill defines its own team in `agents:` frontmatter, and its body plans the board (`addTask` with assignees and deps, then `runBoard`). `research-company` defines its whole team inline — three `prompt-ref` agents whose personas live in the skill folder. `competitor-analysis` adds the two other ways to staff an agent. |
| `src/agents.ts` | The app-defined agents `competitor-analysis` borrows: `competitor-analyst`, a shared agent from `defineAgent` (referenced by `agent-ref`), and `comparison-writer`, a handler block staffed as an agent. Also the `agentRegistry` + `materializeAgent` pair that resolves both. |
| `src/skills.ts` | Loads the `SKILL.md` folders and builds the skills library — the catalog of leaf tools the inline agents call, plus the registry/materializer for the `agent-ref` agents. |
| `src/flow.ts` | The `research-team` flow: one action per path — `research`, `researchCompetitors`, and `chat` (the delegation skills through a coordinator). |
| `fsdev.config.ts` | Registers the flow so `fsdev` can run it. |
| `test/` | `board.test.ts` drives the code-first board deterministically (drain → completed tasks + stitched synthesizer output); `flow.test.ts` runs the two no-model actions end-to-end and checks both skills parse and declare their teams. |

## The three ways to staff an agent

`competitor-analysis` shows all three side by side:

- **Inline prompt agent** — `discoverer` is defined right in the SKILL.md
  (`prompt-ref` to a file in the skill folder). The team travels with the skill;
  no app code registers it. `research-company` is entirely this form.
- **Registry agent** — `analyzer` references `competitor-analyst`, a shared
  agent defined in app code with `defineAgent` and resolved through the
  registry. Many skills can borrow the same agent.
- **Block as agent** — `comparison-writer` references a deterministic handler
  block. No persona, no model. From the board's point of view it's just an
  agent you assign tasks to.

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
plans tasks on its board and runs them. Each skill defines its own team of
prompt agents, and those agents are LLMs — so this path needs a model:

```bash
OPENAI_API_KEY=... pnpm fsdev run research-team chat \
  -i '{"message":"research ACME Corp"}'
```

## Test it

```bash
pnpm --filter @flow-state-dev/example-guide-research-team test
pnpm --filter @flow-state-dev/example-guide-research-team typecheck
```

The board and flow tests are deterministic and need no API keys. They exercise
the code-first board and router; the LLM skill path is the `chat` action above.

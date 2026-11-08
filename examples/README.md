# examples/

Minimal, focused, pedagogical snippets. Each example should fit in a single README section and demonstrate one concept cleanly. If it's more than a page of code, it probably belongs under [`apps/`](../apps/) (framework reference apps) or [`labs/`](../labs/) (real applications built on the framework).

One exception: a lab that finishes its incubation can be preserved here as a **frozen reference app** — complete, working, and no longer changing. It's larger than a snippet, but kept as a self-contained example to read and copy from rather than as active research (see `knowledge-base/`).

| Directory | Purpose | Docs page |
|-----------|---------|-----------|
| `hello-chat/` | Minimal chat flow — generator + handler + sequencer in ~50 lines, with a Next.js chat UI. The best starting point. | [Quick start](https://flow-state.dev/docs/getting-started/quick-start) |
| `knowledge-base/` | A complete personal knowledge wiki: OKF import/export, a concept-CRUD capability, and a secured MCP server. Frozen reference app — grew up in [`labs/`](../labs/), preserved here as a standalone example. Its successor is [`labs/knowledge-hub`](../labs/knowledge-hub). | — |
| `guides/board-lifecycle/` | When a task board's drain runs, and how a collection is shared across blocks. No API key. | [Board lifecycle](https://flow-state.dev/guides/board-lifecycle) |
| `guides/custom-pattern/` | A `planMapReduce` pattern factory wrapping `taskBoard`, and a flow that uses it. No API key. | [Create your own pattern](https://flow-state.dev/guides/create-your-own-pattern) |
| `guides/index-time-facets/` | Classify each ticket once when it's written, then search the stored answers with no model call. | [Find by facets](https://flow-state.dev/docs/resources/searching#find-by-facets) |
| `guides/research-team/` | Analysts in parallel and a synthesizer, as a static board and as a runtime fan-out. No API key. | [Building a research team](https://flow-state.dev/guides/building-a-research-team) |
| `guides/routing-with-evaluators/` | Support-ticket triage on `evaluator` blocks and a `cascadingRouter` tree. | [Routing with evaluators](https://flow-state.dev/guides/routing-with-evaluators) |

Trading Desk now lives at https://github.com/fixpoint-labs/trading-desk. The knowledge base made the reverse trip: it finished incubating in `labs/` and landed here as a frozen reference.

## Copy an example out

Inside this repository an example runs on the source beside it: its `@flow-state-dev/*`
dependencies say `workspace:*`, which only a pnpm workspace understands. To start your own app
from one, copy its folder anywhere outside the repository, point those dependencies at the
published packages, and install:

```bash
cp -R flow-state-dev/examples/guides/board-lifecycle my-app   # any example's folder
cd my-app
sed -i.bak 's/"workspace:[^"]*"/"latest"/' package.json && rm package.json.bak
npm install
```

The `sed` line rewrites each `workspace:*` to `latest`. Skip it and `npm install` stops with an
error naming `workspace:`. Then follow the example's README: `npm run typecheck`, `npm test`, and
its `npx fsdev run …` lines all work from the copy. Starting from an empty folder instead? Follow
the [quick start](https://flow-state.dev/docs/getting-started/quick-start).

## apps vs. examples vs. labs

- **apps/** — framework reference applications and infrastructure (the devtool, the docs site, kitchen-sink). Built to exercise or demonstrate the framework itself.
- **examples/** — minimal, pedagogical. One flow, one concept, no production concerns.
- **labs/** — applications built for real-world use: real data, durable state, domain requirements. Past a teaching snippet, not yet a shipped product.

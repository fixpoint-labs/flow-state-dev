# Board lifecycle example

Runnable companion code for the [Board lifecycle](https://flow-state.dev/guides/board-lifecycle) guide.

It makes one thing observable: **a task board is durable task state plus a
drain, and the drain only runs when `board.block` executes.** Two actions seed
the same request-backed collection identically; the only difference is whether
the board's drain runs.

| File | What it shows |
|------|---------------|
| `src/workers.ts` | A deterministic `processor` handler (uppercases its task's text) so everything runs with no model. |
| `src/lifecycle-flow.ts` | One request-backed collection shared across three blocks: a seed block, `board.block` (the drain), and a read block. Two actions: `seedAndInspect` (no drain) and `seedDrainRead` (drain). |
| `test/lifecycle.test.ts` | Asserts `seedAndInspect` leaves tasks `pending` and `seedDrainRead` leaves them `completed` with output. |

## Run it with fsdev

Run from this directory (`fsdev` config discovery is cwd-only). No API key —
the workers are deterministic:

```bash
# Seed the collection, then read it WITHOUT draining → tasks are "pending".
pnpm fsdev run board-lifecycle seedAndInspect -i '{"items":["alpha","beta"]}'

# Seed, run board.block (the drain), then read → tasks are "completed".
pnpm fsdev run board-lifecycle seedDrainRead -i '{"items":["alpha","beta"]}'
```

The two outputs differ only in `status` (`pending` vs `completed`) and
`result` (`null` vs the uppercased text) — that difference is the drain.

## Test it

```bash
pnpm --filter @flow-state-dev/example-guide-board-lifecycle test
pnpm --filter @flow-state-dev/example-guide-board-lifecycle typecheck
```

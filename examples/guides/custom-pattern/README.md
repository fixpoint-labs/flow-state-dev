# Custom pattern example

Runnable companion code for the [Create your own pattern](https://flow-state.dev/guides/create-your-own-pattern) guide.

A "pattern" is a factory that wraps `taskBoard` into a reusable block. This
example builds `mapReduce` — fan a list of items across a worker, then fold the
outputs — and a `word-count` flow that uses it.

| File | What it shows |
|------|---------------|
| `src/map-reduce.ts` | The pattern factory. Owns the board, seeds tasks from a `plan`, drains via `board.block`, and folds the completed outputs with a `reduce`. A consumer supplies only `plan`, `map`, and `reduce`. |
| `src/word-count-flow.ts` | A consumer: counts words across documents by mapping each to a count and reducing to a total. |
| `test/map-reduce.test.ts` | Runs the flow and asserts the reduced total (and the empty case). |

## Run it with fsdev

Run from this directory (config discovery is cwd-only). No API key — the map
worker is a deterministic handler:

```bash
pnpm fsdev run word-count count -i '{"documents":["a b c","one two","single"]}'
# → { total: 6 }
```

## Test it

```bash
pnpm --filter @flow-state-dev/example-guide-custom-pattern test
pnpm --filter @flow-state-dev/example-guide-custom-pattern typecheck
```

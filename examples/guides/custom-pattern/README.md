# Custom pattern example

Runnable companion code for the [Create your own pattern](https://flow-state.dev/guides/create-your-own-pattern) guide.

A "pattern" is a factory that wraps `taskBoard` into a reusable block. This
example builds `planMapReduce` — plan the work with a block, fan the items
across a worker, then fold the outputs — and a `word-count` flow that uses it.

| File | What it shows |
|------|---------------|
| `src/plan-map-reduce.ts` | The pattern factory. Owns the board; runs a `plan` **block**, seeds tasks from its output, drains via `board.block`, and folds the completed outputs with a `reduce`. A consumer supplies `plan`, `map`, and `reduce`. |
| `src/word-count-flow.ts` | A consumer: plans one item per document, maps each to a word count, reduces to a total. The plan and map blocks are deterministic handlers (in practice `plan` is often a generator). |
| `test/plan-map-reduce.test.ts` | Runs the flow and asserts the reduced total (and the empty case). |

## Run it with fsdev

Run from this directory (config discovery is cwd-only). No API key — the plan
and map blocks are deterministic handlers:

```bash
cd examples/guides/custom-pattern
pnpm fsdev run word-count count -i '{"documents":["a b c","one two","single"]}'
# → { total: 6 }
```

## Test it

```bash
pnpm --filter @flow-state-dev/example-guide-custom-pattern test
pnpm --filter @flow-state-dev/example-guide-custom-pattern typecheck
```

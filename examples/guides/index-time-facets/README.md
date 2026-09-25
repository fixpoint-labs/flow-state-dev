# Index-time facets

Runnable companion code for [Find by facets](https://flow-state.dev/docs/resources/searching#find-by-facets).
A ticket collection classifies each ticket's body once, when it's written, and searches the
stored answers with no model call.

| File | What it shows |
|------|---------------|
| `src/facets.ts` | The questions, the stored answer shape, and the match a search runs. |
| `src/index-facets.ts` | The `contentUpdated` reaction: clear, classify on a side chain, store only if still current. Copy this one. |
| `src/flow.ts` | The collection and the `write`, `search` and `reindex` actions. The flow takes the evaluator; it never names a model. |
| `fsdev.config.ts` | Where the model is named: Jev through Vercel's AI Gateway when `AI_GATEWAY_API_KEY` is set, `openai/gpt-5.4-mini` otherwise. |
| `test/` | The same flow on the mock evaluation model, including the races that would store stale answers. |

```bash
pnpm test                     # mock evaluation model, no API key
pnpm fsdev run index-time-facets write  -i '{"key":"t1","title":"Charged twice","body":"I was charged twice for March."}'
pnpm fsdev run index-time-facets search -i '{"topic":"billing"}'
```

The config uses the in-memory store, which lasts one process, so a `search` run after a
separate `write` run finds nothing. Point the config at a persistent store to try both from the
command line, or read the tests to see both turns on one store.

The collection has no `client` config on purpose. Content edited straight from a client runs no
reaction, so it would change a body without reclassifying it.

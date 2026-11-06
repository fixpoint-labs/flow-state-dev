# POC · the read sites of the scope-state fill

Throwaway spec evidence for FIX-2576. Not production code; nothing imports it.

**Question:** which calls fill scope state from a schema, and which schema does each pass? The
spec's convergence point rests on the answer: every one must read the flow's merged schema.

```bash
node specs/issues/FIX-2576/poc/read-sites/census.mjs                     # report
node specs/issues/FIX-2576/poc/read-sites/census.mjs --after             # exit 1 while any read is direct
node specs/issues/FIX-2576/poc/read-sites/census.mjs --control           # a planted direct call must be counted
node specs/issues/FIX-2576/poc/read-sites/census.mjs --control-totality  # a mention it can't parse: exit 2
```

**Showed, on `main` at `3dad421f0`:** 7 calls, all in `packages/engine/src`, all passing
`<scope>.stateSchema` directly: three load closures in `createExecutionContext.ts`, three in
`routes/state-routes.ts`, one in `routes/client-session.ts`. `--after` exits 1. Both controls
behave: the planted call is counted (8 of 8), and the planted alias stops the run with exit 2.

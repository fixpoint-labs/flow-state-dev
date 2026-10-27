# POC · does a request's token count survive in production?

**Question.** Per-worker totals need each request's model spend. Today `ctx.request.tokenUsage`
is summed from `block_trace` items' `modelUsage`. With trace observability off — the default
when `NODE_ENV=production` and `FSDEV_TRACE_OBSERVABILITY` is unset — the engine writes lean
traces with no `modelUsage`. Does the count then read zero?

**Run.** One generator reports 8 tokens under an action `tokenBudget` of 5 (`onExceeded:
"error"`), once with observability on and once off. The file is named `.poc.ts` so no suite
finds it; copy it into the engine's tests to run it:

```bash
cd packages/engine
sed 's#../../../../../packages/engine/src#../src#' \
  ../../specs/issues/FIX-2145/poc/request-spend/spend.poc.ts > test/zz-spend-poc.test.ts
npx vitest run test/zz-spend-poc.test.ts; rm test/zz-spend-poc.test.ts
```

**Result (2026-10-25, main 16a8dab4).**

```
observability on  → error: Token budget exceeded: consumed 8 > 5
observability off → error: none
```

**Verdict: CONFIRMED.** With observability off the request counts 0 tokens, so the budget never
fires. Any total built on today's count would read 0 in production. The spec's D3 rests on this.

Throwaway: not production code, not an API promise.

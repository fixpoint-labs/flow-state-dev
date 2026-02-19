# @flow-state-dev/testing

Deterministic test utilities for Flow State Dev runtime contracts.

This package provides:
- isolated runtime harness creation (`createTestContext`)
- block/flow test helpers (`testBlock`, `testSequencer`, `testRouter`, `testFlow`)
- item assertion helpers (`testItems`)
- snapshot trace summaries (`snapshotTrace`)
- scripted generator mocks (`mockGenerator`)

## Public API

- `createTestContext(options?)`
- `testBlock(block, options)`
- `testSequencer(sequencer, options)`
- `testRouter(router, options)`
- `testFlow(options)`
- `testItems(items)`
- `snapshotTrace(result)`
- `mockGenerator(options)`

## Quick usage

```ts
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";

const block = handler<{ amount: number }, { ok: boolean }>({
  name: "increment",
  execute: async (input, ctx) => {
    await ctx.session?.incState({ count: input.amount });
    return { ok: true };
  },
});

const result = await testBlock(block, {
  input: { amount: 1 },
  session: { state: { count: 0 } },
});
```

## Scripts

- `pnpm --filter @flow-state-dev/testing build`
- `pnpm --filter @flow-state-dev/testing typecheck`
- `pnpm --filter @flow-state-dev/testing test`

## Notes

- Utilities are intentionally framework-contract focused, not app-specific.
- `testSequencer` step/work traces are inferred from emitted item provenance in Phase 1.

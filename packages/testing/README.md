# @flow-state-dev/testing

Deterministic test utilities for Flow State Dev runtime contracts.

This package provides:
- isolated runtime harness creation (`createTestContext`)
- block/flow test helpers (`testBlock`, `testSequencer`, `testRouter`, `testFlow`)
- item assertion helpers (`testItems`)
- snapshot trace summaries (`snapshotTrace`)
- scripted generator mocks (`mockGenerator`)
- model-resolver mock adapter (`createMockModelResolver`)

## Public API

- `createTestContext(options?)`
- `testBlock(block, options)`
- `testSequencer(sequencer, options)`
- `testRouter(router, options)`
- `testFlow(options)`
- `testItems(items)`
- `snapshotTrace(result)`
- `mockGenerator(options)`
- `createMockModelResolver(options)`

## Quick usage

```ts
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";

const block = handler<{ amount: number }, { ok: boolean }>({
  name: "increment",
  execute: async (input, ctx) => {
    await ctx.session.incState({ count: input.amount });
    return { ok: true };
  },
});

const result = await testBlock(block, {
  input: { amount: 1 },
  session: { state: { count: 0 } },
});
```

### Seeding scope state and resources

`testFlow` and `testBlock` use nested scope seeds:

```ts
const result = await testFlow({
  flow,
  action: "run",
  input: { message: "hello" },
  userId: "devuser",
  seed: {
    session: {
      state: { mode: "chat" },
      resources: {
        artifacts: { byId: {}, order: [] },
      },
    },
    user: {
      state: { preferredModel: "gpt-4o-mini" },
    },
  },
});
```


### Seeding sequencer context in block tests

`testBlock` and `testSequencer` accept `sequencer` to mock the nearest enclosing sequencer (`ctx.sequencer`) and capture sequencer instance state mutations in `result.stateChanges` with `scope: "block_instance"`.

```ts
const result = await testSequencer(mySequencer, {
  input: { value: 1 },
  sequencer: {
    // defaults to the tested block name when omitted
    name: "research",
    state: { progress: 0 },
  },
});

expect(result.state.sequencer.progress).toBeGreaterThanOrEqual(0);
expect(result.stateChanges.some((change) => change.scope === "block_instance")).toBe(true);
```

## Scripts

- `pnpm --filter @flow-state-dev/testing build`
- `pnpm --filter @flow-state-dev/testing typecheck`
- `pnpm --filter @flow-state-dev/testing test`

## Notes

- Utilities are intentionally framework-contract focused, not app-specific.
- `testSequencer` step/work traces are inferred from emitted item provenance in Phase 1.
- Generator mocks are resolved by generator block name first (`generators`) and model id second (`models`).
- `testFlow` accepts `generators`, `models`, and `unmockedGeneratorPolicy` with the same behavior as `testBlock`.

## Architecture Reference

- [Blocks](../../docs/architecture/blocks.md) — block kinds, BlockContext
- [Execution and Errors](../../docs/architecture/execution-and-errors.md) — retry, rescue, error model
- [State and Scopes](../../docs/architecture/state-and-scopes.md) — scope hierarchy, state ops

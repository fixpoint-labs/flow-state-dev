# @flow-state-dev/testing

Test harnesses and mocks for blocks and flows: run one in isolation, script a model, score an eval.

```bash
pnpm add -D @flow-state-dev/testing
```

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

Reference: [the `testing` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/testing).

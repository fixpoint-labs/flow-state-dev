# @flow-state-dev/engine

The runtime: register flows, run actions, stream results, and serve the HTTP API.

```bash
pnpm add @flow-state-dev/engine
```

```ts
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import myFlow from "./flows/my-flow";

export const flowstate = createFlowState({
  flows: { myFlow },
  models: { default: "openai/gpt-6-luna" },
  stores: { default: { primary: inMemoryStores() } },
});
```

Reference: [the `engine` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/engine).

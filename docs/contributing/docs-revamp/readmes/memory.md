# @flow-state-dev/memory

Cross-turn memory for agents: working, episodic, semantic and digest tiers, as one capability.

```bash
pnpm add @flow-state-dev/memory
```

```ts
import { defineFlow, generator } from "@flow-state-dev/core";
import { createMemoryCapability } from "@flow-state-dev/memory";

const mem = createMemoryCapability({
  model: "openai/gpt-6-luna",
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
});

const reader = generator({ uses: [mem] /* ... */ });

export const readerFlow = defineFlow({
  kind: "reader-flow",
  resources: { ...mem.sessionResources, ...mem.userResources },
  actions: { /* ... */ },
});
```

Reference: [the `memory` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/memory).

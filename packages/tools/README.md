# @flow-state-dev/tools

Tool blocks a generator can use as they are, such as web search.

```bash
pnpm add @flow-state-dev/tools
```

```ts
import { generator } from "@flow-state-dev/core";
import { search } from "@flow-state-dev/tools/search";

const researcher = generator({
  name: "researcher",
  model: "openai/gpt-6-luna",
  tools: [search()], // picks a provider from the environment
});
```

Reference: [the `tools` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/tools).

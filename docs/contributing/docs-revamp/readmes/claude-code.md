# @flow-state-dev/claude-code

Run a Claude Code agent in-process as a block, through the Claude Agent SDK.

```bash
pnpm add @flow-state-dev/claude-code @anthropic-ai/claude-agent-sdk
```

```ts
import { generator } from "@flow-state-dev/core";
import { createClaudeCodeAgentCapability } from "@flow-state-dev/claude-code";

const orchestrator = generator({
  name: "orchestrator",
  model: "openai/gpt-6-luna",
  uses: [createClaudeCodeAgentCapability()],
});
```

Reference: [the `claude-code` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/claude-code).

# @flow-state-dev/patterns

Reference implementations of established AI composition patterns using the @flow-state-dev framework.

Each pattern validates that the framework's block composition model handles a specific class of AI architecture cleanly, and serves as a reusable building block for consumer flows.

## Patterns

### RLM (Recursive Language Model)

Implements the Recursive Language Model architecture ([Gao et al. 2025](https://alexzhang13.github.io/blog/2025/rlm/)). An LM that never sees the full context directly — instead using tools to explore, search, and recursively sub-query over large contexts.

**What it validates:**
- Generator-as-tool composition (generator listed in another generator's `tools` array)
- Handler blocks as LLM-callable tools (peek, grep, chunk)
- Session resources for large context storage
- Depth control via tool set restriction (leaf generators omit the recursive tool)

**Zero framework changes required.**

```typescript
import { rlmPipeline, rlmQueryInputSchema, contextResourceStateSchema } from "@flow-state-dev/patterns";

// Wire into your flow as an action
const myFlow = defineFlow({
  actions: {
    rlm: {
      inputSchema: rlmQueryInputSchema,
      block: rlmPipeline
    }
  },
  session: {
    resources: {
      context: { stateSchema: contextResourceStateSchema, writable: true }
    }
  }
});
```

See `examples/kitchen-sink` for a full integration example.

## Shared Plan Schema

All plan-oriented patterns (`planAndExecute`, `supervisor`) share a common base schema for interoperability with the `<Plan />` UI component.

```typescript
import {
  BasePlanSchema,
  BasePlanTaskSchema,
  emitPlanSnapshot,
  type BasePlan,
  type BasePlanTask,
} from "@flow-state-dev/patterns";
```

**`BasePlanTask` status vocabulary:**

| Status | Pattern | Meaning |
|---|---|---|
| `pending` | P&E | Queued, not yet started |
| `in_progress` | both | Actively executing |
| `completed` | both | Done successfully |
| `failed` | P&E | Hard failure |
| `skipped` | P&E | Bypassed (dependency not met) |
| `needs-revision` | Supervisor | Quality gate failed |
| `escalated` | Supervisor | Out of scope |

**`emitPlanSnapshot(ctx, plan)`** emits a `ComponentItem` with `component: "plan"` into the chat stream. Both `planAndExecute` and `supervisor` call this automatically. Custom patterns can call it directly:

```typescript
import { emitPlanSnapshot, type BasePlan } from "@flow-state-dev/patterns";

emitPlanSnapshot(ctx, { goal, tasks, status, iteration });
```

Pair with the `<Plan />` component from `@flow-state-dev/ui` — or use `chatAssistantRenderers` which includes it by default.

## Running tests

```bash
pnpm --filter @flow-state-dev/patterns test
```

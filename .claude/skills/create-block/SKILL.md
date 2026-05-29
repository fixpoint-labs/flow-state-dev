---
name: fsd:create-block
description: Create a new block (handler, generator, utility, or router) following project conventions. Produces the block file, exports, and a matching test file.
argument-hint: "<block kind and purpose, e.g. 'handler that validates email addresses' or 'utility generator for sentiment analysis'>"
---

You are a development agent creating a new block in the flow-state-dev framework. Your job is to produce a correct, idiomatic block implementation with tests, following the project's established patterns exactly.

## Core Principle

**Follow existing patterns, don't invent new ones.** Every block in this codebase follows the same factory pattern. Read a similar existing block before writing yours. If something looks wrong, check the source — don't guess.

## Workflow

### Step 1: Determine Block Kind and Location

Parse $ARGUMENTS to determine:

1. **Block kind** — exactly one of: `handler`, `generator`, `sequencer`, `router`
2. **Whether this is a utility block** — a pre-built factory in `packages/core/src/utility/` that wraps a generator or handler with a config interface
3. **Package location**:
   - Utility blocks: `packages/core/src/utility/<name>.ts`
   - Tool blocks (handler blocks used as generator tools): `packages/tools/src/<name>.ts`
   - Standalone blocks for a specific flow: in the flow's directory
   - Blocks for `@thought-fabric/core`: `packages/thought-fabric/src/<domain>/blocks/`

If the user's description suggests a reusable, configurable generator (like "sentiment analyzer" or "code reviewer"), it's a **utility block**. If it's a handler that does a specific job (like "fetch URL" or "run shell command"), it's a **tool block**.

### Step 2: Read Reference Examples

Before writing any code, read the relevant reference:

**For utility blocks**, read one of these:
- `packages/core/src/utility/summarizer.ts` — clean example of mode-based generator utility
- `packages/core/src/utility/context-reducer.ts` — example with multiple output schemas
- `packages/core/src/utility/decomposer.ts` — example with context/history slots

Many more utility blocks exist in `packages/core/src/utility/` (analyzer, combiner, synthesizer, intent-classifier, etc.). Browse the directory for current examples closest to your target block.

**For handler blocks**, read:
- `packages/core/src/blocks/handler.ts` (first 30 lines for the `HandlerConfig` shape)
- Any handler in `packages/tools/src/` for a tool example

**For routers**, read:
- `packages/patterns/src/routedSpecialists/blocks/dispatch-specialist.ts` — clean router example

**For sequencers**, read:
- `packages/patterns/src/task-board/index.ts` — sequencer composition example

Also read `docs/contributing/best-practices.md` for the active best practices (BP-007 through BP-014).

### Step 3: Write the Block

Follow these patterns exactly:

#### Utility Block Template

```typescript
/**
 * <One sentence: what this utility does and when to use it.>
 */

import { z, type ZodTypeAny } from "zod";
import type { GeneratorConfig } from "../blocks";
import { generator } from "../blocks";

// Default output schema — exported so callers can reference it
export const <name>OutputSchema = z.object({
  // ... fields
});

export interface <Name>Config<
  TOutputSchema extends ZodTypeAny = typeof <name>OutputSchema
> {
  /** Block instance name. */
  name: string;
  /** Model to use. Defaults to "preset/fast". */
  model?: GeneratorConfig["model"];
  /** Override the output schema. */
  outputSchema?: TOutputSchema;
  // ... additional config
}

/**
 * <What it does. When to use it. What it returns.>
 */
export function <name><
  TOutputSchema extends ZodTypeAny = typeof <name>OutputSchema
>(config: <Name>Config<TOutputSchema>) {
  const outputSchema = config.outputSchema ?? <name>OutputSchema;

  return generator({
    name: config.name,
    model: config.model ?? "preset/fast",
    outputSchema,
    prompt: [
      "You are a <role> assistant.",
      config.instructions,  // optional — undefined/null values are filtered out
      // ... instructions
      "Return output that exactly matches the required schema."
    ],
    user: (input) => typeof input === "string" ? input : JSON.stringify(input, null, 2)
  });
}
```

**`prompt` accepts `PromptSlot`** — a string, an array of strings/nulls/functions (nulls and undefineds are filtered out, the rest joined with newlines), or a function returning string/null. Prefer array form for composable prompts where some segments are optional config values.

**Additional generator config options** — beyond the template basics, generators support:
- `history: (input, ctx) => ctx.session.items.llm()` — supply conversation history
- `emit: { reasoning: true }` — control which items are emitted (reasoning, messages, toolCalls)
- `providerOptions: { openai: { ... } }` — provider-specific settings
- `providerTools: [providerTool(...)]` — provider-native tools (e.g., web search)

**Three-tier item visibility** — items have roles: `external` (user-visible), `internal` (framework-visible), `trace` (debug only). Use the `emit` config on generators to control what gets emitted. Generators that should hide internal reasoning can suppress message/reasoning items to `trace` or `internal` level.

#### Handler Block Template

```typescript
/**
 * <One sentence: what this handler does.>
 */

import { z } from "zod";
import { handler } from "@flow-state-dev/core";

export const <name>InputSchema = z.object({ /* ... */ });
export const <name>OutputSchema = z.object({ /* ... */ });

export const <name>Block = handler({
  name: "<name>",
  inputSchema: <name>InputSchema,
  outputSchema: <name>OutputSchema,
  execute: async (input, ctx) => {
    // ... logic
    return { /* output matching outputSchema */ };
  }
});
```

#### Capabilities (`uses: [...]`)

When a block needs resources, state schemas, context formatters, or tools from a reusable capability, declare it via `uses`:

```typescript
import { defineCapability, defineResource, handler } from "@flow-state-dev/core";

// Define a capability (usually in its own file)
const counterCapability = defineCapability({
  name: "counter",
  sessionResources: { counter: defineResource({
    stateSchema: z.object({ count: z.number().default(0) }),
    writable: true
  })},
  fns: (ctx) => ({
    increment: async () => {
      const current = ctx.session.resources.counter.state.count;
      await ctx.session.resources.counter.patchState({ count: current + 1 });
    },
    getCount: () => ctx.session.resources.counter.state.count,
  }),
});

// Use it in a block — resources and fns auto-installed
const myHandler = handler({
  name: "count-up",
  uses: [counterCapability],
  inputSchema: z.any(),
  outputSchema: z.object({ newCount: z.number() }),
  execute: async (input, ctx) => {
    await ctx.cap.counter.increment();
    return { newCount: ctx.cap.counter.getCount() };
  },
});
```

**Capabilities with presets** (common for generators):

```typescript
const memoryCapability = defineCapability({
  name: "memory",
  sessionResources: { memory: memoryResource },
  presets: {
    context: { context: [memoryContextFormatter] },  // Injects into generator prompt
    tools: { tools: [recallTool, storeTool] },       // Adds tools to generator
    default: ["context", "tools"],                    // Active by default
  },
  fns: (ctx) => ({
    recall: (query) => { /* ... */ },
    store: (fact) => { /* ... */ },
  }),
});

// Generator with capability (presets auto-apply context + tools)
const agent = generator({
  name: "agent",
  uses: [memoryCapability],
  model: "openai/gpt-4",
  prompt: "You are a helpful assistant.",
});

// Opt out of a preset
const agentNoTools = generator({
  name: "agent-no-tools",
  uses: [memoryCapability.presets({ tools: false })],
  model: "openai/gpt-4",
  prompt: "...",
});
```

**Key capability rules:**
- `uses` works on all block kinds (handler, generator, sequencer, router)
- Resources declared in capabilities are auto-merged into `declaredResources`
- `ctx.cap.<name>` provides the capability's `fns` at runtime (memoized)
- Presets with `default: [...]` are active unless explicitly disabled
- Capabilities can compose other capabilities via their own `uses` field

#### Critical Rules

- **BP-011**: Handlers must NOT call `block.run()` inside `execute`. Compose with a sequencer instead: `.step(generator).step(handler)`.
- **Sequencer DSL methods** beyond `.step()`:
  - `workIf(condition, block)` — conditional background work
  - `stepAll(blocks)` — parallel execution, collect all results
  - `stepAny(blocks)` — try each in order, first success wins
  - `race(blocks)` — parallel execution, first to finish wins
  - `exitIf(condition)` — early exit from the sequence
- **BP-012**: If the block only mutates state, use `.tap()`. No `outputSchema`, no `return input`.
- **BP-014**: Never `return input` from a handler. Return a transformation or use `.tap()`.
- **BP-007**: File header comment required. Document all exports.
- All generators default to `"preset/fast"` model unless the task requires stronger reasoning.
- Schemas belong with their blocks — define `inputSchema` and `outputSchema` in the same file.
- Trust the type system. Don't re-validate typed inputs.

### Step 4: Add Exports

**Utility blocks** — add to `packages/core/src/utility/index.ts`:
```typescript
export { <name>, <name>OutputSchema } from "./<name>";
export type { <Name>Config } from "./<name>";
```

**Tool blocks** — add to `packages/tools/src/index.ts`.

### Step 5: Write Tests

Create a test file following the project's vitest conventions. See the `write-block-tests` skill for detailed test patterns, but the essentials:

**File location**: `packages/<package>/test/<name>.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createMockContext } from "./helpers";

describe("<name>", () => {
  it("returns a <kind> block definition", () => {
    const block = <factory>({ name: "test" });
    expect(block.kind).toBe("<kind>");
    expect(block.name).toBe("test");
  });

  it("produces expected output", async () => {
    const block = <factory>({ name: "test" });
    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return { structuredOutput: { /* expected output */ } };
        }
      })
    });
    const result = await block.run(input, ctx);
    expect(result).toEqual({ /* expected */ });
  });

  it("supports custom output schema", async () => {
    // ... test with overridden outputSchema
  });

  it("is composable inside sequencers", async () => {
    // ... test inside a sequencer chain
  });
});
```

### Step 6: Verify

Run these commands:

```bash
pnpm --filter <affected-package> typecheck
pnpm --filter <affected-package> test
```

If typecheck fails with TS6305, run `pnpm --filter @flow-state-dev/core build` first.

## Guidelines

- **Read before writing.** Always read a similar existing block first. The patterns are consistent — match them.
- **Minimal config surface.** Only expose config options that users will actually need. Start small, expand later.
- **No invented APIs.** Verify every method you call exists in the source. `ctx.session.appendJournal()` does not exist.
- **Schemas are the contract.** The `inputSchema` and `outputSchema` define the block's public API. Get them right.
- **Generators are not handlers.** If you need LLM output, use a generator. If you need to transform data, use a handler. If you need both, use a sequencer with `.step(generator).step(handler)`.

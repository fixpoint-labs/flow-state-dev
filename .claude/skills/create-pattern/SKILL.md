---
name: fsd:create-pattern
description: Create a new composable pattern — a multi-block sequencer composition that solves a recurring agentic architecture problem. Produces the pattern factory, internal blocks, tests, and documentation.
argument-hint: "<pattern name and purpose, e.g. 'debate pattern where two LLMs argue opposing positions'>"
---

You are a development agent creating a new composable pattern in the flow-state-dev framework. Patterns are the highest-level building blocks — multi-block orchestrations that solve architectural problems like planning, coordination, or evaluation.

## Core Principle

**Patterns are dual-use: import-and-use or copy-and-customize.** The factory should work with zero-effort defaults, but every internal block should be replaceable via config for developers who need to customize.

## Workflow

### Step 1: Understand the Pattern

Parse $ARGUMENTS to determine:
1. What architectural problem does this pattern solve?
2. What blocks does it need internally? (generators for LLM decisions, handlers for state ops, routers for dispatch, sequencers for sub-flows)
3. What state does it manage? (sequencer state vs session resources)
4. What's the iteration/control flow? (linear, looping, conditional, parallel)

### Step 2: Read Reference Patterns

Before writing, read at least two existing patterns in `packages/patterns/src/`:

| Pattern | What to learn from it |
|---------|----------------------|
| `plan-and-execute/index.ts` | Config with replaceable sub-blocks, doUntil loop, sequencer state, synthesis step |
| `routedSpecialists/index.ts` | Session resources, router dispatch, controller loop, specialist composition |
| `task-board/index.ts` | TaskCollection substrate, dispatcher + worker registry, concurrent drain, mid-run enqueue |
| `response-auditor/index.ts` | Simpler pattern: linear chain, tap for side effects, evaluation criteria |
| `supervisor/index.ts` | forEachBackground for concurrent work, resource-based coordination |
| `eventActors/index.ts` | Stigmergic multi-agent coordination, actor dispatch, event-driven drain |

Also read:
- `docs/contributing/best-practices.md` — especially BP-011 (no block.run in handlers), BP-012 (use .tap for state-only), BP-014 (never return input)
- `docs/architecture/blocks.md` — block contract and sequencer DSL methods

### Step 3: Design the Pattern Structure

Every pattern follows this structure:

```
packages/patterns/src/<pattern-name>/
  index.ts          # Public factory + re-exports
  schemas.ts        # Zod schemas for state and internal types
  blocks/           # Internal block factories (one per file)
    <step-name>.ts
    ...
```

**Key decisions:**

1. **State location**: Use sequencer state for pattern-internal state (plan, iteration count, queue). Use session resources only when state must survive across multiple pattern invocations or be shared with external blocks.

2. **Default blocks**: Provide working defaults for every internal block. The user should be able to call `myPattern({ name: "x" })` and get something useful without configuring anything.

3. **Config interface**: Every internal block should be overridable via the config. Use `BlockDefinition<any, any>` for block slots.

4. **Capabilities**: If the pattern bundles resources, context formatters, and helper functions that blocks should opt into, package them as a `defineCapability()`. This is the preferred approach when the pattern provides reusable infrastructure that other blocks (outside the pattern) may also need.

### Step 4: Write the Pattern

#### Config Interface

```typescript
import type { BlockDefinition } from "@flow-state-dev/core/types";
import type { GeneratorSlot, ToolsSlot, UsesSlot } from "@flow-state-dev/core";
import type { ZodTypeAny } from "zod";

/** Resolvable string — static or computed at runtime from input and context. */
type InstructionsSlot = string | ((input: any, ctx: any) => string | Promise<string>);

export interface <PatternName>Config<
  TOutputSchema extends ZodTypeAny = ZodTypeAny
> {
  /** Name for this pattern instance. Used as block name prefix. */
  name: string;

  /** Override the <role> block. Default: built-in generator. */
  <roleName>?: BlockDefinition<any, any>;

  /** Max iterations before forced exit. Default: <N>. */
  maxIterations?: number;

  /** Output schema for the final result. */
  outputSchema?: TOutputSchema;

  // ---------------------------------------------------------------------------
  // Shared defaults — apply only to default blocks, ignored when overridden.
  // ---------------------------------------------------------------------------

  /** Overall instructions injected into all default internal generators. */
  instructions?: InstructionsSlot;

  /** Context slot applied to default internal generators. */
  context?: GeneratorSlot<any, any>;

  /** Tools forwarded to default internal generators. */
  tools?: ToolsSlot;

  /** Capabilities installed on default internal blocks. */
  uses?: UsesSlot;

  // ---------------------------------------------------------------------------
  // Resource declarations — registered on the outer sequencer.
  // ---------------------------------------------------------------------------

  /** Session resources declared on the outer sequencer. */
  sessionResources?: Record<string, any>;

  /** User resources declared on the outer sequencer. */
  userResources?: Record<string, any>;

  /** Project resources declared on the outer sequencer. */
  projectResources?: Record<string, any>;
}
```

#### Factory Function

```typescript
/**
 * <Pattern Name> Pattern
 *
 * <What it does in 2-3 sentences. What problem it solves.>
 *
 * Pipeline: [step1] -> [step2] -> doUntil(done, [step3 -> step4])
 *
 * State lives on the outer sequencer via stateSchema.
 */
export function <patternName><
  TOutputSchema extends ZodTypeAny = ZodTypeAny
>(config: <PatternName>Config<TOutputSchema>) {
  const stateSchema = create<PatternName>StateSchema();
  const maxIterations = config.maxIterations ?? 10;

  // Internal blocks — use provided overrides or defaults
  const step1 = config.<roleName> ?? createDefault<RoleName>(config.name);
  const step2 = create<Step2>(config.name, stateSchema);

  return sequencer({
    name: config.name,
    stateSchema,
  })
    .then(step1)
    .then(step2)
    .doUntil(
      (result) => result.done,
      step3
    );
}
```

#### Internal Block Factories

Each internal block lives in `blocks/<name>.ts`:

```typescript
/**
 * Creates the <role> block for the <pattern> pattern.
 * <What it does and why it exists.>
 */
export function create<BlockName>(
  name: string,
  stateSchema: ReturnType<typeof create<PatternName>StateSchema>
) {
  return handler({
    name: `${name}-<block-suffix>`,
    inputSchema: z.any(),
    outputSchema: z.object({ /* ... */ }),
    sequencerStateSchema: stateSchema,
    execute: async (input, ctx) => {
      // ... logic using ctx.sequencer!.state and ctx.sequencer!.patchState()
      return { /* output */ };
    },
  });
}
```

#### Forwarding `uses`, `tools`, and Resources

The most common pattern: accept `uses`, `tools`, and resource declarations in your config and forward them to the internal blocks that need them. This is how `planAndExecute` and `supervisor` work.

```typescript
export function <patternName>(config: <PatternName>Config) {
  const { name, uses, tools, instructions, sessionResources, userResources, projectResources } = config;

  // Forward uses/tools to default internal generators (skip when overridden)
  const executor = config.executor ?? generator({
    name: `${name}-executor`,
    model: config.model ?? "openai/gpt-5.4-mini",
    ...(tools !== undefined ? { tools } : {}),
    ...(uses ? { uses: uses as any } : {}),
    prompt: [instructions, "Execute the task."],
    // ...
  });

  // Declare resources on the outer sequencer
  return sequencer({
    name,
    stateSchema,
    ...(sessionResources ? { sessionResources } : {}),
    ...(userResources ? { userResources } : {}),
    ...(projectResources ? { projectResources } : {}),
  })
    .then(executor)
    // ...
}
```

Resources are declared on the outer sequencer so the runtime registers them. `uses` and `tools` go on the generators that actually call LLMs. Only spread them when the consumer hasn't provided a custom override block.

#### Exporting a Capability

Some patterns provide reusable infrastructure (shared resources, context formatters, helper tools) that blocks outside the pattern also need. In that case, export a `defineCapability()` alongside the factory:

```typescript
import { defineCapability, defineResource } from "@flow-state-dev/core";

export const <patternName>Capability = defineCapability({
  name: "<pattern-name>",
  sessionResources: {
    <resourceName>: defineResource({ stateSchema: <schema>, writable: true }),
  },
  presets: {
    context: { context: [<contextFormatter>] },
    tools: { tools: [<readTool>, <writeTool>] },
    default: ["context", "tools"],
  },
  fns: (ctx) => ({
    list: () => ctx.session.resources.<resourceName>.state.items,
    add: async (item) => { /* ... */ },
  }),
});
```

This is the less common case. Most patterns just forward `uses` from their config. Only create a dedicated capability when the pattern owns resources that external blocks should opt into.

#### Sequencer DSL Reference

Beyond the basics (`.then()`, `.doUntil()`, `.tap()`, `.loopBack()`), the sequencer provides additional composition methods useful in patterns:

| Method | Behavior |
|--------|----------|
| `workIf(condition, block)` | Conditional background work dispatch. No-op when falsy. |
| `thenAll(blocks)` | Parallel execution of multiple blocks with the same input. Collects all results (like `Promise.all`). |
| `thenAny(blocks)` | Sequential attempt through blocks in order. Returns the first success, skips the rest. Throws `AggregateError` if all fail. |
| `race(blocks)` | Parallel execution, returns the first success, aborts the rest. Throws `AggregateError` if all fail. |
| `exitIf(condition)` | Early exit from the sequencer chain. Current value becomes the sequencer output. |
| `thenIf(condition, block)` | Conditional step execution. Passthrough when condition is false. |
| `work(block)` / `background(block)` | Fire-and-forget sidechain. Main chain continues immediately. |
| `rescue(handlers)` | Error recovery. Matches thrown errors to handler blocks. |
| `branch(branches)` | Multi-way conditional dispatch with connectors. |

See `packages/core/src/blocks/sequencer-methods.ts` for full type signatures.

#### Instructions Composition

When your pattern has multiple internal generators, use `config.instructions` as a shared base that composes with block-specific prompts. The `prompt` field on generators accepts an array where `null`/`undefined` entries are filtered out:

```typescript
function createDefaultExecutor(config: <PatternName>Config) {
  const basePrompt = "You are a focused task executor. ...";

  return generator({
    name: `${config.name}-executor`,
    // instructions come first, base prompt follows, then block-specific instructions
    prompt: [config.instructions, basePrompt, config.executionInstructions],
    // ...
  });
}

function createDefaultSynthesizer(config: <PatternName>Config) {
  const basePrompt = "Synthesize findings into a coherent answer. ...";

  return generator({
    name: `${config.name}-synthesizer`,
    prompt: [config.instructions, basePrompt, config.synthesizeInstructions],
    // ...
  });
}
```

When `instructions` is a function (dynamic), and the block needs it as context rather than system prompt (e.g., the planner), resolve it in a context formatter:

```typescript
const plannerContext = config.instructions && !config.planner
  ? [
      ...(config.context ? (Array.isArray(config.context) ? config.context : [config.context]) : []),
      async (_input: any, ctx: any) => {
        const resolved = typeof config.instructions === "function"
          ? await config.instructions(_input, ctx)
          : config.instructions;
        return resolved ? `Overall instructions:\n${resolved}` : null;
      },
    ]
  : config.context;
```

#### Task Progress Emission

Patterns that decompose work into trackable tasks should use `taskBoard` as the dispatch primitive. The substrate emits `task-change` (per-task lifecycle) and `task-board-meta` (board-level aggregate) `ComponentItem`s automatically — the UI renders them via `<TaskPlan />`.

```typescript
import { taskBoard } from "../task-board";

const board = taskBoard({
  name: config.name,
  collection: { backing: "request", collectionId: config.name },
  concurrency: 1,
  workers: { default: workerBlock },
  initialTasks: tasks.map(t => ({ id: t.id, goal: t.goal, assignee: "default" })),
});

// board.block plugs into a sequencer; task-change + task-board-meta items
// are emitted automatically as tasks move through pending → in_progress → completed/errored.
```

Pair with `<TaskPlan collectionId={config.name} />` in the UI registry. The legacy `emitPlanMeta` / `emitTaskUpdate` helpers have been retired — new patterns should use the substrate directly.

#### Critical Rules

- **Prefix all internal block names** with `${config.name}-` to avoid collisions when multiple pattern instances exist.
- **BP-011**: Internal handlers must not call `block.run()`. Use sequencer composition.
- **BP-012**: State-mutation-only steps use `.tap()`, not `.then()`.
- **Sequencer state is the default** for pattern-internal state. Only use session resources when state must be shared outside the pattern.
- **Export internal factories** so users can remix them:
  ```typescript
  export { create<BlockName> } from "./blocks/<name>";
  export { create<PatternName>StateSchema } from "./schemas";
  ```
- **Export the capability** if the pattern provides shared infrastructure:
  ```typescript
  export { <patternName>Capability } from "./capability";
  ```

### Step 5: Add Exports

Add to `packages/patterns/src/index.ts`:

```typescript
export { <patternName> } from "./<pattern-name>";
export type { <PatternName>Config } from "./<pattern-name>";
// Also export internal factories for remixing
export { create<BlockName> } from "./<pattern-name>/blocks/<name>";
export { create<PatternName>StateSchema } from "./<pattern-name>/schemas";
```

### Step 6: Write Tests

Create `packages/patterns/test/<pattern-name>.test.ts`. Pattern tests use `testBlock` from `@flow-state-dev/testing`:

```typescript
import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { <patternName> } from "../src/<pattern-name>";

describe("<pattern-name>", () => {
  it("creates a sequencer block", () => {
    const block = <patternName>({ name: "test" });
    expect(block.kind).toBe("sequencer");
    expect(block.name).toBe("test");
  });

  it("runs to completion with defaults", async () => {
    const block = <patternName>({ name: "basic" });
    const result = await testBlock(block, { input: { /* ... */ } });
    expect(result.error).toBeNull();
  });

  it("accepts custom sub-blocks", async () => {
    const custom = handler({
      name: "custom-step",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async () => ({ /* ... */ }),
    });

    const block = <patternName>({
      name: "custom",
      <roleName>: custom,
    });
    const result = await testBlock(block, { input: { /* ... */ } });
    expect(result.error).toBeNull();
  });

  it("respects maxIterations guard", async () => {
    const block = <patternName>({ name: "bounded", maxIterations: 2 });
    const result = await testBlock(block, { input: { /* ... */ } });
    // Verify it stopped at max iterations
  });
});
```

### Step 7: Add a Tier 1 integration scenario (when warranted)

Pattern factories have failure modes that only emerge from full `runAction` composition — claim systems deadlocking, dispatchers looping, sub-agent state bleeding across iterations. `testBlock` doesn't catch these. Add a scenario in `packages/integration-tests/src/scenarios/` when the pattern:

- Uses `taskBoard` or another claim-system substrate.
- Has a dispatcher loop, drain loop, or replan loop.
- Composes multiple sub-blocks whose interaction can deadlock or cycle.
- Passes data between sub-agents through scope state or resources.

Skip this step if the pattern is a thin sequencer (e.g., a static `.then` chain with no loops). Authoring pattern: synthetic fixture flow under `src/scenarios/fixtures/` + scenario file under `src/scenarios/`. Use `unmockedGeneratorPolicy: "error"` so missing mocks surface loudly. See `apps/docs/docs/testing/flow-integration-tests.md` and `packages/integration-tests/README.md`.

### Step 8: Update Documentation

1. Add a section to `packages/patterns/README.md` for the new pattern
2. If it demonstrates a novel framework capability, add a page under `apps/docs/docs/patterns/`

### Step 9: Verify

```bash
pnpm --filter @flow-state-dev/patterns typecheck
pnpm --filter @flow-state-dev/patterns test
```

## Guidelines

- **Defaults must work.** `myPattern({ name: "x" })` with no other config should produce a functioning pipeline. Use utility blocks as defaults where appropriate.
- **State schemas are explicit.** Always define a `stateSchema` for the sequencer. Don't rely on untyped state.
- **Patterns are compositions, not primitives.** If your pattern is a single block, it's a utility, not a pattern. Patterns combine multiple blocks with control flow.
- **Name-prefix everything.** Internal blocks, resources, state keys — all prefixed with the pattern name to support multiple instances in the same flow.
- **Export for remixing.** Users will want to use your internal blocks in their own compositions. Export the factories, not just the top-level pattern.

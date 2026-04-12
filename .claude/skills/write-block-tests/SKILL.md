---
name: fsd:write-block-tests
description: Write or update tests for blocks and patterns following project vitest conventions. Covers mock context setup, generator mocking, state testing, and sequencer composition verification.
argument-hint: "<block or file to test, e.g. 'packages/core/src/utility/summarizer.ts' or 'the new email validator handler'>"
---

You are a development agent writing tests for blocks in the flow-state-dev framework. Your job is to produce thorough, idiomatic tests that follow the project's established testing patterns.

## Core Principle

**Tests verify behavior, not implementation.** Test what the block does (output shape, state mutations, emissions), not how it does it internally. Mock at the model boundary, not at internal functions.

## Workflow

### Step 1: Understand What to Test

Parse $ARGUMENTS to identify:
1. The block(s) to test — read the source file
2. The block kind (handler, generator, sequencer, router, utility, pattern)
3. What the block's contract is: inputSchema, outputSchema, state mutations, emissions

### Step 2: Read Reference Tests

Read the test that most closely matches your block kind:

| Block kind | Reference test file |
|------------|-------------------|
| Utility (generator) | `packages/core/test/summarizer.test.ts` |
| Handler | `packages/core/test/handler.test.ts` |
| Sequencer | `packages/core/test/sequencer.test.ts` |
| Router | `packages/core/test/router.test.ts` |
| Pattern | `packages/patterns/test/event-queue.test.ts` or `packages/patterns/test/blackboard.test.ts` |

Also read `packages/core/test/helpers.ts` — it defines `createMockContext()` which is used in most tests.

### Step 3: Set Up the Test File

**Location**: `packages/<package>/test/<name>.test.ts`

**Imports**:
```typescript
import { describe, expect, it } from "vitest";
import { z } from "zod";
// For unit tests (core package blocks):
import { createMockContext } from "./helpers";
// For integration tests (patterns, cross-package):
import { testBlock } from "@flow-state-dev/testing";
```

### Step 4: Write Tests by Category

#### A. Block Shape Tests

Every block needs at least one shape test:

```typescript
it("returns a <kind> block definition", () => {
  const block = myFactory({ name: "test" });
  expect(block.kind).toBe("<kind>");
  expect(block.name).toBe("test");
});
```

#### B. Generator/Utility Block Tests

Mock the model via `createMockContext({ resolveModel })`:

```typescript
it("produces structured output", async () => {
  const block = myUtility({ name: "test" });

  const ctx = createMockContext({
    resolveModel: () => ({
      modelId: "mock",
      async generate(options: any) {
        // Capture messages for assertion if needed
        return { structuredOutput: { result: "expected" } };
      }
    })
  });

  const result = await block.run("input text", ctx);
  expect(result).toEqual({ result: "expected" });
});
```

**Test prompt content** by capturing messages:

```typescript
it("includes mode-specific instructions", async () => {
  const seenMessages: unknown[] = [];
  const block = myUtility({ name: "test", mode: "strict" });

  const ctx = createMockContext({
    resolveModel: () => ({
      modelId: "m",
      async generate(options: any) {
        seenMessages.push(...options.messages);
        return { structuredOutput: { result: "ok" } };
      }
    })
  });

  await block.run("input", ctx);
  expect(JSON.stringify(seenMessages)).toContain("strict");
});
```

**Test custom output schema**:

```typescript
it("supports custom output schema", async () => {
  const customSchema = z.object({ score: z.number() });
  const block = myUtility({
    name: "custom",
    outputSchema: customSchema
  });

  const ctx = createMockContext({
    resolveModel: () => ({
      modelId: "m",
      async generate() {
        return { structuredOutput: { score: 0.95 } };
      }
    })
  });

  const result = await block.run("input", ctx);
  expect(result).toEqual({ score: 0.95 });
});
```

#### C. Handler Block Tests

Handlers are simpler — no model mocking needed:

```typescript
it("transforms input correctly", async () => {
  const block = myHandler;
  const ctx = createMockContext();
  const result = await block.run({ raw: "test data" }, ctx);
  expect(result).toEqual({ processed: "TEST DATA" });
});
```

**Test state mutations** via mock scope handles:

```typescript
it("mutates session state", async () => {
  let capturedPatch: unknown;
  const ctx = createMockContext({
    session: {
      state: { count: 0 },
      patchState: async (patch: unknown) => { capturedPatch = patch; },
      // ... other scope handle methods
    }
  });

  await block.run(input, ctx);
  expect(capturedPatch).toEqual({ count: 1 });
});
```

#### D. Sequencer State Tests

For blocks that use `ctx.sequencer`:

```typescript
it("reads and writes sequencer state", async () => {
  let patchedState: unknown;
  const block = myBlock;

  const ctx = createMockContext({
    sequencer: {
      state: { progress: 0, items: [] },
      patchState: async (patch: unknown) => { patchedState = patch; },
    }
  });

  await block.run(input, ctx);
  expect(patchedState).toEqual({ progress: 50 });
});
```

#### E. Sequencer Composition Tests

Test that a block works inside a sequencer chain:

```typescript
it("is composable inside sequencers", async () => {
  const { sequencer: seq } = await import("../src");
  const chain = seq({
    name: "test-chain",
    inputSchema: z.object({ text: z.string() })
  })
    .map((input) => input.text)
    .then(myBlock);

  const ctx = createMockContext({ /* ... */ });
  const result = await chain.run({ text: "hello" }, ctx);
  expect(result).toEqual({ /* expected */ });
});
```

#### F. Pattern Tests (using testBlock)

Patterns use `testBlock` from `@flow-state-dev/testing` for integration-level tests:

```typescript
it("runs to completion", async () => {
  const block = myPattern({ name: "test" });
  const result = await testBlock(block, {
    input: { query: "test" }
  });
  expect(result.error).toBeNull();
  expect(result.output).toBeDefined();
});
```

**Create deterministic handler mocks** for pattern sub-blocks:

```typescript
function makeMockExecutor(responses: string[]) {
  let callIndex = 0;
  return handler({
    name: "mock-executor",
    inputSchema: z.any(),
    outputSchema: z.object({ result: z.string() }),
    execute: async () => {
      return { result: responses[callIndex++] ?? "done" };
    }
  });
}
```

#### G. Resource Tests

For blocks that declare `sessionResources`:

```typescript
it("accesses session resources", async () => {
  const resource = defineResource({
    stateSchema: z.object({ items: z.array(z.string()).default([]) }),
    writable: true
  });

  const block = handler({
    name: "resource-user",
    inputSchema: z.any(),
    outputSchema: z.any(),
    sessionResources: { myResource: resource },
    execute: async (input, ctx) => {
      const current = ctx.session.resources.myResource.state;
      await ctx.session.resources.myResource.patchState({
        items: [...current.items, "new"]
      });
      return { added: true };
    }
  });

  // Use testBlock for resource integration
  const result = await testBlock(block, { input: {} });
  expect(result.error).toBeNull();
});
```

### Step 5: Test Coverage Checklist

For each block, verify you have tests for:

- [ ] Block shape (kind, name)
- [ ] Happy path (expected input -> expected output)
- [ ] Custom config options (mode, granularity, custom schemas)
- [ ] Edge cases (empty input, missing optional fields)
- [ ] Error handling (invalid input, failed operations)
- [ ] Composability (works inside a sequencer chain)
- [ ] State mutations (if applicable)
- [ ] Resource access (if applicable)

### Step 6: Verify

```bash
pnpm --filter <affected-package> test
```

All tests should pass. If a test fails, fix the test or the implementation — don't skip.

## Guidelines

- **Mock at the model boundary.** For generators, mock `resolveModel` to return a fake model with a scripted `generate()`. Don't mock internal framework functions.
- **Deterministic mocks.** Use handler blocks with scripted responses as mock sub-blocks in patterns. Avoid random data in tests.
- **No snapshot tests.** Test specific values and shapes. Snapshots are brittle and hide what's actually being tested.
- **One concern per test.** Each `it()` should test one specific behavior. Don't combine "creates block AND produces output AND handles errors" in one test.
- **Test names describe behavior.** Use "produces structured output" not "test 1". Use "handles empty input gracefully" not "edge case".
- **Don't test framework internals.** You're testing your block's behavior, not whether the sequencer DSL works. Trust the framework.

# Good and Bad Tests

In FSD, the public surface of a block is its `inputSchema`, `outputSchema`, the items it emits to the stream, the state ops it applies, the lifecycle hooks it fires, and any errors it surfaces. Tests cross that surface. Anything beyond it — which helper got called, which `.then()` step intermediate value looked like — is implementation.

## Good tests

**Integration-style** — exercise the block through `@flow-state-dev/testing`'s mock context, against real `BlockContext`, real state stores (in-memory), and real composition.

```typescript
// GOOD: tests an observable behaviour through the public surface
test("validateInput handler returns a clean profile when input is well-formed", async () => {
  const { runBlock } = createTestHarness();
  const result = await runBlock(validateInput, {
    name: "Alice",
    email: "alice@example.com",
  });

  expect(result.output).toEqual({
    name: "Alice",
    email: "alice@example.com",
    normalised: true,
  });
});

// GOOD: a sequencer test asserting on the terminal items emitted
test("intakeFlow emits a message item then a block_output with the persisted id", async () => {
  const { runAction, items } = createTestHarness();
  await runAction(orderFlow, "intake", { sku: "abc-123" });

  const messages = items.filter((i) => i.type === "message");
  const blockOutputs = items.filter((i) => i.type === "block_output");

  expect(messages).toHaveLength(1);
  expect(blockOutputs.at(-1)?.output).toMatchObject({ orderId: expect.any(String) });
});

// GOOD: a generator test using mockGenerator from @flow-state-dev/testing
test("summarizer generator emits a single message item with the model output", async () => {
  const harness = createTestHarness({
    mockGenerator: (config) => ({ text: "Three lines of summary." }),
  });
  const { items } = await harness.runBlock(summarizer, { source: longInput });

  const message = items.find((i) => i.type === "message");
  expect(message?.content).toContain("Three lines of summary.");
});
```

Characteristics:

- Asserts on observable outcomes (output values, emitted items, state changes)
- Uses public block / pattern surfaces only
- Does not assert on intermediate `.then()` step shapes inside a sequencer
- Does not assert on which model call was made or in what order
- Survives internal refactors — renaming a private helper or restructuring composition does not break it
- Reads like a behavioural spec

## Bad tests

**Implementation-detail tests** — coupled to internal structure of the block, sequencer, or runtime.

```typescript
// BAD: mocks an internal collaborator (the persistence helper isn't a
//      seam — it's an implementation detail of the handler)
test("saveOrder calls persistOrder", async () => {
  const persistOrder = vi.fn();
  await saveOrder({ sku: "abc" }, { persistOrder });
  expect(persistOrder).toHaveBeenCalledWith({ sku: "abc" });
});

// BAD: peeks at internal state through a non-public path
test("processOrder marks the request scope as processing", async () => {
  await processOrder.execute({ sku: "abc" }, ctx);
  expect(ctx.request._internal.flags.processing).toBe(true);  // private!
});

// BAD: asserts on call order of an internal helper
test("validateAndSave validates first, then saves", async () => {
  const validate = vi.spyOn(internals, "validate");
  const save = vi.spyOn(internals, "save");
  await validateAndSave({ sku: "abc" });
  expect(validate).toHaveBeenCalledBefore(save);
});

// BAD: verifies through external storage instead of through the interface
test("createOrder persists to the store", async () => {
  await createOrder({ sku: "abc" });
  const row = await sqliteStore.raw("SELECT * FROM orders WHERE sku = ?", ["abc"]);
  expect(row).toBeDefined();
});

// GOOD: verifies through the interface
test("createOrder makes the order retrievable", async () => {
  const order = await createOrder({ sku: "abc" });
  const retrieved = await getOrder(order.id);
  expect(retrieved.sku).toBe("abc");
});
```

Red flags:

- Mocking internal blocks, helpers, or collaborators that aren't system boundaries
- Spying on call counts or call order of internal functions
- Asserting on private context fields, intermediate sequencer step outputs, or generator internals
- Verifying through SQL queries / direct store reads instead of going through the block's interface
- Test name describes *how* (`"calls foo"`) instead of *what* (`"returns the persisted record"`)
- Test breaks when the implementation is refactored without behavioural change

## FSD-specific test surfaces

Pick the surface that matches the behaviour being verified:

| Surface | When to reach for it |
|---|---|
| Co-located `*.spec.ts` next to `foo.ts` with `createTestHarness` from `@flow-state-dev/testing` | Default. Block / pattern / capability unit-style behaviour. Fastest loop. |
| `fsdev block <path>` invocation in a test | When the block has zero dependencies and you want a one-shot JSON-in / JSON-out assertion. Useful for handler / utility-generator regression tests. |
| Full `fsdev run` with NDJSON capture | When the behaviour only emerges from a real flow execution (sequencer composition + state scope + multiple actions). Verify against parsed NDJSON. |
| `packages/integration-tests/` (Tier 1) | When the behaviour spans multiple packages — e.g. server emits, client receives, react renders correctly. |

## Common FSD anti-patterns dressed up as good tests

These look like coverage but aren't:

- **Schema-only test.** `expect(block.outputSchema.parse(result.output)).toBeDefined()` — Zod already validates this at runtime. The test adds nothing.
- **Snapshot of internal state.** `expect(ctx.session.getState()).toMatchSnapshot()` — couples the test to current state structure; refactors of how state is stored break unrelated tests.
- **Assertion on `block_output.output.length`.** Tests the cardinality of items, not their content. A regression that emits the right number of items with the wrong content passes.
- **`expect(ctx.resolveModel).toHaveBeenCalled()`.** A generator using a model is the trivial case. Test that it produced the *right* effect with the model, not that it touched it.
- **Test that re-implements the block.** `expect(handler.execute(input)).toEqual(transform(input))` where `transform` is a copy of the handler's logic in the spec file. The test will agree with the implementation by construction — it can't catch real bugs.

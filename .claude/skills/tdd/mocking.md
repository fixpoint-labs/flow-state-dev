# When to Mock

Mock at **system boundaries** only. In FSD, that means a small list — and a deliberately small list, because the framework already provides substitutes for most of them.

## What to mock

- **LLM providers.** Use `mockGenerator` (from `@flow-state-dev/testing`) instead of a real Vercel AI SDK call. Returns a deterministic `{ text, toolCalls?, finishReason? }` for the generator's model loop. Lets you simulate happy paths, tool calls, multiple iterations, and `step_error` triggers without network or non-determinism.
- **True external services** in tool blocks — Stripe, third-party HTTP APIs, email senders, anything the framework doesn't own. Inject the SDK or fetcher as a dependency; pass a mock in the spec.
- **Time and randomness.** Pin `Date.now()` and `Math.random()` (or whatever wrapper your block uses) when behaviour depends on them. `vi.useFakeTimers()` for date-sensitive logic.
- **File system access** (rare in FSD core, common in CLI work) — use an in-memory fs or stub the read/write functions injected into the block.

## What NOT to mock

- **Other blocks.** A sequencer composing handler → generator → handler should run the real handlers and the real generator (with `mockGenerator` for the LLM call). Mocking an upstream block in a sequencer test makes the sequencer's composition logic untested.
- **Store adapters.** Use the in-memory store (the canonical second adapter at the `StoreRegistry` seam). It is fast, deterministic, and exercises the real persistence contract. `@flow-state-dev/store-sqlite` is also fine if the test specifically needs persistence semantics.
- **Capabilities.** They're FSD's primary unit of deep-module leverage — mocking a capability defeats the point.
- **Patterns.** Same reasoning as blocks; run the real pattern factory.
- **Item types, scopes, the streaming runtime.** These are the framework's contract surface; testing past them gives false confidence.
- **`@flow-state-dev/testing`'s mock context itself.** It is already a test substitute; double-mocking it adds nothing.

## Designing for mockability at real boundaries

When you do need to mock — at an LLM provider, an external SDK, or a third-party service — design the seam so the mock is trivial.

**1. Inject the dependency. Don't construct it inside the block.**

```typescript
// Easy to mock
const sendInvoiceTool = handlerBlock({
  name: "send-invoice",
  inputSchema: invoiceSchema,
  execute: async (input, ctx) => {
    return ctx.tools.stripe.charges.create({ amount: input.total });
  },
});

// Hard to mock — the block reaches for the SDK directly
const sendInvoiceTool = handlerBlock({
  name: "send-invoice",
  inputSchema: invoiceSchema,
  execute: async (input) => {
    const client = new StripeClient(process.env.STRIPE_KEY);
    return client.charges.create({ amount: input.total });
  },
});
```

In FSD, the framework convention is to wire SDKs into a capability (`defineCapability({ tools: { stripe: stripeClient } })`) and let blocks consume them via `uses: [cap]` or `ctx.tools.stripe`. That keeps the production wiring and the test substitution at the same seam.

**2. Prefer one mock per operation over a single fetch wrapper.**

```typescript
// GOOD: each operation is independently substitutable
const stripeTools = {
  createCharge: async (input) => stripeClient.charges.create(input),
  refundCharge: async (id) => stripeClient.refunds.create({ charge: id }),
};

// BAD: a single dispatcher means every mock needs conditional logic
const stripeTools = {
  call: async (op: string, input) => {
    if (op === "charge") return stripeClient.charges.create(input);
    if (op === "refund") return stripeClient.refunds.create(input);
  },
};
```

Per-operation tools also map cleanly onto FSD's tool-block taxonomy — each becomes its own `handlerBlock` exported by `@flow-state-dev/tools` or a downstream package.

**3. Provide a typed mock factory in `@flow-state-dev/testing` or alongside the production adapter.**

When the same boundary gets mocked across many specs, hoist the mock factory next to the production code so the type stays in lockstep:

```typescript
// alongside the real Stripe wiring
export const createMockStripeTools = (overrides: Partial<StripeTools> = {}): StripeTools => ({
  createCharge: vi.fn().mockResolvedValue({ id: "ch_mock", status: "succeeded" }),
  refundCharge: vi.fn().mockResolvedValue({ id: "re_mock" }),
  ...overrides,
});
```

Tests then opt in to a single override:

```typescript
const tools = createMockStripeTools({
  createCharge: vi.fn().mockRejectedValue(new TimeoutError()),
});
```

This is the difference between specs that read like behavioural specs (one override per test) and specs that read like mock-config dumps.

## Worked example: a generator that calls a tool that calls Stripe

A generator that uses a `chargeCustomer` tool block, which in turn calls Stripe:

- **Mock:** the Stripe SDK (`ctx.tools.stripe.charges.create`) and the LLM (`mockGenerator`).
- **Don't mock:** the tool block, the generator, the sequencer that wraps them, the capability that wires it all together.
- **Assert on:** the items emitted (a `block_output` with the tool call, a `step_error` if the charge failed, a final `message` with the model's response), the state changes (a `state_change` recording the charge id under `session/lastCharge`), and the action's terminal output.

The test exercises the **real composition**, with mocks only at the two genuine system boundaries.

## A note on `vi.spyOn`

`vi.spyOn` is a tool for *asserting on calls*. Almost every use of it in FSD specs is a sign of the implementation-detail anti-pattern. The only legitimate use is when the spy IS the assertion — verifying that the framework called your boundary function with the right arguments. If the spied function is internal to the package under test, the test is testing implementation.

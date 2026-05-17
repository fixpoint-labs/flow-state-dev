/**
 * Type-level tests for FIX-616 Step 4: sequencer-level `stateSchema` flows
 * into the `ctx.sequencer.state` typing observed inside every DSL callback
 * (`.map`, `.tap`, `.tapIf`, `.thenIf`, `.doUntil`, inline configs, branch
 * conditions, etc.). When `stateSchema` is absent, `ctx.sequencer.state`
 * remains the loose `Record<string, unknown>` default — no regression.
 *
 * These tests are compile-only: a `.spec.ts` runner is not needed. Static
 * assertions use the local `Assert<Equal<A, B>>` pattern.
 */
import { z } from "zod";
import { handler, router, sequencer } from "../../blocks";

// ---------- minimal type-level assertion helpers ----------
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

// ---------- shared block fixtures ----------
const addOne = handler({
  name: "add-one",
  inputSchema: z.number(),
  outputSchema: z.number(),
  execute: (value) => value + 1
});

const square = handler({
  name: "square",
  inputSchema: z.number(),
  outputSchema: z.number(),
  execute: (value) => value * value
});

const stateSchema = z.object({ count: z.number() });

// ---------- 1. `.map` sees typed sequencer state ----------
sequencer({ name: "map-state", inputSchema: z.number(), stateSchema })
  .map((input, ctx) => {
    // ctx.sequencer.state.count must be `number`, not `unknown`.
    type State = NonNullable<typeof ctx.sequencer>["state"];
    type _check = Assert<Equal<State["count"], number>>;
    void input;
    return ctx.sequencer!.state.count;
  });

// ---------- 2. `.tap` (fn form) sees typed state ----------
sequencer({ name: "tap-state", inputSchema: z.number(), stateSchema })
  .tap((input, ctx) => {
    type State = NonNullable<typeof ctx.sequencer>["state"];
    type _check = Assert<Equal<State["count"], number>>;
    void input;
    void ctx.sequencer!.state.count;
  });

// ---------- 3. Inline `.then(handler, { execute })` sees typed state ----------
sequencer({ name: "inline-then-state", inputSchema: z.number(), stateSchema })
  .then(addOne)
  .then(handler, {
    outputSchema: z.number(),
    execute: (input, ctx) => {
      type State = NonNullable<typeof ctx.sequencer>["state"];
      type _check = Assert<Equal<State["count"], number>>;
      return input + ctx.sequencer!.state.count;
    }
  });

// ---------- 4. `.branch` condition sees typed state ----------
sequencer({ name: "branch-state", inputSchema: z.number(), stateSchema })
  .then(addOne)
  .branch({
    big: [
      (value) => value,
      (input, ctx) => {
        type State = NonNullable<typeof ctx.sequencer>["state"];
        type _check = Assert<Equal<State["count"], number>>;
        return input > ctx.sequencer!.state.count;
      },
      square
    ],
    small: [(value) => value, (_input, ctx) => ctx.sequencer!.state.count > 0, addOne]
  });

// ---------- 4b. `.thenIf` condition sees typed state ----------
sequencer({ name: "then-if-state", inputSchema: z.number(), stateSchema })
  .thenIf(
    (input, ctx) => {
      type State = NonNullable<typeof ctx.sequencer>["state"];
      type _check = Assert<Equal<State["count"], number>>;
      return input > ctx.sequencer!.state.count;
    },
    addOne
  );

// ---------- 4c. `.tapIf` condition + fn-form callback see typed state ----------
sequencer({ name: "tap-if-state", inputSchema: z.number(), stateSchema })
  .tapIf(
    (value, ctx) => {
      type State = NonNullable<typeof ctx.sequencer>["state"];
      type _check = Assert<Equal<State["count"], number>>;
      return value > ctx.sequencer!.state.count;
    },
    (value, ctx) => {
      type State = NonNullable<typeof ctx.sequencer>["state"];
      type _check = Assert<Equal<State["count"], number>>;
      void value;
      void ctx.sequencer!.state.count;
    }
  );

// ---------- 5. `.doUntil` condition sees typed state ----------
sequencer({ name: "do-until-state", inputSchema: z.number(), stateSchema })
  .doUntil((value, ctx) => {
    type State = NonNullable<typeof ctx.sequencer>["state"];
    type _check = Assert<Equal<State["count"], number>>;
    return value > ctx.sequencer!.state.count;
  }, addOne);

// ---------- 6. router.execute mounted inside a typed sequencer ----------
// Verifies that capability/sequencer state typing flows into a child router's
// `ctx.sequencer.state` via Step 3 wiring. Router blocks define their own
// scope, but when invoked as part of a sequencer chain the parent sequencer's
// state schema is observable through the surrounding ctx.
const childRouter = router({
  name: "child-router",
  inputSchema: z.number(),
  outputSchema: z.number(),
  routes: [addOne, square],
  execute: (input, ctx) => {
    // No assertion here — router.execute's own ctx typing is governed by
    // Step 3; this just ensures the chain compiles when the router is mounted
    // inside a typed sequencer.
    void ctx;
    return input > 5 ? square : addOne;
  }
});

sequencer({ name: "router-in-seq", inputSchema: z.number(), stateSchema })
  .then(childRouter)
  .map((input, ctx) => {
    type State = NonNullable<typeof ctx.sequencer>["state"];
    type _check = Assert<Equal<State["count"], number>>;
    return input + ctx.sequencer!.state.count;
  });

// ---------- 7. Chain preservation: TStateSchema survives every operator ----------
sequencer({ name: "chain-preserve", inputSchema: z.number(), stateSchema })
  .then(addOne)
  .map((value, ctx) => {
    type _check = Assert<Equal<NonNullable<typeof ctx.sequencer>["state"]["count"], number>>;
    return value;
  })
  .tap((value, ctx) => {
    type _check = Assert<Equal<NonNullable<typeof ctx.sequencer>["state"]["count"], number>>;
    void value;
  })
  .then(square)
  .map((value, ctx) => {
    type _check = Assert<Equal<NonNullable<typeof ctx.sequencer>["state"]["count"], number>>;
    return value;
  });

// ---------- 8. Default (no stateSchema): state stays Record<string, unknown> ----------
sequencer({ name: "default-state", inputSchema: z.number() })
  .map((input, ctx) => {
    type State = NonNullable<typeof ctx.sequencer>["state"];
    type _check = Assert<Equal<State, Readonly<Record<string, unknown>>>>;
    void input;
    return ctx.sequencer!.state;
  });

// ---------- 9. Depth stress: 8-field state, 6-deep chain, no TS2589 ----------
const deepStateSchema = z.object({
  f1: z.number(),
  f2: z.string(),
  f3: z.boolean(),
  f4: z.array(z.number()),
  f5: z.object({ nested: z.string() }),
  f6: z.number(),
  f7: z.string(),
  f8: z.boolean()
});

sequencer({ name: "deep", inputSchema: z.number(), stateSchema: deepStateSchema })
  .then(addOne)
  .map((value, ctx) => {
    type _check = Assert<Equal<NonNullable<typeof ctx.sequencer>["state"]["f1"], number>>;
    return value;
  })
  .tap((value, ctx) => {
    type _check = Assert<Equal<NonNullable<typeof ctx.sequencer>["state"]["f5"]["nested"], string>>;
    void value;
  })
  .then(square)
  .map((value, ctx) => {
    type _check = Assert<Equal<NonNullable<typeof ctx.sequencer>["state"]["f3"], boolean>>;
    return value;
  })
  .tap((value, ctx) => {
    type _check = Assert<Equal<NonNullable<typeof ctx.sequencer>["state"]["f8"], boolean>>;
    void value;
  })
  .then(addOne);

export const sequencerStateTypingSmoke = true;

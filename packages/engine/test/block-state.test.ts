/**
 * FIX-914 PR1: block-level state.
 *
 * Generalizes the per-scope-node state container (previously created only for
 * `kind === "sequencer"`) to any block that declares an own-state `stateSchema`,
 * exposed via `ctx.self` (own container) and `ctx.parent` (immediate parent's
 * container, when the child declares `parentStateSchema`).
 */
import { defineCapability, defineFlow, generator, handler, router, sequencer } from "@flow-state-dev/core";
import type { GeneratorModel, GeneratorModelCallOptions, GeneratorModelResult } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createInMemoryStores, runAction } from "../src";

type StepFn = (options: GeneratorModelCallOptions) => GeneratorModelResult;

/** Step-capable mock model — mirrors generator-suspension-resume.test.ts's `stepModel`. */
function stepModel(script: StepFn[], modelId = "step-model") {
  let calls = 0;
  const model: GeneratorModel = {
    modelId,
    async generate() {
      throw new Error("legacy generate must not be called on a step-capable model");
    },
    async generateStep(options) {
      const entry = script[calls];
      calls += 1;
      if (entry === undefined) {
        throw new Error(`no script entry for generateStep #${calls - 1}`);
      }
      return entry(options);
    },
  };
  return model;
}

describe("FIX-914: block-level state", () => {
  it("handler with stateSchema: ctx.self reads and writes its own container", async () => {
    const stateful = handler({
      name: "stateful-handler",
      inputSchema: z.string(),
      outputSchema: z.string(),
      stateSchema: z.object({ note: z.string().nullable().default(null) }),
      execute: async (input, ctx) => {
        await ctx.self!.setState({ note: input });
        return ctx.self!.state.note ?? "unset";
      }
    });

    const flow = defineFlow({
      kind: "block-state-flow",
      actions: { run: { inputSchema: z.string(), block: stateful } }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: "hello",
      userId: "user",
      sessionId: "sess",
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe("hello");
  });

  it("block without stateSchema: ctx.self is undefined", async () => {
    const plain = handler({
      name: "plain-handler",
      inputSchema: z.string(),
      outputSchema: z.boolean(),
      execute: (_input, ctx) => ctx.self === undefined
    });
    const flow = defineFlow({
      kind: "no-state-flow",
      actions: { run: { inputSchema: z.string(), block: plain } }
    })();
    const result = await runAction({
      flow,
      actionName: "run",
      input: "x",
      userId: "user",
      sessionId: "sess",
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });
    expect(result.error).toBeUndefined();
    expect(result.output).toBe(true);
  });

  it("self/parent duality: a step reads the enclosing sequencer's state via ctx.parent", async () => {
    const writer = handler({
      name: "writer",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: async (value, ctx) => {
        await ctx.sequencer?.setState({ label: "written-by-sequencer" });
        return value;
      }
    });
    const reader = handler({
      name: "reader",
      inputSchema: z.number(),
      outputSchema: z.string(),
      parentStateSchema: z.object({ label: z.string().nullable() }),
      execute: (_value, ctx) => ctx.parent?.state?.label ?? "missing"
    });

    const pipeline = sequencer({
      name: "duality-seq",
      inputSchema: z.number(),
      stateSchema: z.object({ label: z.string().nullable().default(null) })
    })
      .step(writer)
      .step(reader);

    const flow = defineFlow({
      kind: "duality-flow",
      actions: { run: { inputSchema: z.number(), block: pipeline } }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: 0,
      userId: "user",
      sessionId: "sess",
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe("written-by-sequencer");
  });

  it("loop-body isolation: a step's own ctx.self resets each .loopBack pass", async () => {
    const observedCounts: number[] = [];
    const inc = handler({
      name: "inc-with-own-state",
      inputSchema: z.number(),
      outputSchema: z.number(),
      stateSchema: z.object({ callCount: z.number().default(0) }),
      execute: async (value, ctx) => {
        await ctx.self!.incState({ callCount: 1 });
        observedCounts.push(ctx.self!.state.callCount);
        return value + 1;
      }
    });

    const seq = sequencer({ name: "loop-isolation", inputSchema: z.number() })
      .step(inc)
      .loopBack("inc-with-own-state", { when: (value) => (value as number) < 3, maxIterations: 5 });

    const flow = defineFlow({
      kind: "loop-isolation-flow",
      actions: { run: { inputSchema: z.number(), block: seq } }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: 0,
      userId: "user",
      sessionId: "sess",
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe(3);
    // Each pass gets a fresh scope node (`loop[N]`), so the step's own
    // container resets — callCount is 1 every time, never accumulating.
    expect(observedCounts).toEqual([1, 1, 1]);
  });

  it("loop-owner accumulation: the sequencer's own state persists across its own .loopBack passes", async () => {
    const inc = handler({
      name: "inc-touching-owner",
      inputSchema: z.number(),
      outputSchema: z.number(),
      sequencerStateSchema: z.object({ passes: z.number() }),
      execute: async (value, ctx) => {
        await ctx.sequencer?.incState({ passes: 1 });
        return value + 1;
      }
    });
    const reportPasses = handler({
      name: "report-passes",
      inputSchema: z.number(),
      outputSchema: z.number(),
      sequencerStateSchema: z.object({ passes: z.number() }),
      execute: (_value, ctx) => ctx.sequencer!.state.passes
    });

    const seq = sequencer({
      name: "loop-owner-accum",
      inputSchema: z.number(),
      stateSchema: z.object({ passes: z.number().default(0) })
    })
      .step(inc)
      .loopBack("inc-touching-owner", { when: (value) => (value as number) < 3, maxIterations: 5 })
      .step(reportPasses);

    const flow = defineFlow({
      kind: "loop-owner-accum-flow",
      actions: { run: { inputSchema: z.number(), block: seq } }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: 0,
      userId: "user",
      sessionId: "sess",
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    // Loop runs 3 passes (0 -> 1 -> 2 -> 3); the sequencer keeps the SAME
    // container across every pass (unlike a step's own container, which
    // resets each pass — see the isolation test above), so `passes` reaches 3.
    expect(result.output).toBe(3);
  });

  it("forEach isolation: each iteration's own ctx.self is private to that iteration", async () => {
    const item = handler({
      name: "item-with-own-state",
      inputSchema: z.number(),
      outputSchema: z.number(),
      stateSchema: z.object({ seen: z.number().default(0) }),
      execute: async (value, ctx) => {
        await ctx.self!.incState({ seen: 1 });
        return ctx.self!.state.seen + value;
      }
    });

    const pipeline = sequencer({ name: "foreach-isolation", inputSchema: z.array(z.number()) }).forEach(item);

    const flow = defineFlow({
      kind: "foreach-isolation-flow",
      actions: { run: { inputSchema: z.array(z.number()), block: pipeline } }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: [10, 20, 30],
      userId: "user",
      sessionId: "sess",
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    // Each iteration's `seen` starts fresh at 0 → incremented once → 1.
    // A shared/leaking container would show accumulation (2, 3, ...).
    expect(result.output).toEqual([11, 21, 31]);
  });

  it("generator: ctx.self accumulates across the tool loop, written via a tool's ctx.parent", async () => {
    const seenContexts: string[] = [];
    const track = handler({
      name: "track",
      inputSchema: z.object({ id: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      parentStateSchema: z.object({ loaded: z.array(z.string()).default([]) }),
      execute: async (input, ctx) => {
        await ctx.parent?.pushState?.("loaded", input.id);
        return { ok: true };
      }
    });

    const model = stepModel([
      () => ({ toolCalls: [{ toolCallId: "c1", toolName: "track", args: { id: "a" } }], finishReason: "tool-calls" }),
      () => ({ toolCalls: [{ toolCallId: "c2", toolName: "track", args: { id: "b" } }], finishReason: "tool-calls" }),
      () => ({ text: "done", finishReason: "stop" }),
    ]);

    const researcher = generator({
      name: "researcher",
      model,
      prompt: "p",
      tools: [track],
      stateSchema: z.object({ loaded: z.array(z.string()).default([]) }),
      context: (_input, ctx) => {
        const loaded = ctx.self?.state.loaded ?? [];
        seenContexts.push(loaded.join(","));
        return `loaded: ${loaded.join(", ")}`;
      }
    });

    const flow = defineFlow({
      kind: "gen-self-accum-flow",
      actions: { run: { block: researcher, inputSchema: z.object({}) } }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "user",
      sessionId: "sess",
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe("done");
    // Later steps see earlier tool writes accumulated on the generator's own
    // container — the tool's own `ctx.self` resets per call, so it reaches
    // the generator's stable container via `ctx.parent`.
    expect(seenContexts).toEqual(["", "a", "a,b"]);
  });

  it("router: declaring stateSchema gives it a working ctx.self (previously sequencer-only)", async () => {
    const routeA = handler({
      name: "route-a",
      inputSchema: z.number(),
      outputSchema: z.string(),
      execute: () => "picked-a"
    });

    let observedPicks: number | undefined;
    const pickRouter = router({
      name: "pick",
      inputSchema: z.number(),
      outputSchema: z.string(),
      stateSchema: z.object({ picks: z.number().default(0) }),
      routes: [routeA],
      execute: async (_input, ctx) => {
        // Read side of the FIX-814 suspendable-router purity contract: a
        // router may observe its own state but must not mutate it here.
        observedPicks = ctx.self?.state.picks;
        return routeA;
      }
    });

    const flow = defineFlow({
      kind: "router-self-flow",
      actions: { run: { inputSchema: z.number(), block: pickRouter } }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: 1,
      userId: "user",
      sessionId: "sess",
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe("picked-a");
    expect(observedPicks).toBe(0);
  });

  it("ctx.parent.state stays live when captured into a local variable across a write", async () => {
    let staleRead: number | undefined;
    let freshRead: number | undefined;
    const writer = handler({
      name: "writer-owner",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (value) => value
    });
    const reader = handler({
      name: "reader",
      inputSchema: z.number(),
      outputSchema: z.number(),
      parentStateSchema: z.object({ count: z.number().default(0) }),
      execute: async (value, ctx) => {
        const p = ctx.parent;
        await p?.setState?.({ count: value });
        // Read back through the SAME captured reference — must reflect the
        // write, not a snapshot taken when `ctx.parent` was first accessed.
        staleRead = p?.state?.count;
        freshRead = ctx.parent?.state?.count;
        return value;
      }
    });

    const pipeline = sequencer({
      name: "live-parent-state",
      inputSchema: z.number(),
      stateSchema: z.object({ count: z.number().default(0) })
    })
      .step(writer)
      .step(reader);

    const flow = defineFlow({
      kind: "live-parent-state-flow",
      actions: { run: { inputSchema: z.number(), block: pipeline } }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: 42,
      userId: "user",
      sessionId: "sess",
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    expect(staleRead).toBe(42);
    expect(freshRead).toBe(42);
  });

  it("ctx.parent's state ops are absent (not present-and-throwing) when the parent declares no stateSchema", async () => {
    let observedParent: unknown;
    const child = handler({
      name: "child-of-stateless-parent",
      inputSchema: z.number(),
      outputSchema: z.boolean(),
      parentStateSchema: z.object({ count: z.number() }),
      execute: (_value, ctx) => {
        observedParent = ctx.parent;
        return ctx.parent?.setState === undefined;
      }
    });

    const pipeline = sequencer({ name: "stateless-owner", inputSchema: z.number() }).step(child);

    const flow = defineFlow({
      kind: "stateless-parent-flow",
      actions: { run: { inputSchema: z.number(), block: pipeline } }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: 1,
      userId: "user",
      sessionId: "sess",
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe(true);
    expect(observedParent).toMatchObject({ name: "stateless-owner", kind: "sequencer" });
  });

  it("ctx.sequencer resolves the enclosing sequencer, not a same-named stateful sibling (regression)", async () => {
    // Before FIX-914, a non-sequencer block never had a container, so a
    // same-named sibling could never shadow ctx.sequencer's getTarget(name)
    // lookup (siblings resolve before ancestors). Now that any block can
    // declare stateSchema, a sibling sharing the sequencer's name and ALSO
    // declaring stateSchema would shadow it unless ctx.sequencer binds
    // directly to the walked sequencer node instead of by name.
    const decoy = handler({
      name: "shared-name",
      inputSchema: z.number(),
      outputSchema: z.number(),
      stateSchema: z.object({ owner: z.string().default("decoy") }),
      execute: (value) => value
    });
    let observedOwner: string | undefined;
    const reader = handler({
      name: "reader",
      inputSchema: z.number(),
      outputSchema: z.number(),
      sequencerStateSchema: z.object({ owner: z.string() }),
      execute: (value, ctx) => {
        observedOwner = ctx.sequencer?.state.owner;
        return value;
      }
    });

    const seq = sequencer({
      name: "shared-name",
      inputSchema: z.number(),
      stateSchema: z.object({ owner: z.string().default("sequencer") })
    })
      .step(decoy)
      .step(reader);

    const flow = defineFlow({
      kind: "sibling-shadow-flow",
      actions: { run: { inputSchema: z.number(), block: seq } }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: 1,
      userId: "user",
      sessionId: "sess",
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    // "reader" must see the SEQUENCER's own state, not the same-named
    // "decoy" sibling's state.
    expect(observedOwner).toBe("sequencer");
  });
});

describe("FIX-914 PR2: capability-contributed own state", () => {
  it("capability stateSchema gives a generator a working ctx.self, populated by a tool via ctx.parent", async () => {
    const seenContexts: string[] = [];
    const track = handler({
      name: "track-pr2",
      inputSchema: z.object({ id: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      parentStateSchema: z.object({ loaded: z.array(z.string()).default([]) }),
      execute: async (input, ctx) => {
        await ctx.parent?.pushState?.("loaded", input.id);
        return { ok: true };
      }
    });

    // The generator declares NO own `stateSchema` — this capability alone
    // supplies it, the way the skills capability (FIX-911) contributes
    // `activeSkills` to a consuming generator without the generator author
    // redeclaring it.
    const trackingCapability = defineCapability({
      name: "tracking",
      stateSchema: z.object({ loaded: z.array(z.string()).default([]) }),
    });

    const model = stepModel([
      () => ({ toolCalls: [{ toolCallId: "c1", toolName: "track-pr2", args: { id: "a" } }], finishReason: "tool-calls" }),
      () => ({ text: "done", finishReason: "stop" }),
    ]);

    const researcher = generator({
      name: "researcher-pr2",
      model,
      prompt: "p",
      tools: [track],
      uses: [trackingCapability],
      context: (_input, ctx) => {
        const loaded = ctx.self?.state.loaded ?? [];
        seenContexts.push(loaded.join(","));
        return `loaded: ${loaded.join(", ")}`;
      }
    });

    const flow = defineFlow({
      kind: "gen-cap-own-state-flow",
      actions: { run: { block: researcher, inputSchema: z.object({}) } }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "user",
      sessionId: "sess",
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe("done");
    expect(seenContexts).toEqual(["", "a"]);
  });
});

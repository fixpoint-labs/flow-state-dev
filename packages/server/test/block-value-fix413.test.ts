/**
 * Tests for FIX-413: BlockValue discriminated union on block_output items.
 *
 * Covers the three BlockValue cases (inline / ref / structure), the flatten-
 * at-emit invariant, and the depth-N pass-through storage property — a
 * nested sequencer chain producing a K-byte payload persists exactly one
 * content-bearing item rather than N copies.
 */
import {
  defineFlow,
  handler,
  router,
  sequencer
} from "@flow-state-dev/core";
import type { BlockOutputItem, BlockValue } from "@flow-state-dev/core/items";
import { resolveBlockValue, buildBlockOutputLookup } from "@flow-state-dev/core/items";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createInMemoryStores,
  createResponseEmitter,
  runAction
} from "../src";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runFlowAndGetBlockOutputs(args: {
  flow: ReturnType<ReturnType<typeof defineFlow>>;
  input: unknown;
  requestId?: string;
}): Promise<{ items: BlockOutputItem[]; allItems: ReturnType<ReturnType<typeof createResponseEmitter>["getItems"]> }> {
  const stores = createInMemoryStores();
  const response = createResponseEmitter({
    requestId: args.requestId ?? "req_fix413",
    now: () => Date.now()
  });
  await runAction({
    flow: args.flow,
    actionName: "run",
    input: args.input,
    userId: "user_1",
    sessionId: "sess_1",
    stores,
    responseEmitter: response
  });
  const allItems = response.getItems();
  const items = allItems.filter(
    (i) => i.type === "block_output"
  ) as BlockOutputItem[];
  return { items, allItems };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FIX-413 BlockValue on block_output", () => {
  it("leaf handler emits inline BlockValue", async () => {
    const double = handler({
      name: "double",
      inputSchema: z.object({ x: z.number() }),
      outputSchema: z.object({ y: z.number() }),
      execute: (input) => ({ y: input.x * 2 })
    });

    const flow = defineFlow({
      kind: "leaf-inline",
      actions: {
        run: { inputSchema: z.object({ x: z.number() }), block: double }
      }
    })();

    const { items } = await runFlowAndGetBlockOutputs({
      flow,
      input: { x: 5 }
    });

    expect(items).toHaveLength(1);
    const out = items[0].output as BlockValue<unknown>;
    expect(out.kind).toBe("inline");
    expect((out as { value: unknown }).value).toEqual({ y: 10 });
  });

  it(".then pass-through: outer sequencer emits a ref to the inner block's item", async () => {
    const inner = handler({
      name: "inner",
      inputSchema: z.string(),
      outputSchema: z.string(),
      execute: (input) => `processed:${input}`
    });

    const pipeline = sequencer({
      name: "outer",
      inputSchema: z.string()
    }).then(inner);

    const flow = defineFlow({
      kind: "ref-then",
      actions: {
        run: { inputSchema: z.string(), block: pipeline }
      }
    })();

    const { items } = await runFlowAndGetBlockOutputs({ flow, input: "hi" });

    const outer = items.find((i) => i.blockName === "outer");
    const innerItem = items.find((i) => i.blockName === "inner");
    expect(outer).toBeDefined();
    expect(innerItem).toBeDefined();

    const outerVal = outer!.output as BlockValue<unknown>;
    expect(outerVal.kind).toBe("ref");
    expect((outerVal as { sourceItemId: string }).sourceItemId).toBe(innerItem!.id);

    // Inner carries the actual content.
    const innerVal = innerItem!.output as BlockValue<unknown>;
    expect(innerVal.kind).toBe("inline");
    expect((innerVal as { value: unknown }).value).toBe("processed:hi");
  });

  it(".map emits inline BlockValue at its own node (transform boundary)", async () => {
    const inner = handler({
      name: "inner-map",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (input) => input + 1
    });

    const pipeline = sequencer({
      name: "map-outer",
      inputSchema: z.number()
    })
      .then(inner)
      .map((n) => n * 100);

    const flow = defineFlow({
      kind: "map-inline",
      actions: {
        run: { inputSchema: z.number(), block: pipeline }
      }
    })();

    const { items } = await runFlowAndGetBlockOutputs({ flow, input: 5 });

    const outer = items.find((i) => i.blockName === "map-outer");
    expect(outer).toBeDefined();
    const outerVal = outer!.output as BlockValue<unknown>;
    // `.map` is the final op — it produces novel content, so the sequencer's
    // overall BlockValue is inline.
    expect(outerVal.kind).toBe("inline");
    expect((outerVal as { value: unknown }).value).toBe(600);
  });

  it(".thenAll emits a structure BlockValue whose entries ref each branch", async () => {
    const branchA = handler({
      name: "branch-a",
      inputSchema: z.string(),
      outputSchema: z.string(),
      execute: (input) => `a:${input}`
    });
    const branchB = handler({
      name: "branch-b",
      inputSchema: z.string(),
      outputSchema: z.string(),
      execute: (input) => `b:${input}`
    });

    const pipeline = sequencer({
      name: "fanout",
      inputSchema: z.string()
    }).thenAll([branchA, branchB]);

    const flow = defineFlow({
      kind: "thenAll-structure",
      actions: {
        run: { inputSchema: z.string(), block: pipeline }
      }
    })();

    const { items } = await runFlowAndGetBlockOutputs({ flow, input: "x" });

    const outer = items.find((i) => i.blockName === "fanout");
    const a = items.find((i) => i.blockName === "branch-a");
    const b = items.find((i) => i.blockName === "branch-b");
    expect(outer).toBeDefined();
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    const outerVal = outer!.output as BlockValue<unknown>;
    expect(outerVal.kind).toBe("structure");
    const shape = (outerVal as { shape: { container: string; entries: BlockValue<unknown>[] } }).shape;
    expect(shape.container).toBe("array");
    expect(shape.entries).toHaveLength(2);
    expect(shape.entries[0]).toMatchObject({ kind: "ref", sourceItemId: a!.id });
    expect(shape.entries[1]).toMatchObject({ kind: "ref", sourceItemId: b!.id });
  });

  it("resolveBlockValue roundtrips inline / ref / structure", async () => {
    const leaf = handler({
      name: "leaf",
      inputSchema: z.string(),
      outputSchema: z.object({ echo: z.string() }),
      execute: (input) => ({ echo: input })
    });

    const pipeline = sequencer({
      name: "fanout2",
      inputSchema: z.string()
    }).thenAll([leaf, leaf]);

    const flow = defineFlow({
      kind: "resolve-roundtrip",
      actions: {
        run: { inputSchema: z.string(), block: pipeline }
      }
    })();

    const { items, allItems } = await runFlowAndGetBlockOutputs({
      flow,
      input: "msg"
    });

    const outer = items.find((i) => i.blockName === "fanout2")!;
    const lookup = buildBlockOutputLookup(allItems as unknown as BlockOutputItem[]);

    const resolved = resolveBlockValue<Array<{ echo: string }>>(outer.output, lookup);
    expect(resolved).toEqual([{ echo: "msg" }, { echo: "msg" }]);
  });

  it("flatten-at-emit: every ref points directly at a content-bearing item", async () => {
    // Depth-4 pass-through pipeline: each outer sequencer .thens an inner one
    // terminating in a generator-less leaf. Every intermediate sequencer's
    // block_output must be a ref directly to the leaf, not a chained ref.
    const leaf = handler({
      name: "deep-leaf",
      inputSchema: z.string(),
      outputSchema: z.string(),
      execute: (input) => `LEAF:${input}`
    });

    const s4 = sequencer({ name: "s4", inputSchema: z.string() }).then(leaf);
    const s3 = sequencer({ name: "s3", inputSchema: z.string() }).then(s4);
    const s2 = sequencer({ name: "s2", inputSchema: z.string() }).then(s3);
    const s1 = sequencer({ name: "s1", inputSchema: z.string() }).then(s2);

    const flow = defineFlow({
      kind: "flatten-depth-4",
      actions: {
        run: { inputSchema: z.string(), block: s1 }
      }
    })();

    const { items } = await runFlowAndGetBlockOutputs({ flow, input: "x" });

    const leafItem = items.find((i) => i.blockName === "deep-leaf")!;
    expect(leafItem).toBeDefined();

    // Every ref in the tree should point at a content-bearing item (inline or
    // structure). Flatten-at-emit forbids ref→ref chains.
    for (const item of items) {
      const value = item.output as BlockValue<unknown>;
      if (value.kind === "ref") {
        const target = items.find((i) => i.id === (value as { sourceItemId: string }).sourceItemId);
        expect(target).toBeDefined();
        const targetValue = target!.output as BlockValue<unknown>;
        expect(targetValue.kind).not.toBe("ref");
      }
    }

    // And specifically: the outermost sequencer refs the leaf directly.
    const s1Item = items.find((i) => i.blockName === "s1")!;
    const s1Val = s1Item.output as BlockValue<unknown>;
    expect(s1Val.kind).toBe("ref");
    expect((s1Val as { sourceItemId: string }).sourceItemId).toBe(leafItem.id);
  });

  it("depth-N pass-through storage: content persists once, not N times", async () => {
    // Construct a deeply nested pass-through with a non-trivial payload.
    // After FIX-413, only the leaf handler's block_output carries the
    // payload — all intermediate sequencers emit refs.
    const PAYLOAD = "x".repeat(500);
    const leaf = handler({
      name: "payload-leaf",
      inputSchema: z.string(),
      outputSchema: z.string(),
      execute: () => PAYLOAD
    });

    const s4 = sequencer({ name: "deep4", inputSchema: z.string() }).then(leaf);
    const s3 = sequencer({ name: "deep3", inputSchema: z.string() }).then(s4);
    const s2 = sequencer({ name: "deep2", inputSchema: z.string() }).then(s3);
    const s1 = sequencer({ name: "deep1", inputSchema: z.string() }).then(s2);

    const flow = defineFlow({
      kind: "depth-n-payload",
      actions: {
        run: { inputSchema: z.string(), block: s1 }
      }
    })();

    const { items } = await runFlowAndGetBlockOutputs({ flow, input: "go" });

    // Count how many items carry the full payload inline.
    let contentCopies = 0;
    for (const item of items) {
      const value = item.output as BlockValue<unknown>;
      if (
        value.kind === "inline" &&
        typeof (value as { value: unknown }).value === "string" &&
        (value as { value: string }).value === PAYLOAD
      ) {
        contentCopies += 1;
      }
    }

    expect(contentCopies).toBe(1);
  });

  it("router emits a ref to its selected route's item", async () => {
    const left = handler({
      name: "left",
      inputSchema: z.string(),
      outputSchema: z.string(),
      execute: (input) => `L:${input}`
    });
    const right = handler({
      name: "right",
      inputSchema: z.string(),
      outputSchema: z.string(),
      execute: (input) => `R:${input}`
    });

    const r = router({
      name: "route",
      inputSchema: z.string(),
      outputSchema: z.string(),
      routes: [left, right],
      execute: (input) => (input.startsWith("L") ? left : right)
    });

    const flow = defineFlow({
      kind: "router-ref",
      actions: {
        run: { inputSchema: z.string(), block: r }
      }
    })();

    const { items } = await runFlowAndGetBlockOutputs({ flow, input: "Left-msg" });

    const routerItem = items.find((i) => i.blockName === "route")!;
    const leftItem = items.find((i) => i.blockName === "left")!;
    expect(routerItem).toBeDefined();
    expect(leftItem).toBeDefined();

    const routerVal = routerItem.output as BlockValue<unknown>;
    expect(routerVal.kind).toBe("ref");
    expect((routerVal as { sourceItemId: string }).sourceItemId).toBe(leftItem.id);
  });

  it(".tap pass-through: sequencer ref-points to the prior step, not the tap target", async () => {
    const main = handler({
      name: "main",
      inputSchema: z.string(),
      outputSchema: z.string(),
      execute: (input) => `main:${input}`
    });
    let tapped = "";
    const pipeline = sequencer({
      name: "tap-seq",
      inputSchema: z.string()
    })
      .then(main)
      .tap((v) => {
        tapped = v;
      });

    const flow = defineFlow({
      kind: "tap-passthrough",
      actions: {
        run: { inputSchema: z.string(), block: pipeline }
      }
    })();

    const { items } = await runFlowAndGetBlockOutputs({ flow, input: "x" });

    expect(tapped).toBe("main:x");
    const outer = items.find((i) => i.blockName === "tap-seq")!;
    const mainItem = items.find((i) => i.blockName === "main")!;
    const outerVal = outer.output as BlockValue<unknown>;
    // `.tap` doesn't change the descriptor; the running ref from `.then(main)`
    // carries through.
    expect(outerVal.kind).toBe("ref");
    expect((outerVal as { sourceItemId: string }).sourceItemId).toBe(mainItem.id);
  });
});

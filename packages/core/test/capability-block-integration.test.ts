/**
 * Integration tests for the capability system's block integration.
 *
 * Verifies that capabilities declared via `uses` on block factories correctly
 * merge resources, state schemas, targets, and presets into the block's
 * effective config. Also covers preset integration, block-kind compatibility
 * enforcement, and transitive capability composition.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineCapability } from "../src/capability";
import { defineResource } from "../src/types/resource";
import { handler } from "../src/blocks/handler";
import { generator } from "../src/blocks/generator";
import { router } from "../src/blocks/router";
import { sequencer } from "../src/blocks/sequencer";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const res1 = defineResource({
  scope: "session",
  stateSchema: z.object({ value: z.string() }),
});

const res2 = defineResource({
  scope: "user",
  stateSchema: z.object({ count: z.number() }),
});

const res3 = defineResource({
  scope: "org",
  stateSchema: z.object({ flag: z.boolean() }),
});

// ---------------------------------------------------------------------------
// Handler with uses
// ---------------------------------------------------------------------------

describe("handler with uses", () => {
  it("capability resources appear in declaredResources", () => {
    const cap = defineCapability({
      name: "cap1",
      resources: { res1 },
    });

    const block = handler({
      name: "test",
      uses: [cap],
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async () => ({}),
    });

    expect(block.declaredResources?.res1).toBe(res1);
  });

  it("multiple capability resources merge correctly", () => {
    const capA = defineCapability({
      name: "capA",
      resources: { res1 },
    });
    const capB = defineCapability({
      name: "capB",
      resources: { res2 },
    });

    const block = handler({
      name: "test",
      uses: [capA, capB],
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async () => ({}),
    });

    expect(block.declaredResources?.res1).toBe(res1);
    expect(block.declaredResources?.res2).toBe(res2);
  });

  it("capability resource + block resource (same ref) deduplicates", () => {
    const cap = defineCapability({
      name: "cap-dedup",
      resources: { res1 },
    });

    const block = handler({
      name: "test",
      uses: [cap],
      resources: { res1 },
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async () => ({}),
    });

    expect(block.declaredResources?.res1).toBe(res1);
    // Should only appear once (same reference)
    expect(Object.keys(block.declaredResources!)).toHaveLength(1);
  });

  it("capability resource + block resource (different ref) throws", () => {
    const cap = defineCapability({
      name: "cap-conflict",
      resources: { res1 },
    });

    expect(() =>
      handler({
        name: "test",
        uses: [cap],
        resources: { res1: res2 },
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: async () => ({}),
      })
    ).toThrow("Resource conflict");
  });
});

// ---------------------------------------------------------------------------
// Generator with uses
// ---------------------------------------------------------------------------

describe("generator with uses", () => {
  it("capability resources appear in declaredResources", () => {
    const cap = defineCapability({
      name: "gen-cap",
      resources: { res1 },
    });

    const gen = generator({
      name: "test",
      uses: [cap],
      model: "preset/fast",
      prompt: "test",
    });

    expect(gen.declaredResources?.res1).toBe(res1);
  });

  it("preset declaring resources merges into declaredResources", () => {
    const cap = defineCapability({
      name: "gen-preset-cap",
      resources: { res1 },
      presets: {
        extra: { resources: { res2 } },
      },
    });

    const gen = generator({
      name: "test",
      uses: [cap],
      model: "preset/fast",
      prompt: "test",
    });

    expect(gen.declaredResources?.res1).toBe(res1);
    expect(gen.declaredResources?.res2).toBe(res2);
  });

  it("active preset is skipped when opted out via .presets({ name: false })", () => {
    const cap = defineCapability({
      name: "gen-optout",
      resources: { res1 },
      presets: {
        extra: { resources: { res2 } },
      },
    });

    const gen = generator({
      name: "test",
      uses: [cap.presets({ extra: false })],
      model: "preset/fast",
      prompt: "test",
    });

    // Required surface still present
    expect(gen.declaredResources?.res1).toBe(res1);
    // Opted-out preset's resources should not appear
    expect(gen.declaredResources?.res2).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Sequencer with uses
// ---------------------------------------------------------------------------

describe("sequencer with uses", () => {
  it("capability resources appear on sequencer declaredResources", () => {
    const cap = defineCapability({
      name: "seq-cap",
      resources: { res1 },
    });

    const seq = sequencer({ name: "test", uses: [cap] });

    expect(seq.declaredResources?.res1).toBe(res1);
  });

  it("capability resources + step resources both appear", () => {
    const cap = defineCapability({
      name: "seq-cap-plus-step",
      resources: { res1 },
    });

    const step = handler({
      name: "step-block",
      resources: { res2 },
      execute: (v) => v,
    });

    const pipeline = sequencer({ name: "test", uses: [cap] }).then(step);

    expect(pipeline.declaredResources?.res1).toBe(res1);
    expect(pipeline.declaredResources?.res2).toBe(res2);
  });

  it("same capability used on sequencer AND a step deduplicates resources", () => {
    const cap = defineCapability({
      name: "shared-cap",
      resources: { res1 },
    });

    const step = handler({
      name: "step-block",
      uses: [cap],
      execute: (v) => v,
    });

    const pipeline = sequencer({ name: "test", uses: [cap] }).then(step);

    expect(pipeline.declaredResources?.res1).toBe(res1);
    // Same reference, so only one entry
    expect(Object.keys(pipeline.declaredResources!)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Router with uses
// ---------------------------------------------------------------------------

describe("router with uses", () => {
  it("capability resources appear in router declaredResources", () => {
    const cap = defineCapability({
      name: "router-cap",
      resources: { res1 },
    });

    const routeBlock = handler({
      name: "route-a",
      execute: () => "a",
    });

    const rt = router({
      name: "test",
      uses: [cap],
      routes: [routeBlock],
      execute: () => routeBlock,
    });

    expect(rt.declaredResources?.res1).toBe(res1);
  });

  it("capability resources merge with route block resources", () => {
    const cap = defineCapability({
      name: "router-cap-merge",
      resources: { res1 },
    });

    const routeBlock = handler({
      name: "route-a",
      resources: { res2 },
      execute: () => "a",
    });

    const rt = router({
      name: "test",
      uses: [cap],
      routes: [routeBlock],
      execute: () => routeBlock,
    });

    expect(rt.declaredResources?.res1).toBe(res1);
    expect(rt.declaredResources?.res2).toBe(res2);
  });
});

// ---------------------------------------------------------------------------
// Block-kind compatibility
// ---------------------------------------------------------------------------

describe("block-kind compatibility", () => {
  it("generator-only preset (with context) on handler throws", () => {
    const cap = defineCapability({
      name: "gen-only-ctx",
      presets: {
        withCtx: { context: () => "some context" },
      },
    });

    expect(() =>
      handler({
        name: "test",
        uses: [cap],
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: async () => ({}),
      })
    ).toThrow("context is only valid on generator blocks");
  });

  it("generator-only preset (with tools) on router throws", () => {
    const toolBlock = handler({
      name: "my-tool",
      execute: () => "tool result",
    });

    const cap = defineCapability({
      name: "gen-only-tools",
      presets: {
        withTools: { tools: [toolBlock] },
      },
    });

    const routeBlock = handler({
      name: "route-a",
      execute: () => "a",
    });

    expect(() =>
      router({
        name: "test",
        uses: [cap],
        routes: [routeBlock],
        execute: () => routeBlock,
      })
    ).toThrow("tools is only valid on generator blocks");
  });

  it("sequencer-only preset (sequencerStateSchema) on handler throws", () => {
    const cap = defineCapability({
      name: "seq-only",
      presets: {
        seqState: { sequencerStateSchema: z.object({ step: z.number() }) },
      },
    });

    expect(() =>
      handler({
        name: "test",
        uses: [cap],
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: async () => ({}),
      })
    ).toThrow("sequencerStateSchema is only valid on sequencer blocks");
  });

  it("resource-only preset works on all block kinds", () => {
    const cap = defineCapability({
      name: "res-only",
      presets: {
        resources: { resources: { res1 } },
      },
    });

    const routeBlock = handler({
      name: "route-a",
      execute: () => "a",
    });

    // Handler
    const h = handler({
      name: "h",
      uses: [cap],
      execute: async () => ({}),
    });
    expect(h.declaredResources?.res1).toBe(res1);

    // Generator
    const g = generator({
      name: "g",
      uses: [cap],
      model: "preset/fast",
      prompt: "test",
    });
    expect(g.declaredResources?.res1).toBe(res1);

    // Sequencer
    const s = sequencer({ name: "s", uses: [cap] });
    expect(s.declaredResources?.res1).toBe(res1);

    // Router
    const r = router({
      name: "r",
      uses: [cap],
      routes: [routeBlock],
      execute: () => routeBlock,
    });
    expect(r.declaredResources?.res1).toBe(res1);
  });
});

// ---------------------------------------------------------------------------
// Preset end-to-end
// ---------------------------------------------------------------------------

describe("preset end-to-end", () => {
  it("default-all-on (no default array) — all presets active, resources merged", () => {
    const cap = defineCapability({
      name: "all-on",
      presets: {
        alpha: { resources: { res1 } },
        beta: { resources: { res2 } },
      },
    });

    const block = handler({
      name: "test",
      uses: [cap],
      execute: async () => ({}),
    });

    expect(block.declaredResources?.res1).toBe(res1);
    expect(block.declaredResources?.res2).toBe(res2);
  });

  it("explicit default array — only listed presets active", () => {
    const cap = defineCapability({
      name: "explicit-default",
      presets: {
        alpha: { resources: { res1 } },
        beta: { resources: { res2 } },
        default: ["alpha"],
      },
    });

    const block = handler({
      name: "test",
      uses: [cap],
      execute: async () => ({}),
    });

    expect(block.declaredResources?.res1).toBe(res1);
    expect(block.declaredResources?.res2).toBeUndefined();
  });

  it(".presets({ nonDefault: true }) adds non-default preset", () => {
    const cap = defineCapability({
      name: "add-non-default",
      presets: {
        alpha: { resources: { res1 } },
        beta: { resources: { res2 } },
        default: ["alpha"],
      },
    });

    const block = handler({
      name: "test",
      uses: [cap.presets({ beta: true })],
      execute: async () => ({}),
    });

    // Both alpha (default) and beta (opted in) should be active
    expect(block.declaredResources?.res1).toBe(res1);
    expect(block.declaredResources?.res2).toBe(res2);
  });

  it(".presets({ defaultPreset: false }) removes default preset", () => {
    const cap = defineCapability({
      name: "remove-default",
      presets: {
        alpha: { resources: { res1 } },
        beta: { resources: { res2 } },
      },
    });

    const block = handler({
      name: "test",
      uses: [cap.presets({ alpha: false })],
      execute: async () => ({}),
    });

    // alpha was disabled, beta should still be active
    expect(block.declaredResources?.res1).toBeUndefined();
    expect(block.declaredResources?.res2).toBe(res2);
  });
});

// ---------------------------------------------------------------------------
// Capability composition
// ---------------------------------------------------------------------------

describe("capability composition", () => {
  it("capability A uses B — block using A gets B's + A's resources", () => {
    const capB = defineCapability({
      name: "capB",
      resources: { res1 },
    });

    const capA = defineCapability({
      name: "capA",
      uses: [capB],
      resources: { res2 },
    });

    const block = handler({
      name: "test",
      uses: [capA],
      execute: async () => ({}),
    });

    expect(block.declaredResources?.res1).toBe(res1);
    expect(block.declaredResources?.res2).toBe(res2);
  });

  it("diamond: A uses B, C uses B — B installed once", () => {
    const capB = defineCapability({
      name: "shared-B",
      resources: { res1 },
    });

    const capA = defineCapability({
      name: "capA",
      uses: [capB],
      resources: { res2 },
    });

    const capC = defineCapability({
      name: "capC",
      uses: [capB],
      resources: { res3 },
    });

    const block = handler({
      name: "test",
      uses: [capA, capC],
      execute: async () => ({}),
    });

    // B's resource should appear exactly once
    expect(block.declaredResources?.res1).toBe(res1);
    // A's and C's resources should also be present
    expect(block.declaredResources?.res2).toBe(res2);
    expect(block.declaredResources?.res3).toBe(res3);
    // res1 + res2 + res3 — three accessor keys total
    expect(Object.keys(block.declaredResources!)).toHaveLength(3);
  });

  it("three-level: A uses B, B uses C — block using A gets C + B + A resources", () => {
    const capC = defineCapability({
      name: "level-C",
      resources: { res3 },
    });

    const capB = defineCapability({
      name: "level-B",
      uses: [capC],
      resources: { res2 },
    });

    const capA = defineCapability({
      name: "level-A",
      uses: [capB],
      resources: { res1 },
    });

    const block = handler({
      name: "test",
      uses: [capA],
      execute: async () => ({}),
    });

    expect(block.declaredResources?.res1).toBe(res1);
    expect(block.declaredResources?.res2).toBe(res2);
    expect(block.declaredResources?.res3).toBe(res3);
  });

  it("factory capability: capFactory({ scope: 'session' }) works", () => {
    function capFactory(opts: { scope: "session" | "user" | "org" }) {
      // The scope is now intrinsic to defineResource. Pick the right resource
      // for the requested scope and install it under a flat accessor key.
      const resourceForScope =
        opts.scope === "session" ? res1
        : opts.scope === "user" ? res2
        : res3;

      return defineCapability({
        name: `factory-${opts.scope}`,
        resources: { picked: resourceForScope },
      });
    }

    const sessionCap = capFactory({ scope: "session" });
    const block = handler({
      name: "test",
      uses: [sessionCap],
      execute: async () => ({}),
    });

    expect(block.declaredResources?.picked).toBe(res1);
    expect(Object.keys(block.declaredResources!)).toEqual(["picked"]);
  });
});

// ---------------------------------------------------------------------------
// Resolved capabilities stored on config
// ---------------------------------------------------------------------------

describe("resolved capabilities stored on config", () => {
  it("blockDef.config.__resolvedCapabilities is an array of flattened capabilities", () => {
    const capB = defineCapability({
      name: "inner-cap",
      resources: { res1 },
    });

    const capA = defineCapability({
      name: "outer-cap",
      uses: [capB],
      resources: { res2 },
    });

    const block = handler({
      name: "test",
      uses: [capA],
      execute: async () => ({}),
    });

    const resolved = (block.config as any).__resolvedCapabilities;
    expect(Array.isArray(resolved)).toBe(true);
    // Flattened: inner-cap first (dependency), then outer-cap
    expect(resolved).toHaveLength(2);
    const names = resolved.map((c: any) => c.name);
    expect(names).toContain("inner-cap");
    expect(names).toContain("outer-cap");
    expect(names.indexOf("inner-cap")).toBeLessThan(names.indexOf("outer-cap"));
  });
});

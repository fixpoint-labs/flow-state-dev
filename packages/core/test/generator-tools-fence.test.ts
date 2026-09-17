/**
 * The tools fence (FIX-1393).
 *
 * A generator's declared `tools:` is a hard access boundary, not a hint: when
 * a block declares the slot, capability-contributed tools (static `uses` and
 * dynamic `uses` alike) are INTERSECTED with it, never unioned onto it. A
 * block that declares `tools: []` reaches the model with no tools at all,
 * whatever capabilities are attached.
 *
 * Declaring nothing is not declaring empty: a block with no `tools:` slot has
 * stated no fence, so capability tools still flow to it — that is how every
 * tool-bearing capability works today.
 *
 * Each test observes the tool list the MODEL actually receives, not an
 * intermediate resolver result, because the fence's whole claim is about what
 * the model can call.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineCapability, generator, handler } from "../src";
import type { CapabilityRef } from "../src";
import { createMockContext, runForTest } from "./helpers";

const declaredTool = handler({
  name: "declaredTool",
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  execute: async () => ({}),
});

const capTool = handler({
  name: "capTool",
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  execute: async () => ({}),
});

/**
 * A capability whose tool is ON by default — the shape that produced every
 * encounter on this line (memory's `recall`, the skills catalog, delegation
 * `agents:`). Tools reach a block through presets, never a top-level `tools`
 * field, so a default-active preset is what "attaching the capability hands
 * the model a tool" actually looks like.
 */
const toolBearingCap = defineCapability({
  name: "tool-bearing",
  presets: { withTools: { tools: [capTool] }, default: ["withTools"] },
});

/** Builds a ctx whose model records the tool names it was offered. */
function recordingCtx(seen: { names: string[] }) {
  return createMockContext({
    resolveModel: () => ({
      modelId: "m",
      async generate(options: any) {
        seen.names = (options.tools ?? []).map((t: any) => t.name);
        return { structuredOutput: { ok: true } };
      },
    }),
  });
}

const genDefaults = {
  model: "m",
  prompt: "p",
  outputSchema: z.object({ ok: z.boolean() }),
} as const;

describe("declared `tools:` fences capability tools", () => {
  it("`tools: []` + a static tool-bearing capability reaches the model with zero tools", async () => {
    const block = generator({
      name: "empty-fence-static",
      ...genDefaults,
      tools: [],
      uses: [toolBearingCap],
    });

    const seen = { names: [] as string[] };
    await runForTest(block, {}, recordingCtx(seen));
    expect(seen.names).toEqual([]);
  });

  it("`tools: []` + a DYNAMIC tool-bearing capability reaches the model with zero tools", async () => {
    const block = generator({
      name: "empty-fence-dynamic",
      ...genDefaults,
      tools: [],
      uses: [(): CapabilityRef[] => [toolBearingCap]],
    });

    const seen = { names: [] as string[] };
    await runForTest(block, {}, recordingCtx(seen));
    expect(seen.names).toEqual([]);
  });

  it("a narrow `tools:` list drops a capability tool outside it", async () => {
    const block = generator({
      name: "narrow-fence",
      ...genDefaults,
      tools: [declaredTool],
      uses: [toolBearingCap],
    });

    const seen = { names: [] as string[] };
    await runForTest(block, {}, recordingCtx(seen));
    expect(seen.names).toEqual(["declaredTool"]);
  });

  it("a `tools:` FUNCTION fences capability tools the same way as an array", async () => {
    // The declaration can be resolver-driven; the fence is the resolved list,
    // recomputed per invocation, not the literal array.
    const block = generator({
      name: "fn-fence",
      ...genDefaults,
      tools: () => [declaredTool],
      uses: [toolBearingCap],
    });

    const seen = { names: [] as string[] };
    await runForTest(block, {}, recordingCtx(seen));
    expect(seen.names).toEqual(["declaredTool"]);
  });

  it("a capability tool the block NAMES survives the fence", async () => {
    // The intersection is by tool name, so declaring a capability's own tool
    // keeps it — the fence narrows, it does not blanket-drop.
    const block = generator({
      name: "named-cap-tool",
      ...genDefaults,
      tools: [capTool],
      uses: [toolBearingCap],
    });

    const seen = { names: [] as string[] };
    await runForTest(block, {}, recordingCtx(seen));
    expect(seen.names).toEqual(["capTool"]);
  });

  it("a block that declares NO `tools:` still receives capability tools", async () => {
    // Undeclared is not declared-empty. Nothing was fenced, so nothing is cut;
    // this is the path every tool-bearing capability relies on.
    const block = generator({
      name: "no-declaration",
      ...genDefaults,
      uses: [toolBearingCap],
    });

    const seen = { names: [] as string[] };
    await runForTest(block, {}, recordingCtx(seen));
    expect(seen.names).toEqual(["capTool"]);
  });
});

/**
 * The tools fence (FIX-1393).
 *
 * A generator's declared `tools:` is a hard access boundary, not a hint: when
 * a block declares the slot, capability-contributed CATALOG tools (static
 * `uses` and dynamic `uses` alike) are dropped rather than unioned onto it. A
 * block that declares `tools: []` reaches the model with no catalog tools at
 * all, whatever capabilities are attached.
 *
 * Declaring nothing is not declaring empty: a block with no `tools:` slot has
 * stated no fence, so capability tools still flow to it — that is how every
 * tool-bearing capability works today.
 *
 * The one carve-out is `controlTools`. A framework control is not a grant from
 * the app's catalog — the block composing the capability is what put it there,
 * and it is typically built inside the capability and never exported, so no
 * `tools:` list could name it back in. Fencing those would leave a seat
 * advertising a tool in its prompt that it cannot call. See
 * `PresetDef.controlTools`.
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

const controlTool = handler({
  name: "controlTool",
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  execute: async () => ({}),
});

/**
 * A capability contributing a fence-exempt CONTROL — the shape of the skills
 * loader and the delegation board. The block asked for this by composing the
 * capability, and the tool is built inside it, so there is no catalog key a
 * `tools:` list could use to let it back in.
 */
const controlBearingCap = defineCapability({
  name: "control-bearing",
  presets: { withControls: { controlTools: [controlTool] }, default: ["withControls"] },
});

/**
 * Both kinds from one capability — what `createSkillsLibrary` actually does:
 * it registers the app catalog (fenceable) AND its own loader (a control).
 * A capability-level exemption would wrongly free the catalog half too.
 */
const mixedCap = defineCapability({
  name: "mixed",
  presets: {
    both: { tools: [capTool], controlTools: [controlTool] },
    default: ["both"],
  },
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
    // Naming it is what keeps it: the declared list is resolved on its own, so
    // the tool arrives through the declaration rather than through the
    // capability. Nothing is intersected — the capability's copy is simply not
    // added a second time.
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

  it("`tools: []` does NOT hold back a capability's control tool", async () => {
    // The carve-out. A seat that switched the skills loader on, or holds a
    // skill that declared `agents:`, keeps that surface even behind the
    // tightest possible fence — it asked for it by composing the capability.
    const block = generator({
      name: "empty-fence-control",
      ...genDefaults,
      tools: [],
      uses: [controlBearingCap],
    });

    const seen = { names: [] as string[] };
    await runForTest(block, {}, recordingCtx(seen));
    expect(seen.names).toEqual(["controlTool"]);
  });

  it("a DYNAMIC capability's control tool also survives `tools: []`", async () => {
    // Controls are collected on the same dynamic traversal as catalog tools,
    // so raising the fence must not skip the walk that finds them.
    const block = generator({
      name: "dynamic-control",
      ...genDefaults,
      tools: [],
      uses: [(): CapabilityRef[] => [controlBearingCap]],
    });

    const seen = { names: [] as string[] };
    await runForTest(block, {}, recordingCtx(seen));
    expect(seen.names).toEqual(["controlTool"]);
  });

  it("one capability's catalog half is fenced while its control half is not", async () => {
    // The case that rules out a capability-level exemption. `mixedCap` grants
    // `capTool` from the catalog and contributes `controlTool` as a control;
    // a declared fence must cut exactly one of them.
    const block = generator({
      name: "mixed-cap",
      ...genDefaults,
      tools: [declaredTool],
      uses: [mixedCap],
    });

    const seen = { names: [] as string[] };
    await runForTest(block, {}, recordingCtx(seen));
    expect(seen.names.sort()).toEqual(["controlTool", "declaredTool"]);
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

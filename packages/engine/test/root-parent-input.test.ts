/**
 * The block a run starts at records its input on its scope, the same way a
 * sequencer records each step's input. So a child of the run's outermost block
 * reads that block's input through `ctx.parent.input`, exactly as it would one
 * level further down — the root of a run is not a special case for authors.
 */
import { DEFAULT_ORG_ID, defineFlow, handler, router, sequencer } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createInMemoryStores, runAction } from "../src";

/** A step that returns whatever its enclosing block received as input. */
const readParentInput = () =>
  handler({
    name: "read-parent-input",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: (_value, ctx) => ctx.parent?.input ?? "missing"
  });

/** Overwrites the value flowing down, so a passing read can only come from `ctx.parent.input`. */
const clobber = handler({
  name: "clobber",
  inputSchema: z.any(),
  outputSchema: z.string(),
  execute: () => "clobbered"
});

async function run(block: BlockDefinition, input: unknown) {
  const flow = defineFlow({
    kind: `root-parent-input-${block.name}`,
    actions: { run: { inputSchema: z.any(), block } }
  })();
  return runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input,
    userId: "user",
    sessionId: "sess",
    stores: createInMemoryStores(),
    runtimeConfig: {}
  });
}

describe("ctx.parent.input under the run's outermost block", () => {
  it("a step of the root sequencer reads the run input", async () => {
    const root = sequencer({ name: "root-seq", inputSchema: z.any() })
      .step(clobber)
      .step(readParentInput());

    const result = await run(root, { ticket: "T-1" });

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ ticket: "T-1" });
  });

  it("a step of a stateful root sequencer reads the run input", async () => {
    // A parent with a stateSchema is exposed through a StateRef rather than a
    // plain descriptor, so this covers the other branch of `ctx.parent`.
    const root = sequencer({
      name: "root-stateful-seq",
      inputSchema: z.any(),
      stateSchema: z.object({ n: z.number().default(0) })
    })
      .step(clobber)
      .step(readParentInput());

    const result = await run(root, { ticket: "T-2" });

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ ticket: "T-2" });
  });

  it("the route a root router selects reads the run input", async () => {
    const leaf = readParentInput();
    const root = router({
      name: "root-router",
      inputSchema: z.any(),
      outputSchema: z.any(),
      routes: [leaf],
      execute: () => leaf
    });

    const result = await run(root, { ticket: "T-3" });

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ ticket: "T-3" });
  });

  it("matches what the same step sees one level down", async () => {
    const inner = sequencer({ name: "inner-seq", inputSchema: z.any() })
      .step(clobber)
      .step(readParentInput());
    const root = sequencer({ name: "outer-seq", inputSchema: z.any() }).step(inner);

    const result = await run(root, { ticket: "T-4" });

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ ticket: "T-4" });
  });
});

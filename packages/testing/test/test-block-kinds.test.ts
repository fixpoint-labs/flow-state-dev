/**
 * `testBlock` is the one helper for testing a block, whatever its kind: a
 * sequencer's result carries its step and side-chain traces, a router's the
 * route it chose. An adopter never picks a second helper for a composite.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handler, router, sequencer } from "@flow-state-dev/core";
import { testBlock } from "../src";

describe("testBlock by the block's kind", () => {
  it("a sequencer's result carries its steps and side-chain results", async () => {
    const double = handler({ name: "double", execute: (n: number) => n * 2 });
    const audit = handler({ name: "audit", execute: (n: number) => `saw ${n}` });
    const pipeline = sequencer({ name: "pipeline", inputSchema: z.number() })
      .step(double)
      .sideChain(audit);

    const result = await testBlock(pipeline, { input: 3 });

    expect(result.error).toBeNull();
    expect(result.output).toBe(6);
    // Typed by kind: no cast reads `steps` off a sequencer's result.
    expect(result.steps.map((s) => s.blockName)).toEqual(expect.arrayContaining(["double", "audit"]));
    expect(result.sideChainResults.map((s) => s.blockName)).toEqual(["audit"]);
    expect(typeof result.loopIterations).toBe("number");
  });

  it("a router's result carries the route it chose", async () => {
    const left = handler({ name: "left", execute: (_input: { route: string }) => "left" });
    const right = handler({ name: "right", execute: (_input: { route: string }) => "right" });
    const chooser = router({
      name: "chooser",
      routes: [left, right],
      execute: (input: { route: string }) => (input.route === "right" ? right : left)
    });

    const result = await testBlock(chooser, { input: { route: "right" } });

    expect(result.output).toBe("right");
    expect(result.selectedRoute).toBe("right");
  });

  it("a leaf block's result names no route", async () => {
    const echo = handler({ name: "echo", execute: (s: string) => s });
    const result = await testBlock(echo, { input: "hi" });
    expect(result.selectedRoute).toBeUndefined();
  });
});

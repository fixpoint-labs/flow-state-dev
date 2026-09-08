/**
 * The test harness reads the config bag the way production does (FIX-1331).
 *
 * A harness that quietly disagreed with the runtime it stands in for is worse
 * than no harness: a block that guards `ctx.flow.config` with `?? {}` would
 * pass here and be dead weight in production, and one that does not would pass
 * in production and crash here.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { testBlock } from "../src";

const seatConfig = z.object({ harness: z.string(), model: z.string() });

/** Reports what it saw, so the assertion is on the value the block read. */
const readConfig = handler({
  name: "read-config",
  inputSchema: z.object({}),
  outputSchema: z.object({ frozen: z.boolean(), seen: z.string() }),
  execute: async (_input, ctx) => ({
    frozen: Object.isFrozen(ctx.flow.config),
    seen: JSON.stringify(ctx.flow.config)
  })
});

describe("test context — the flow config bag", () => {
  /**
   * Behaviour 10. With no flow supplied, the block reads the frozen empty
   * object production gives an unconfigured flow — never `undefined`.
   */
  it("gives a block with no flow supplied a frozen empty bag", async () => {
    const result = await testBlock(readConfig, { input: {} });

    expect(result.error).toBeNull();
    expect(result.output).toEqual({ frozen: true, seen: "{}" });
  });

  /** Behaviour 11. Knobs supplied to the test context reach the block. */
  it("passes a supplied bag through to the block under test", async () => {
    const result = await testBlock(readConfig, {
      input: {},
      flowConfig: { harness: "codex", model: "gpt-5.4" }
    });

    expect(result.error).toBeNull();
    expect(result.output).toEqual({
      frozen: true,
      seen: JSON.stringify({ harness: "codex", model: "gpt-5.4" })
    });
  });

  /**
   * And a real minted instance still wins, so a test that wants the whole
   * flow's behaviour gets that flow's own bag rather than a synthetic one.
   */
  it("reads a supplied instance's own bag rather than the passthrough", async () => {
    // A singleton, so the harness's synthetic session is owned by it — a
    // collection member would refuse the unattributed session (FIX-1322), and
    // that refusal is not what this test is about.
    const engineer = defineFlow({
      kind: "engineer-harness",
      configSchema: seatConfig,
      actions: { work: { block: readConfig } }
    });

    const result = await testBlock(readConfig, {
      input: {},
      flow: engineer({
        config: { harness: "claude-code", model: "opus" }
      }) as unknown as FlowInstance,
      flowConfig: { harness: "ignored", model: "ignored" }
    });

    expect(result.error).toBeNull();
    expect(result.output).toEqual({
      frozen: true,
      seen: JSON.stringify({ harness: "claude-code", model: "opus" })
    });
  });
});

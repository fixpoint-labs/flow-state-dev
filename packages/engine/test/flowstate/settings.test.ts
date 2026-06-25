import { describe, expect, it } from "vitest";
import { defineFlow, handler, type FlowStateSettings } from "@flow-state-dev/core";
import { z } from "zod";
import { createInMemoryStores, runAction } from "../../src";

/**
 * Build a flow whose single handler captures `ctx.settings` into the
 * provided sink, then run it through the real `runAction` engine.
 */
async function runCapturingSettings(
  settings: FlowStateSettings | undefined,
  sink: (value: unknown) => void
): Promise<void> {
  const capture = handler({
    name: "capture-settings",
    inputSchema: z.object({}).passthrough(),
    execute: (_input, ctx) => {
      sink(ctx.settings);
    }
  });

  const flow = defineFlow({
    kind: "settings-flow",
    actions: {
      run: {
        inputSchema: z.object({}).passthrough(),
        block: capture
      }
    }
  })();

  await runAction({
    flow,
    actionName: "run",
    input: {},
    userId: "u1",
    requestId: "req_settings_test",
    stores: createInMemoryStores(),
    runtimeConfig: {
      settings
    }
  });
}

describe("ctx.settings propagation", () => {
  it("threads createFlowState-style settings onto the block context", async () => {
    let captured: unknown;
    await runCapturingSettings(
      { sandbox: "vercel" } as FlowStateSettings,
      (v) => {
        captured = v;
      }
    );
    expect(captured).toEqual({ sandbox: "vercel" });
  });

  it("defaults ctx.settings to an empty object when none are configured", async () => {
    let captured: unknown = "unset";
    await runCapturingSettings(undefined, (v) => {
      captured = v;
    });
    expect(captured).toEqual({});
  });
});

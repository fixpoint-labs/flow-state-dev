/**
 * A block reachable only as a generator's static tool gets the resources it
 * declares on `ctx.resources`, the same as a block reached through composition.
 *
 * The runtime half of the tool edge in `defineFlow`'s resource collection: the
 * core tests pin the flow's resource map, this one pins what the tool's
 * `execute` actually sees when the model calls it.
 */
import { DEFAULT_ORG_ID, defineFlow, defineResource, generator, handler } from "@flow-state-dev/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createInMemoryStores, runAction } from "../src";

const scratchpad = defineResource({
  scope: "session",
  stateSchema: z.object({ notes: z.array(z.string()).default([]) })
});

describe("resources declared on a tool-only block", () => {
  async function runWithTool(options: { flowTools?: boolean; uses?: boolean }) {
    const seen: string[][] = [];

    const note = handler({
      name: "note",
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.string(),
      resources: { scratchpad },
      execute: async (input, ctx) => {
        await ctx.resources.scratchpad.patchState({ notes: [input.text] });
        seen.push(ctx.resources.scratchpad.state.notes);
        return "noted";
      }
    });

    const chat = generator({
      name: "chat",
      inputSchema: z.object({ text: z.string() }),
      model: "mock-model",
      prompt: "take a note",
      tools: [note],
      ...(options.uses ? { uses: [() => []] } : {})
    });

    const flow = defineFlow({
      kind: "tool-only-resources",
      ...(options.flowTools ? { tools: { onToolStarted: () => {} } } : {}),
      actions: { run: { inputSchema: z.object({ text: z.string() }), block: chat } }
    })();

    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: { text: "hi" },
      requestId: "req_tool_res",
      userId: "user_tool_res",
      sessionId: "sess_tool_res",
      stores: createInMemoryStores(),
      runtimeConfig: {
        modelResolver: (modelId) => ({
          modelId,
          async generate(options: any) {
            await options.tools[0].execute({ text: "remember this" });
            return { text: "ok" };
          }
        })
      }
    });

    return { error: result.error, seen };
  }

  it("are on ctx.resources inside the tool's execute", async () => {
    const { error, seen } = await runWithTool({});
    expect(error).toBeUndefined();
    expect(seen).toEqual([["remember this"]]);
  });

  // Flow-level `tools` rebuilds the generator after `uses` has rewritten its
  // `tools` slot; the tool must keep its resources through that rebuild.
  it("stay on ctx.resources when the generator has uses and the flow declares tools", async () => {
    const { error, seen } = await runWithTool({ flowTools: true, uses: true });
    expect(error).toBeUndefined();
    expect(seen).toEqual([["remember this"]]);
  });
});

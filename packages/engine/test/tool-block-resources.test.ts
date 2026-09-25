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
  it("are on ctx.resources inside the tool's execute", async () => {
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
      tools: [note]
    });

    const flow = defineFlow({
      kind: "tool-only-resources",
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

    expect(result.error).toBeUndefined();
    expect(seen).toEqual([["remember this"]]);
  });
});

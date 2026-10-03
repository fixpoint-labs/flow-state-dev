/**
 * `readCommitted` reads through `updateState`, so it needs a ref the block may
 * write. On a `writable: false` resource it is refused as a write, and the
 * projection never runs: the documented limit, pinned here so a change to it
 * is a deliberate one. The writable control shows the same call reading fine.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, defineResource, handler } from "@flow-state-dev/core";
import { readCommitted } from "@flow-state-dev/core/helpers";
import { createInMemoryStores, runAction } from "../src";

function flowWith(writable: boolean) {
  const status = defineResource({
    scope: "session",
    stateSchema: z.object({ status: z.string() }),
    default: { status: "pending" },
    writable
  });
  let projected = 0;
  const read = handler({
    name: "read-status",
    inputSchema: z.object({}),
    outputSchema: z.object({ status: z.string().nullable(), code: z.string().nullable() }),
    resources: { status },
    execute: async (_input, ctx) => {
      try {
        const value = await readCommitted(ctx.resources.status, (state) => {
          projected += 1;
          return state.status;
        });
        return { status: value ?? null, code: null };
      } catch (error) {
        return { status: null, code: String((error as { code?: unknown }).code) };
      }
    }
  });
  const flow = defineFlow({
    kind: `read-committed-${writable ? "writable" : "read-only"}`,
    actions: { read: { inputSchema: z.object({}), block: read } }
  })();
  return { flow, projected: () => projected };
}

async function run(writable: boolean) {
  const { flow, projected } = flowWith(writable);
  const result = (await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "read",
    input: {},
    userId: "u_read",
    sessionId: "s_read",
    stores: createInMemoryStores(),
    runtimeConfig: {}
  })) as { output?: { status: string | null; code: string | null } };
  return { output: result.output, projected: projected() };
}

describe("readCommitted on a resource", () => {
  it("reads a writable resource", async () => {
    expect(await run(true)).toEqual({ output: { status: "pending", code: null }, projected: 1 });
  });

  it("is refused on a writable: false resource, before the projection runs", async () => {
    expect(await run(false)).toEqual({ output: { status: null, code: "resource_read_only" }, projected: 0 });
  });
});

import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowState,
  inMemoryStores,
  type FlowState
} from "@flow-state-dev/engine";
import { type FlowApiRouter } from "@flow-state-dev/engine/host";
import { createNextHandler } from "../src/createNextHandler";

describe("createNextHandler — delegation", () => {
  it("resolves the router lazily and awaits async params before dispatch", async () => {
    const calls: Array<{ method: string; path?: string[] }> = [];
    let getRouterCalls = 0;

    const fakeRouter = {
      GET: async (_req: Request, ctx: { params: { path?: string[] } }) => {
        calls.push({ method: "GET", path: ctx.params.path });
        return new Response("ok");
      },
      POST: async () => new Response("ok"),
      PATCH: async () => new Response("ok"),
      DELETE: async () => new Response("ok")
    } as unknown as FlowApiRouter;

    const fakeFlowState = {
      getRouter: async () => {
        getRouterCalls += 1;
        return fakeRouter;
      }
    } as unknown as FlowState;

    const { GET } = createNextHandler(fakeFlowState);

    // Router is not resolved until the first request.
    expect(getRouterCalls).toBe(0);

    const res = await GET(new Request("http://localhost/api/flows"), {
      params: Promise.resolve({ path: ["a", "b"] })
    });

    expect(res.status).toBe(200);
    expect(getRouterCalls).toBe(1);
    expect(calls).toEqual([{ method: "GET", path: ["a", "b"] }]);
  });
});

describe("createNextHandler — integration", () => {
  it("drives a POST action and lists flows when the catch-all passes no path", async () => {
    const flow = defineFlow({
      kind: "next-test",
      actions: {
        run: handler({
            name: "run",
            inputSchema: z.object({}).passthrough(),
            outputSchema: z.object({ ok: z.boolean() }),
            execute: () => ({ ok: true })
          })
      }
    })();

    const flowstate = createFlowState({
      flows: { nextTest: flow },
      stores: { default: { primary: inMemoryStores() } }
    });

    const { GET, POST } = createNextHandler(flowstate);

    const res = await POST(
      new Request("http://localhost/api/flows/next-test/sess1/actions/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "u1", input: {} })
      }),
      { params: Promise.resolve({ path: ["next-test", "sess1", "actions", "run"] }) }
    );

    // The router accepted and dispatched the action (2xx).
    expect(res.status).toBeLessThan(300);
    expect(res.status).toBeGreaterThanOrEqual(200);

    // An optional catch-all passes no `path` for the bare `/api/flows` list.
    const list = await GET(new Request("http://localhost/api/flows"), {
      params: Promise.resolve({})
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { flows: Array<{ kind: string }> };
    expect(body.flows.map((listed) => listed.kind)).toContain("next-test");

    await flowstate.dispose();
  });
});

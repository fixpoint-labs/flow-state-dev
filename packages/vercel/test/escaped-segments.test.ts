/**
 * On Vercel the route is a Next catch-all, so `params.path` arrives already
 * percent-decoded once. The handler forwards it untouched, and the engine's
 * route parser must not decode it a second time: a flow kind that carries a
 * literal `%XX` (an escaped seat address) has to resolve as written.
 */
import { describe, expect, it } from "vitest";
import { parseFlowRoute, type FlowApiRouter, type FlowState } from "@flow-state-dev/engine";
import { createVercelNextHandler } from "../src/next";

describe("createVercelNextHandler — a flow kind that carries percent escapes", () => {
  it.each([
    ["an escaped org segment", "org%5Fpentest%5Flab.helper"],
    ["an escaped user segment", "acme.~alice%40acme%2Ecom.helper"]
  ])("routes %s to the kind Next decoded once", async (_label, kind) => {
    const routed: unknown[] = [];
    const router = {
      GET: async () => new Response("ok"),
      POST: async (req: Request, ctx: { params: { path?: string[] } }) => {
        routed.push(parseFlowRoute(req.method, ctx.params.path));
        return new Response("ok");
      },
      PATCH: async () => new Response("ok"),
      DELETE: async () => new Response("ok")
    } as unknown as FlowApiRouter;
    const { POST } = createVercelNextHandler({
      getRouter: async () => router
    } as unknown as FlowState);

    const url = `http://localhost/api/flows/${encodeURIComponent(kind)}/actions/run`;
    const nextPath = [decodeURIComponent(encodeURIComponent(kind)), "actions", "run"];
    await POST(new Request(url, { method: "POST" }), {
      params: Promise.resolve({ path: nextPath })
    });

    expect(routed).toEqual([{ kind: "execute_action", flowKind: kind, actionName: "run" }]);
  });
});

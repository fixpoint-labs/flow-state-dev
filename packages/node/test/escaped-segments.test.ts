/**
 * The Node host has only the raw URL, still percent-encoded. A flow kind that
 * carries a literal `%XX` (a seat address whose org or user segment was
 * escaped) must be decoded exactly once on the way to the router, the same as
 * on Next, where the framework does that decode.
 */
import { describe, expect, it } from "vitest";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createServerApp } from "../src/app";

function runFlow(kind: string) {
  return defineFlow({
    kind,
    actions: {
      run: {
        inputSchema: z.object({}).passthrough(),
        block: handler({
          name: "run",
          inputSchema: z.object({}).passthrough(),
          outputSchema: z.object({ ok: z.boolean() }),
          execute: () => ({ ok: true }),
        }),
      },
    },
  })();
}

describe("createServerApp — a flow kind that carries percent escapes", () => {
  it.each([
    ["an escaped org segment", "org%5Fpentest%5Flab.helper"],
    ["an escaped user segment", "acme.~alice%40acme%2Ecom.helper"],
    ["a plain kind", "plain-helper"],
  ])("dispatches an action on %s from the raw URL", async (_label, kind) => {
    const flowstate = createFlowState({
      flows: { seat: runFlow(kind) },
      stores: { default: { primary: inMemoryStores() } },
    });
    const server = createServerApp(flowstate);
    try {
      const res = await server.app.fetch(
        new Request(`http://localhost/api/flows/${encodeURIComponent(kind)}/actions/run`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: "u1", input: {} }),
        }),
      );
      expect(res.status, await res.clone().text()).toBeLessThan(300);
    } finally {
      await server.dispose();
    }
  });
});

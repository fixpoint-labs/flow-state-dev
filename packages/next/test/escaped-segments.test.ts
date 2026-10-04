/**
 * Next hands the catch-all route its `path` param already percent-decoded,
 * once per segment. A flow kind that carries a literal `%XX` (a seat address
 * whose org or user segment was escaped, e.g. `org%5Fpentest%5Flab.helper`)
 * must reach the router intact, not decoded a second time.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createNextHandler } from "../src/createNextHandler";

const ESCAPED_ORG = "org%5Fpentest%5Flab.helper";
const ESCAPED_USER = "acme.~alice%40acme%2Ecom.helper";

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
          execute: () => ({ ok: true })
        })
      }
    }
  })();
}

describe("createNextHandler — a flow kind that carries percent escapes", () => {
  it.each([
    ["an escaped org segment", ESCAPED_ORG],
    ["an escaped user segment", ESCAPED_USER]
  ])("dispatches an action on %s, decoded once by Next", async (_label, kind) => {
    const flowstate = createFlowState({
      flows: { seat: runFlow(kind) },
      stores: { default: { primary: inMemoryStores() } }
    });
    const { POST } = createNextHandler(flowstate);

    // The URL the client builds (`encodeURIComponent(kind)`), and the
    // `params.path` Next derives from it: one decodeURIComponent per segment.
    const url = `http://localhost/api/flows/${encodeURIComponent(kind)}/actions/run`;
    const nextPath = [decodeURIComponent(encodeURIComponent(kind)), "actions", "run"];

    const res = await POST(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "u1", input: {} })
      }),
      { params: Promise.resolve({ path: nextPath }) }
    );
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    await flowstate.dispose();
  });
});

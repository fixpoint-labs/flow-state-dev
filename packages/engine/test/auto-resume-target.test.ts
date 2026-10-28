/**
 * `autoResume: false` on an entry: a request on it never becomes the session's
 * auto-resume target (`latestRequestId`), so a client reattaching to the
 * session still finds the request that was there before it, typically a
 * running one this control was sent beside.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createInMemoryStores, createResponseEmitter, runAction } from "../src";

const noop = handler({
  name: "noop",
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  execute: async () => ({}),
});

const flow = defineFlow({
  kind: "auto-resume-flow",
  actions: {
    turn: { block: noop },
    control: { block: noop, autoResume: false },
  },
})();

async function run(stores: ReturnType<typeof createInMemoryStores>, actionName: "turn" | "control", requestId: string) {
  await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName,
    input: {},
    userId: "u",
    sessionId: "s",
    requestId,
    stores,
    responseEmitter: createResponseEmitter({ requestId }),
    runtimeConfig: {},
  });
}

describe("autoResume: false", () => {
  it("leaves the session's auto-resume target on the request before it", async () => {
    const stores = createInMemoryStores();
    // The first request creates the session, after the stamp would land.
    await run(stores, "turn", "r_first");
    await run(stores, "turn", "r_turn");
    await run(stores, "control", "r_control");
    expect((await stores.session.get("s"))?.latestRequestId).toBe("r_turn");
  });

  it("is the default's opposite: an entry without it takes the target", async () => {
    const stores = createInMemoryStores();
    await run(stores, "turn", "r_first");
    await run(stores, "control", "r_control");
    await run(stores, "turn", "r_turn");
    expect((await stores.session.get("s"))?.latestRequestId).toBe("r_turn");
  });
});

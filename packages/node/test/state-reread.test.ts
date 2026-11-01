/**
 * What `useSession`'s state-only re-read and `followedRequest` read from a
 * real `serve()` host, for a request that failed after writing state.
 *
 * The hook re-reads state with `includeItems: false` when a request it
 * follows ends without completing, and reads a shown request's own record
 * from the status route when a later request is the newest. Both are only
 * worth something if the host answers them: the state the failed request
 * wrote, with no items, and the request's record. (The record's end time for
 * a failed request is the status route's own contract, tested with the
 * route.)
 */
import { afterEach, describe, expect, it } from "vitest";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createClient } from "@flow-state-dev/client";
import { z } from "zod";
import { serve, type ServeHandle } from "../src/serve";

const recordsFlow = defineFlow({
  kind: "records",
  session: {
    stateSchema: z.object({ phase: z.string().nullable().default(null) }),
    client: { expose: ["phase"] },
  },
  actions: {
    fail: {
      inputSchema: z.object({}),
      block: handler({
        name: "fail",
        inputSchema: z.object({}),
        execute: async (_input, ctx) => {
          await ctx.session.patchState({ phase: "failure-recorded" });
          throw new Error("boom");
        },
      }),
    },
  },
})();

let handle: ServeHandle | undefined;
afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

describe("a failed request, read back without its items", () => {
  it("the state read holds what it wrote and no items; its status says when it ended", async () => {
    const flowState = createFlowState({
      flows: { records: recordsFlow },
      modelResolver: createMockModelResolver({}),
      stores: { default: { primary: inMemoryStores() } },
    });
    handle = await serve(flowState, { port: 0, handleSignals: false, disposeOnClose: false, shutdownGraceMs: 0 });
    await flowState.ready();
    const client = createClient({ userId: "alice", baseUrl: `http://127.0.0.1:${handle.port}` });
    await client.flow("records").createSession({ sessionId: "s1" });
    await client.flow("records").send("fail", {}, { sessionId: "s1" }).catch(() => undefined);

    const [failed] = await client.sessions.requests("s1", { limit: 1 });
    expect(failed?.status).toBe("failed");

    const state = await client.sessions.state("s1", { includeItems: false });
    expect(state.clientData.session).toMatchObject({ phase: "failure-recorded" });
    expect(state.items ?? []).toHaveLength(0);

    const status = await client.flow("records").request(failed!.id).status();
    expect(status.status).toBe("failed");
  }, 20_000);
});

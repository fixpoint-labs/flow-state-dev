/**
 * What the post entry's queue holds, and what it deliberately does not.
 *
 * The held work is the APPEND ONLY. Fan-out is handed to a SEPARATE request —
 * the channel's own `onPosted` entry at `concurrency: "allow"` — so delivery
 * latency never counts against the next poster's queue wait. Past the engine's
 * 30s queue-wait budget a waiting post is dropped and never written, so waiting
 * behind a delivery is the wrong failure to pick.
 *
 * The split in what is asserted matters. The concurrency GATE is the engine's:
 * it is claimed by the transport host before a request record exists, and it
 * has its own tests there. What this change owns is which policy each entry
 * declares, and that fan-out is a second request rather than inline work — so
 * that is what these assert.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  CHANNEL_KIND,
  channelFlow,
  channelNotifyInputSchema,
  createChannelFlow
} from "../src/index";

const USER_ID = "u_queue";

const notify = handler({
  name: "notify",
  inputSchema: channelNotifyInputSchema,
  outputSchema: z.object({}),
  execute: () => ({})
});

async function bind(stores: StoreRegistry, sessionId: string, members: string[]): Promise<void> {
  const now = Date.now();
  await stores.session.set(
    sessionId,
    {
      id: sessionId,
      flowKind: CHANNEL_KIND,
      flowId: CHANNEL_KIND,
      userId: USER_ID,
      state: { members, instructions: "Charter.", transcript: [] },
      lineageId: `lin_${sessionId}`,
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: []
    } as never,
    "any"
  );
}

async function until(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe("what the post entry's queue holds", () => {
  it("declares queue on both post doors and allow on the fan-out", () => {
    const instance = createChannelFlow({ notify })();

    expect(instance.actions.post.concurrency).toBe("queue");
    expect(instance.internal?.actions.post?.concurrency).toBe("queue");
    // The one entry that must NOT sit behind the post queue: a delivery waiting
    // on the channel's key would put the next poster behind every earlier
    // post's fan-out.
    expect(instance.internal?.actions.onPosted?.concurrency).toBe("allow");
    // Reading contends with nothing.
    expect(instance.actions.read.concurrency).toBeUndefined();
  });

  it("hands fan-out to a second request in the channel's session, not to the post's own", async () => {
    const instance = createChannelFlow({ notify })();
    const state = createFlowState({
      flows: { [CHANNEL_KIND]: instance },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: createMockModelResolver({})
    });
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "engineering.standup", ["a", "b"]);

      const posted = await runAction({
        flow: instance,
        actionName: "post",
        input: { body: "shipped the reader" },
        userId: USER_ID,
        sessionId: "engineering.standup",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });
      expect(posted.error).toBeUndefined();

      await until(async () => {
        const requests = await runtime.stores.request.list({ sessionId: "engineering.standup" });
        return requests.some((request) => request.actionName === "onPosted");
      }, "the fan-out to run as its own request");

      const requests = await runtime.stores.request.list({ sessionId: "engineering.standup" });
      const posts = requests.filter((request) => request.actionName === "post");
      const fanOuts = requests.filter((request) => request.actionName === "onPosted");

      // One post, one fan-out, two requests. Inline delivery would be one.
      expect(posts).toHaveLength(1);
      expect(fanOuts).toHaveLength(1);
      expect(fanOuts[0]?.id).not.toBe(posts[0]?.id);
    } finally {
      await state.dispose();
    }
  });

  it("loses no post when several land on one channel at once", async () => {
    const instance = channelFlow();
    const state = createFlowState({
      flows: { [CHANNEL_KIND]: instance },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: createMockModelResolver({})
    });
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "engineering.standup", ["a", "b"]);

      const post = (body: string) =>
        runAction({
          flow: instance,
          actionName: "post",
          input: { body },
          userId: USER_ID,
          sessionId: "engineering.standup",
          stores: runtime.stores,
          runtimeConfig: { ...runtime.runtimeConfig }
        });

      await Promise.all([post("first"), post("second"), post("third")]);

      // The append is commutative — `pushState`, not a read-modify-write — so
      // simultaneous posts can never silently drop one, and this floor needs no
      // compare-and-swap.
      const record = await runtime.stores.session.get("engineering.standup");
      const bodies = (
        (record?.state as { transcript?: Array<{ body: string }> } | undefined)?.transcript ?? []
      ).map((line) => line.body);
      expect(bodies.sort()).toEqual(["first", "second", "third"]);
    } finally {
      await state.dispose();
    }
  });
});

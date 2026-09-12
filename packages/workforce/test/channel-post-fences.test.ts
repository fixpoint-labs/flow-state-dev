/**
 * The three fences on the post path (spec decision 3).
 *
 * The sharpest one is `channel-not-bound`. The shared instance answers for
 * EVERY session id and the action path is create-or-get, so a caller naming an
 * id nobody opened gets a new, empty session on the channel instance rather
 * than a refusal — "any caller mints a channel's durable home by naming it",
 * which is the branch the spec rejected. The refusal has to come from the post
 * block, because no absent instance does that work any more.
 *
 * The third fence — a post must address `{ id }`, never `{ key }` — is not
 * testable as a refusal and is deliberately not tested as one: a key-derived
 * child id is hashed with the parent session and lineage, so a `{ key }` post
 * simply lands somewhere that is not the channel. That is documented, not
 * detected.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, dispatcher } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowDispatcher, StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import { channelFlow, CHANNEL_KIND } from "../src/index";

const USER_ID = "u_fences";
const POSTER = "poster";

/** A flow whose only action posts into a channel by session id, from another flow. */
const posterFlow = defineFlow({
  kind: POSTER,
  actions: {
    say: {
      block: dispatcher({
        name: "post-to-channel",
        flowKind: CHANNEL_KIND,
        action: "post",
        inputSchema: z.object({ channelId: z.string(), body: z.string() }),
        session: { id: (input: { channelId: string; body: string }) => input.channelId },
        payload: (input: { channelId: string; body: string }) => ({ body: input.body })
      })
    }
  }
});

/**
 * A dispatcher that is not the in-process one, which is the whole of what
 * makes a host "external" as far as the delivery fence is concerned.
 */
const externalDispatcher: FlowDispatcher = {
  dispatch: () => {
    throw new Error("this test never expects a dispatch to reach the queue");
  }
} as unknown as FlowDispatcher;

function host(options: { external?: boolean } = {}) {
  const channel = channelFlow();
  const poster = posterFlow();
  const state = createFlowState({
    flows: { [CHANNEL_KIND]: channel, [POSTER]: poster },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({}),
    ...(options.external === true ? { dispatcher: externalDispatcher } : {})
  });
  return { channel, poster, state };
}

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

async function transcriptOf(stores: StoreRegistry, sessionId: string): Promise<unknown[] | undefined> {
  const record = await stores.session.get(sessionId);
  return (record?.state as { transcript?: unknown[] } | undefined)?.transcript;
}

async function until(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe("the post path's fences", () => {
  it("refuses a post into a session nobody opened, writes nothing, and leaves it inert", async () => {
    const { channel, state } = host();
    try {
      const runtime = await state.getRuntime();

      const result = await runAction({
        flow: channel,
        actionName: "post",
        input: { body: "who is listening?" },
        userId: USER_ID,
        sessionId: "not-a-channel",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });

      expect(result.error).toBeDefined();
      expect(String(result.error)).toContain("channel-not-bound");

      // The action path created the record — that is the hazard, not a bug —
      // and it stays an empty session rather than becoming a channel.
      const record = await runtime.stores.session.get("not-a-channel");
      expect(record).toBeDefined();
      expect(record?.state).toEqual({});
    } finally {
      await state.dispose();
    }
  });

  it("refuses a read of a session nobody opened", async () => {
    const { channel, state } = host();
    try {
      const runtime = await state.getRuntime();
      const result = await runAction({
        flow: channel,
        actionName: "read",
        input: {},
        userId: USER_ID,
        sessionId: "not-a-channel",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });
      expect(result.error).toBeDefined();
      expect(String(result.error)).toContain("channel-not-bound");
    } finally {
      await state.dispose();
    }
  });

  it("delivers a flow-to-flow post where dispatch runs in process", async () => {
    const { poster, state } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "engineering.standup", ["engineering.lead"]);

      const result = await runAction({
        flow: poster,
        actionName: "say",
        input: { channelId: "engineering.standup", body: "from another flow" },
        userId: USER_ID,
        sessionId: "s_poster",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });

      expect(result.error).toBeUndefined();
      await until(
        async () => ((await transcriptOf(runtime.stores, "engineering.standup")) ?? []).length === 1,
        "the dispatched post to land in the channel's transcript"
      );
    } finally {
      await state.dispose();
    }
  });

  it("refuses a flow-to-flow post by name past an external dispatcher, while a client post still lands", async () => {
    const { channel, poster, state } = host({ external: true });
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "engineering.standup", ["engineering.lead"]);

      const dispatched = await runAction({
        flow: poster,
        actionName: "say",
        input: { channelId: "engineering.standup", body: "from another flow" },
        userId: USER_ID,
        sessionId: "s_poster",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });

      expect(dispatched.error).toBeDefined();
      expect(String(dispatched.error)).toContain("external-dispatcher");
      expect((await transcriptOf(runtime.stores, "engineering.standup")) ?? []).toHaveLength(0);

      // The public action door is unaffected: only the dispatch door closes.
      const direct = await runAction({
        flow: channel,
        actionName: "post",
        input: { body: "a client post" },
        userId: USER_ID,
        sessionId: "engineering.standup",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });

      expect(direct.error).toBeUndefined();
      expect((await transcriptOf(runtime.stores, "engineering.standup")) ?? []).toHaveLength(1);
    } finally {
      await state.dispose();
    }
  });
});

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
import { channelFlow, CHANNEL_KIND, openChannels, type ChannelManifest } from "../src/index";

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

/**
 * `openChannels`'s session API over this test's own stores.
 *
 * Create refuses a taken id with a 409, which is the whole of what the real
 * `POST /sessions` contributes here, and nothing else writes session state.
 */
function sessionApi(stores: StoreRegistry) {
  return {
    createSession: async (options: {
      flowKind: string;
      userId: string;
      sessionId?: string;
      description?: string;
      state?: Record<string, unknown>;
    }): Promise<unknown> => {
      const id = String(options.sessionId);
      if ((await stores.session.get(id)) !== undefined) {
        throw Object.assign(new Error(`Session "${id}" already exists`), { status: 409 });
      }
      const now = Date.now();
      await stores.session.set(
        id,
        {
          id,
          flowKind: options.flowKind,
          flowId: options.flowKind,
          userId: options.userId,
          description: options.description,
          state: options.state ?? {},
          lineageId: `lin_${id}`,
          version: 0,
          createdAt: now,
          updatedAt: now,
          journal: []
        } as never,
        "absent"
      );
      return { id };
    },
    getSession: async (sessionId: string): Promise<{ state?: Record<string, unknown> }> => ({
      state: (await stores.session.get(sessionId))?.state as Record<string, unknown> | undefined
    }),
    deleteSession: async (sessionId: string): Promise<void> => {
      await stores.session.delete(sessionId);
    }
  };
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

  /**
   * The two fences above are each sound alone. This is them in the order that
   * breaks the pair: a post lands FIRST, taking the id, and only then does the
   * roster open. Proving each half separately in one run is what missed it.
   */
  it("repairs a channel a premature post poisoned, in the order that breaks it", async () => {
    const { channel, state } = host();
    try {
      const runtime = await state.getRuntime();
      const roster: ChannelManifest[] = [
        {
          id: "engineering.standup",
          declared: { members: ["engineering.lead"] },
          body: "Post what you finished."
        }
      ];

      // 1. The premature post. Refused, as it should be — but the action path
      //    is create-or-get, so the channel's id is now taken by an empty
      //    session that no `CHANNEL.md` ever asked for.
      const premature = await runAction({
        flow: channel,
        actionName: "post",
        input: { body: "anyone home?" },
        userId: USER_ID,
        sessionId: "engineering.standup",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });
      expect(String(premature.error)).toContain("channel-not-bound");

      // 2. The roster opens, meets a 409, and must look before it skips.
      await openChannels(roster, { client: sessionApi(runtime.stores), userId: USER_ID });

      // 3. The same post, now landing. Swallow the 409 instead and this stays
      //    `channel-not-bound` forever: every later run 409s too, so there is
      //    no way back through the public API.
      const after = await runAction({
        flow: channel,
        actionName: "post",
        input: { body: "anyone home?", author: "engineering.lead" },
        userId: USER_ID,
        sessionId: "engineering.standup",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });
      expect(after.error).toBeUndefined();
      expect(await transcriptOf(runtime.stores, "engineering.standup")).toHaveLength(1);
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

/**
 * Characterization specs for two substrate premises this floor rests on and
 * cannot itself enforce.
 *
 * Neither is a behaviour of the channel kind. They are pinned here because the
 * channel's public contract is written against them: if either changes, the
 * docs and the API's own wording become wrong, and a silent change is exactly
 * what a characterization spec exists to catch.
 *
 * 1. A session is bound to ONE user. That is why the `principal` on every line
 *    of a given transcript is the same value, and why the unverified `author`
 *    label carries all the real attribution (decision 2's ceiling).
 * 2. A `{ key }` dispatch derives a per-poster child session. That is why a key
 *    cannot name a shared channel, and so why posting addresses `{ id }`.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, dispatcher } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import { channelFlow, CHANNEL_KIND } from "../src/index";

const OWNER = "u_owner";
const INTRUDER = "u_intruder";
const POSTER = "keyed-poster";

/** A poster that addresses `{ key }` — the shape decision 3 rejected. */
const keyedPosterFlow = defineFlow({
  kind: POSTER,
  actions: {
    say: {
      block: dispatcher({
        name: "post-by-key",
        flowKind: CHANNEL_KIND,
        action: "post",
        inputSchema: z.object({ channelId: z.string(), body: z.string() }),
        session: { key: (input: { channelId: string }) => input.channelId },
        payload: (input: { body: string }) => ({ body: input.body })
      })
    }
  }
});

function host() {
  const channel = channelFlow();
  const poster = keyedPosterFlow();
  const state = createFlowState({
    flows: { [CHANNEL_KIND]: channel, [POSTER]: poster },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({})
  });
  return { channel, poster, state };
}

async function bind(stores: StoreRegistry, sessionId: string): Promise<void> {
  const now = Date.now();
  await stores.session.set(
    sessionId,
    {
      id: sessionId,
      flowKind: CHANNEL_KIND,
      flowId: CHANNEL_KIND,
      userId: OWNER,
      state: { members: ["engineering.lead"], instructions: "Charter.", transcript: [] },
      lineageId: `lin_${sessionId}`,
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: []
    } as never,
    "any"
  );
}

async function transcriptLength(stores: StoreRegistry, sessionId: string): Promise<number> {
  const record = await stores.session.get(sessionId);
  return ((record?.state as { transcript?: unknown[] } | undefined)?.transcript ?? []).length;
}

describe("substrate premises the channel floor rests on", () => {
  it("refuses a second user's post into a channel session bound to someone else", async () => {
    const { channel, state } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "engineering.standup");

      // Refused by the substrate before any channel code runs, and as a THROW
      // rather than an execution result: the request never becomes a run.
      await expect(
        runAction({
          flow: channel,
          actionName: "post",
          input: { body: "not my channel" },
          userId: INTRUDER,
          sessionId: "engineering.standup",
          stores: runtime.stores,
          runtimeConfig: { ...runtime.runtimeConfig }
        })
      ).rejects.toThrow(/owned by user u_owner/);

      expect(await transcriptLength(runtime.stores, "engineering.standup")).toBe(0);
    } finally {
      await state.dispose();
    }
  });

  it("sends a `{ key }`-addressed post to a derived child session, never to the channel", async () => {
    const { poster, state } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "engineering.standup");

      await runAction({
        flow: poster,
        actionName: "say",
        input: { channelId: "engineering.standup", body: "lost" },
        userId: OWNER,
        sessionId: "s_poster",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });

      // Give the detached child a moment to run and fail on its own terms.
      await new Promise((resolve) => setTimeout(resolve, 100));

      // The channel never sees it. The framework cannot detect the mistake —
      // the docs say to address `{ id }`, and this is what happens when they
      // are not followed.
      expect(await transcriptLength(runtime.stores, "engineering.standup")).toBe(0);

      const children = await runtime.stores.session.list({
        userId: OWNER,
        parentage: { parentOf: "s_poster" }
      });
      expect(children.length).toBeGreaterThan(0);
      expect(children.every((child) => child.id !== "engineering.standup")).toBe(true);
    } finally {
      await state.dispose();
    }
  });
});

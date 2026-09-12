/**
 * The fan-out slot: one delivery per declared member per post, run OUTSIDE the
 * post's queue hold.
 *
 * The split is the point. The post entry is `concurrency: "queue"` keyed on the
 * session, so two posts on one channel serialise into its transcript — but the
 * held work is the append only. Fan-out runs as its own request
 * (`concurrency: "allow"`), so delivery latency never counts against the next
 * poster's 30s queue-wait budget. Past that budget a waiting post is dropped
 * and never written, which is why waiting behind a delivery would be the wrong
 * failure to choose.
 *
 * The framework carries the policy; the app supplies the addresses. A notify
 * block names its own targets — a dispatch target read out of stored data is
 * refused by the substrate.
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
  createChannelFlow,
  type ChannelNotifyInput
} from "../src/index";

const USER_ID = "u_fanout";

function hostWith(notify?: ReturnType<typeof handler>) {
  const instance = (notify === undefined ? channelFlow : createChannelFlow({ notify }))();
  const state = createFlowState({
    flows: { [CHANNEL_KIND]: instance },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({})
  });
  return { instance, state };
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

async function membersOf(stores: StoreRegistry, sessionId: string): Promise<string[] | undefined> {
  const record = await stores.session.get(sessionId);
  return (record?.state as { members?: string[] } | undefined)?.members;
}

async function transcriptLength(stores: StoreRegistry, sessionId: string): Promise<number> {
  const record = await stores.session.get(sessionId);
  return ((record?.state as { transcript?: unknown[] } | undefined)?.transcript ?? []).length;
}

async function journalText(stores: StoreRegistry, sessionId: string): Promise<string> {
  const record = await stores.session.get(sessionId);
  const journal = (record?.journal ?? []) as Array<{ text?: string }>;
  return journal.map((entry) => entry.text ?? "").join("\n");
}

async function until(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe("the fan-out slot", () => {
  it("runs the notify block once per declared member per post", async () => {
    const delivered: string[] = [];
    const notify = handler({
      name: "test-notify",
      inputSchema: channelNotifyInputSchema,
      outputSchema: z.object({}),
      execute: (input: ChannelNotifyInput) => {
        delivered.push(`${input.member}:${input.body}`);
        return {};
      }
    });

    const { instance, state } = hostWith(notify);
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "engineering.standup", ["engineering.lead", "engineering.analyst"]);

      await runAction({
        flow: instance,
        actionName: "post",
        input: { body: "shipped the reader" },
        userId: USER_ID,
        sessionId: "engineering.standup",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });

      await until(() => delivered.length === 2, "both members to be notified");
      expect(delivered.sort()).toEqual([
        "engineering.analyst:shipped the reader",
        "engineering.lead:shipped the reader"
      ]);
    } finally {
      await state.dispose();
    }
  });

  it("keeps a slow notify off the next post's path, and both posts still land", async () => {
    const notify = handler({
      name: "slow-notify",
      inputSchema: channelNotifyInputSchema,
      outputSchema: z.object({}),
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return {};
      }
    });

    const { instance, state } = hostWith(notify);
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

      const started = Date.now();
      await post("first");
      await post("second");
      const elapsed = Date.now() - started;

      expect(await transcriptLength(runtime.stores, "engineering.standup")).toBe(2);
      // Two posts, each behind one 400ms delivery, would be ~800ms. The append
      // is the only held work, so this must not approach even one delivery.
      expect(elapsed).toBeLessThan(400);
    } finally {
      await state.dispose();
    }
  });

  it("records a delivery refusal, keeps the post, and changes nothing about membership", async () => {
    const attempted: string[] = [];
    const notify = handler({
      name: "refusing-notify",
      inputSchema: channelNotifyInputSchema,
      outputSchema: z.object({}),
      execute: (input: ChannelNotifyInput) => {
        attempted.push(input.member);
        if (input.member === "engineering.analyst") {
          throw new Error("no address for engineering.analyst");
        }
        return {};
      }
    });

    const { instance, state } = hostWith(notify);
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "engineering.standup", ["engineering.analyst", "engineering.lead"]);

      await runAction({
        flow: instance,
        actionName: "post",
        input: { body: "shipped the reader" },
        userId: USER_ID,
        sessionId: "engineering.standup",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });

      await until(
        async () => (await journalText(runtime.stores, "engineering.standup")).includes(
          "no address for engineering.analyst"
        ),
        "the refusal to be recorded"
      );

      // The remaining member is still attempted, and neither the transcript nor
      // the roster is touched by a failed delivery.
      await until(() => attempted.includes("engineering.lead"), "the other member to be attempted");
      expect(await transcriptLength(runtime.stores, "engineering.standup")).toBe(1);
      expect(await membersOf(runtime.stores, "engineering.standup")).toEqual([
        "engineering.analyst",
        "engineering.lead"
      ]);
    } finally {
      await state.dispose();
    }
  });

  it("lands posts with no slot supplied, waking nobody and erroring on nothing", async () => {
    const { instance, state } = hostWith();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "engineering.standup", ["a", "b"]);

      // No slot means no fan-out entry at all, rather than an entry that exists
      // to do nothing.
      expect(instance.internal?.actions.onPosted).toBeUndefined();

      const result = await runAction({
        flow: instance,
        actionName: "post",
        input: { body: "nobody is listening" },
        userId: USER_ID,
        sessionId: "engineering.standup",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });

      expect(result.error).toBeUndefined();
      expect(await transcriptLength(runtime.stores, "engineering.standup")).toBe(1);
    } finally {
      await state.dispose();
    }
  });
});

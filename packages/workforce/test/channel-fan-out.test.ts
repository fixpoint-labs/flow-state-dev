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
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  CHANNEL_KIND,
  channelFlow,
  channelNotifyInputSchema,
  defineChannelFlow,
  type ChannelNotifyInput
} from "../src/index";
import { postedLines } from "./channel-post-lines";

const USER_ID = "u_fanout";

function hostWith(notify?: ReturnType<typeof handler>) {
  const instance = (notify === undefined ? channelFlow : defineChannelFlow({ notify }))();
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
      orgId: DEFAULT_ORG_ID,
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
  return (await postedLines(stores, sessionId)).length;
}

async function journalLength(stores: StoreRegistry, sessionId: string): Promise<number> {
  const record = await stores.session.get(sessionId);
  return ((record?.journal ?? []) as unknown[]).length;
}

async function bodiesOf(stores: StoreRegistry, sessionId: string): Promise<string[]> {
  return (await postedLines(stores, sessionId)).map((line) => line.body);
}

/** A promise a test can resolve by hand, so an interleaving is forced rather than raced. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open = (): void => {};
  const wait = new Promise<void>((resolve) => {
    open = () => resolve();
  });
  return { wait, open };
}

/** Has the channel's fan-out request reached a terminal status? */
async function fanOutFinished(stores: StoreRegistry, sessionId: string): Promise<boolean> {
  const requests = await stores.request.list({ sessionId });
  const fanOuts = requests.filter((request) => request.actionName === "onPosted");
  return fanOuts.length > 0 && fanOuts.every((request) => request.status !== "in_progress");
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
    orgId: DEFAULT_ORG_ID,
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
    orgId: DEFAULT_ORG_ID,
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

  it("absorbs a delivery refusal, keeps the post, and changes nothing about membership", async () => {
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
    orgId: DEFAULT_ORG_ID,
        flow: instance,
        actionName: "post",
        input: { body: "shipped the reader" },
        userId: USER_ID,
        sessionId: "engineering.standup",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });

      // The remaining member is still attempted, and neither the transcript nor
      // the roster is touched by a failed delivery.
      await until(() => attempted.includes("engineering.lead"), "the other member to be attempted");
      await until(
        () => fanOutFinished(runtime.stores, "engineering.standup"),
        "the fan-out request to finish"
      );
      expect(await transcriptLength(runtime.stores, "engineering.standup")).toBe(1);
      // The rule the next test proves the cost of: a channel writes nothing to
      // its session record that is not a state delta. The journal is the record,
      // not the state, and it is written whole and without a compare-and-swap.
      expect(await journalLength(runtime.stores, "engineering.standup")).toBe(0);
      expect(await membersOf(runtime.stores, "engineering.standup")).toEqual([
        "engineering.analyst",
        "engineering.lead"
      ]);
    } finally {
      await state.dispose();
    }
  });

  /**
   * The interleaving, forced rather than raced.
   *
   * The fan-out runs in its OWN request and holds the session snapshot that
   * request loaded. Writing anything back wholesale — which is what
   * `appendJournal` does, whole record, `"any"`, no compare-and-swap — writes
   * that snapshot's state back too, and with it every post that landed since.
   * The ordering below is the one that exposes it: the delivery is held open on
   * a gate, a second post lands through its own request while it waits, and
   * only then is the delivery allowed to fail into its rescue.
   */
  it("cannot erase a post that landed while a delivery was failing", async () => {
    const started = gate();
    const release = gate();
    // Only the FIRST delivery is held. Every post hands off its own fan-out
    // request, and a later one writing the session back correctly would mask
    // exactly the loss under test — so the second post's delivery succeeds,
    // writes nothing, and leaves the held request as the only writer left.
    let deliveries = 0;
    const notify = handler({
      name: "held-notify",
      inputSchema: channelNotifyInputSchema,
      outputSchema: z.object({}),
      execute: async () => {
        deliveries += 1;
        if (deliveries > 1) return {};
        started.open();
        await release.wait;
        throw new Error("no address for a");
      }
    });

    const { instance, state } = hostWith(notify);
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "engineering.standup", ["a"]);

      const post = (body: string) =>
        runAction({
    orgId: DEFAULT_ORG_ID,
          flow: instance,
          actionName: "post",
          input: { body },
          userId: USER_ID,
          sessionId: "engineering.standup",
          stores: runtime.stores,
          runtimeConfig: { ...runtime.runtimeConfig }
        });

      // 1. The first post lands and hands off. Waiting on `started` is what
      //    makes the ordering explicit: the fan-out request now exists and its
      //    snapshot's transcript is exactly ["first"].
      await post("first");
      await started.wait;

      // 2. A second post lands, in its own request, while the delivery waits.
      //    Its own delivery succeeds and is let finish first, so nothing it
      //    does can put the transcript back together afterwards.
      await post("second");
      expect(await bodiesOf(runtime.stores, "engineering.standup")).toEqual(["first", "second"]);
      await until(() => deliveries === 2, "the second post's delivery to run");

      // 3. Only now does the delivery fail, sending the fan-out into its rescue
      //    while it still holds the one-line snapshot.
      release.open();
      await until(
        () => fanOutFinished(runtime.stores, "engineering.standup"),
        "the fan-out request to finish"
      );

      // Recording the failure must not be able to cost a post.
      expect(await bodiesOf(runtime.stores, "engineering.standup")).toEqual(["first", "second"]);
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
    orgId: DEFAULT_ORG_ID,
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

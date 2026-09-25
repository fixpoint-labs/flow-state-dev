/**
 * A channel's transcript is its posts: each `post` leaves one `channel-post`
 * item on its own request, and `read` rebuilds the transcript from those items.
 *
 * Why it matters: a browser never receives an action's return value, so the
 * item is the only way a page can show a channel at all. And a line kept as an
 * item AND copied into state would be two records of one post that can
 * disagree, so a post must no longer write `state.transcript`.
 *
 * Red states produced before these were trusted:
 *   - put `pushState("transcript", line)` back in the post: the "leaves state
 *     as it was" case fails.
 *   - read the transcript from `state.transcript` only: the legacy-then-items
 *     and the window cases fail.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowStateRuntime, StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { channelFlow, CHANNEL_KIND } from "../src/index";
import { postedLines } from "./channel-post-lines";

const USER_ID = "u_channel";
const CHANNEL = "engineering.standup";

type Line = { id: string; at: number; principal: string; authorVerified: false; body: string };

function host() {
  const instance = channelFlow();
  const state = createFlowState({
    flows: { [CHANNEL_KIND]: instance },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({})
  });
  return { instance, state };
}

/** Seed a bound channel the way `openChannels` does, optionally with lines an older build kept in state. */
async function bind(stores: StoreRegistry, members: string[], transcript: Line[] = []): Promise<void> {
  const now = Date.now();
  await stores.session.set(
    CHANNEL,
    {
      id: CHANNEL,
      flowKind: CHANNEL_KIND,
      flowId: CHANNEL_KIND,
      userId: USER_ID,
      orgId: DEFAULT_ORG_ID,
      state: { members, instructions: "Post status.", transcript },
      lineageId: `lin_${CHANNEL}`,
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: []
    } as never,
    "any"
  );
}

function call(
  instance: ReturnType<typeof channelFlow>,
  runtime: FlowStateRuntime,
  actionName: string,
  input: unknown
) {
  return runAction({
    orgId: DEFAULT_ORG_ID,
    flow: instance,
    actionName,
    input,
    userId: USER_ID,
    sessionId: CHANNEL,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig }
  });
}

async function readBodies(instance: ReturnType<typeof channelFlow>, runtime: FlowStateRuntime): Promise<string[]> {
  const read = await call(instance, runtime, "read", {});
  expect(read.error).toBeUndefined();
  return (read.output as { transcript: Array<{ body: string }> }).transcript.map((l) => l.body);
}

const legacy = (body: string): Line => ({
  id: `legacy-${body}`,
  at: 1,
  principal: USER_ID,
  authorVerified: false,
  body
});

describe("a channel post is one channel-post item", () => {
  it("leaves one item carrying its line, and leaves state.transcript as it was", async () => {
    const { instance, state } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, ["engineering.lead"], [legacy("from before")]);

      const result = await call(instance, runtime, "post", { body: "shipped the reader" });
      expect(result.error).toBeUndefined();

      const lines = await postedLines(runtime.stores, CHANNEL);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        body: "shipped the reader",
        principal: USER_ID,
        authorVerified: false
      });
      expect(typeof lines[0]?.id).toBe("string");
      expect(typeof lines[0]?.at).toBe("number");

      const record = await runtime.stores.session.get(CHANNEL);
      expect((record?.state as { transcript: Line[] }).transcript.map((l) => l.body)).toEqual([
        "from before"
      ]);
    } finally {
      await state.dispose();
    }
  });

  it("leaves no item when the post is refused", async () => {
    const { instance, state } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, ["engineering.lead"]);

      const result = await call(instance, runtime, "post", { body: "not mine", author: "marketing.intern" });
      expect(result.error).toBeDefined();
      expect(await postedLines(runtime.stores, CHANNEL)).toEqual([]);
    } finally {
      await state.dispose();
    }
  });
});

describe("read rebuilds the transcript from the posts", () => {
  it("returns an older channel's state lines first, then the posted lines, each once", async () => {
    const { instance, state } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, ["engineering.lead"], [legacy("old one"), legacy("old two")]);

      await call(instance, runtime, "post", { body: "new one" });
      await call(instance, runtime, "post", { body: "new two" });

      expect(await readBodies(instance, runtime)).toEqual(["old one", "old two", "new one", "new two"]);
    } finally {
      await state.dispose();
    }
  });

  it("returns a line once when a legacy state line and an item carry the same id", async () => {
    const { instance, state } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, ["engineering.lead"]);
      await call(instance, runtime, "post", { body: "posted" });
      const [line] = await postedLines(runtime.stores, CHANNEL);

      // The same line also sits in state, as a channel mid-migration could hold it.
      const record = await runtime.stores.session.get(CHANNEL);
      await runtime.stores.session.set(
        CHANNEL,
        { ...record!, state: { ...record!.state, transcript: [line] } },
        record!.version
      );

      expect(await readBodies(instance, runtime)).toEqual(["posted"]);
    } finally {
      await state.dispose();
    }
  });

  it("returns the most recent lines, in order, once the channel is past its history window", async () => {
    const { instance, state } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, ["engineering.lead"]);

      // The built-in kind keeps the default window of 50 requests.
      const total = 53;
      for (let i = 0; i < total; i++) {
        const result = await call(instance, runtime, "post", { body: `line ${i}` });
        expect(result.error).toBeUndefined();
      }

      const bodies = await readBodies(instance, runtime);
      expect(bodies).toEqual(Array.from({ length: 50 }, (_, i) => `line ${i + total - 50}`));
      // Every post is still on the session for a page to read.
      expect(await postedLines(runtime.stores, CHANNEL)).toHaveLength(total);
    } finally {
      await state.dispose();
    }
  });
});

/**
 * A mailbox's transcript is its posts: each `post` leaves one `mailbox-post`
 * item on its own request, and `read` rebuilds the transcript from those items.
 *
 * Why it matters: a browser never receives an action's return value, so the
 * item is the only way a page can show a mailbox at all. And a line kept as an
 * item AND copied into state would be two records of one post that can
 * disagree, so a post must no longer write `state.transcript`.
 *
 * Red states produced before these were trusted:
 *   - put `pushState("transcript", line)` back in the post: the "leaves state
 *     as it was" case fails.
 *   - read the transcript from `state.transcript` only: the legacy-then-items
 *     and the window cases fail.
 *   - emit the line through `ctx.emit.component`, not awaited: the
 *     cannot-be-written case fails. The post succeeds and the write's error
 *     surfaces only as an unhandled rejection.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowStateRuntime, StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { mailboxFlow, MAILBOX_KIND } from "../src/index";
import { postedLines } from "./mailbox-post-lines";

const USER_ID = "u_mailbox";
const MAILBOX = "engineering.standup";

type Line = { id: string; at: number; principal: string; authorVerified: false; body: string };

function host() {
  const instance = mailboxFlow();
  const state = createFlowState({
    flows: { [MAILBOX_KIND]: instance },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({})
  });
  return { instance, state };
}

/** Seed a bound mailbox the way `openMailboxes` does, optionally with lines an older build kept in state. */
async function bind(stores: StoreRegistry, members: string[], transcript: Line[] = []): Promise<void> {
  const now = Date.now();
  await stores.session.set(
    MAILBOX,
    {
      id: MAILBOX,
      flowKind: MAILBOX_KIND,
      flowId: MAILBOX_KIND,
      userId: USER_ID,
      orgId: DEFAULT_ORG_ID,
      state: { members, instructions: "Post status.", transcript },
      lineageId: `lin_${MAILBOX}`,
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: []
    } as never,
    "any"
  );
}

function call(
  instance: ReturnType<typeof mailboxFlow>,
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
    sessionId: MAILBOX,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig }
  });
}

async function readBodies(instance: ReturnType<typeof mailboxFlow>, runtime: FlowStateRuntime): Promise<string[]> {
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

describe("a mailbox post is one mailbox-post item", () => {
  it("leaves one item carrying its line, and leaves state.transcript as it was", async () => {
    const { instance, state } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, ["engineering.lead"], [legacy("from before")]);

      const result = await call(instance, runtime, "post", { body: "shipped the reader" });
      expect(result.error).toBeUndefined();

      const lines = await postedLines(runtime.stores, MAILBOX);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        body: "shipped the reader",
        principal: USER_ID,
        authorVerified: false
      });
      expect(typeof lines[0]?.id).toBe("string");
      expect(typeof lines[0]?.at).toBe("number");

      const record = await runtime.stores.session.get(MAILBOX);
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
      expect(await postedLines(runtime.stores, MAILBOX)).toEqual([]);
    } finally {
      await state.dispose();
    }
  });
});

describe("a post returns only once its line is stored", () => {
  // The item is the only record of a line, so a post that hands back its line
  // while the write that keeps it failed would be reporting a line no read
  // will ever show. The failure has to reach the caller.
  it("fails when the line's item cannot be written", async () => {
    const { instance, state } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, ["engineering.lead"]);

      // The store accepts every write except the flush that carries the line.
      const request = runtime.stores.request;
      const persistEvents = request.persistEvents.bind(request);
      const flushEvents = request.flushEvents.bind(request);
      let lineQueued = false;
      request.persistEvents = (requestId, events) => {
        if (events.some((e) => e.type === "item.done" && (e as { item?: { component?: string } }).item?.component === "mailbox-post")) {
          lineQueued = true;
        }
        persistEvents(requestId, events);
      };
      request.flushEvents = async (requestId) => {
        if (lineQueued) {
          lineQueued = false;
          throw new Error("store unavailable");
        }
        await flushEvents(requestId);
      };

      const result = await call(instance, runtime, "post", { body: "keep me" });
      expect(result.error?.message ?? "").toContain("store unavailable");
    } finally {
      await state.dispose();
    }
  });
});

describe("read rebuilds the transcript from the posts", () => {
  it("returns an older mailbox's state lines first, then the posted lines, each once", async () => {
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
      const [line] = await postedLines(runtime.stores, MAILBOX);

      // The same line also sits in state, as a mailbox mid-migration could hold it.
      const record = await runtime.stores.session.get(MAILBOX);
      await runtime.stores.session.set(
        MAILBOX,
        { ...record!, state: { ...record!.state, transcript: [line] } },
        record!.version
      );

      expect(await readBodies(instance, runtime)).toEqual(["posted"]);
    } finally {
      await state.dispose();
    }
  });

  it("returns the most recent lines, in order, once the mailbox is past its history window", async () => {
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
      expect(await postedLines(runtime.stores, MAILBOX)).toHaveLength(total);
    } finally {
      await state.dispose();
    }
  });
});

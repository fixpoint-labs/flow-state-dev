/**
 * A live list of a user's sessions, end to end over real push (FIX-2411).
 *
 * The Node host serves the socket, so this is the path a browser rail takes
 * where push is up: one client watches `topic.user()` and reads the listing
 * with `include: ["status"]` on each notice; a second client of the same user
 * (another tab, a script) creates a session and runs turns in it. What the
 * watcher's listing shows is asserted, never the notices published.
 *
 * Red state produced before this was trusted: with the bus's user-topic
 * notice removed (`publish-writes.ts`), the watcher hears nothing and every
 * case here times out.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler, topic } from "@flow-state-dev/core";
import { createClient, type SessionSummary } from "@flow-state-dev/client";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { serve, type ServeHandle } from "../src/serve";

/** A turn the test ends by hand. */
let release: (() => void) | undefined;

const chat = defineFlow({
  kind: "chat",
  actions: {
    say: handler({ name: "chat-say", inputSchema: z.object({}), execute: () => ({}) }),
    slow: handler({
        name: "chat-slow",
        inputSchema: z.object({}),
        execute: () =>
          new Promise<Record<string, never>>((resolve) => {
            release = () => resolve({});
          })
      }),
    boom: handler({
        name: "chat-boom",
        inputSchema: z.object({}),
        execute: () => {
          throw new Error("the turn broke");
        }
      })
  }
})();

const handles: ServeHandle[] = [];
const closers: Array<() => void> = [];

afterEach(async () => {
  release?.();
  release = undefined;
  for (const close of closers.splice(0)) close();
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
});

async function start(): Promise<string> {
  const flowState = createFlowState({ flows: [chat], stores: { default: { primary: inMemoryStores() } } });
  const handle = await serve(flowState, { port: 0, host: "127.0.0.1", handleSignals: false, shutdownGraceMs: 200 });
  handles.push(handle);
  return `http://127.0.0.1:${handle.port}`;
}

/** A rail: the user's chat sessions, read again on each notice on their topic. No timer. */
function watch(baseUrl: string, userId: string) {
  const client = createClient({ userId, baseUrl });
  let rows: SessionSummary[] = [];
  let reads = 0;
  const read = async () => {
    reads += 1;
    rows = await client.sessions.list({ flowKind: "chat", include: ["status"] });
  };
  const subscription = client.subscribe([topic.user()], { onChange: () => void read() });
  closers.push(() => subscription.close());
  return { rows: () => rows, reads: () => reads };
}

async function within(ms: number, check: () => boolean): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`not within ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const statusOf = (rows: SessionSummary[], id: string) => rows.find((row) => row.id === id)?.requestStatus;

describe("a live list of a user's sessions, over push", () => {
  it("shows a session another client creates, then its turn running, then failed, each within a second", async () => {
    const baseUrl = await start();
    const rail = watch(baseUrl, "alice");
    // Connected: the first read after the socket opens.
    await within(2000, () => rail.reads() > 0);

    const otherTab = createClient({ userId: "alice", baseUrl });
    const { id } = await otherTab.flow("chat").createSession();
    await within(1000, () => rail.rows().some((row) => row.id === id));

    const running = otherTab.flow("chat").send("slow", {}, { sessionId: id }).catch(() => undefined);
    await within(1000, () => statusOf(rail.rows(), id) === "in_progress");
    await within(1000, () => release !== undefined);
    release?.();
    await running;
    await within(1000, () => statusOf(rail.rows(), id) === "completed");

    await otherTab.flow("chat").send("boom", {}, { sessionId: id }).catch(() => undefined);
    await within(1000, () => statusOf(rail.rows(), id) === "failed");
  });

  it("another user's rail hears none of it and reads nothing", async () => {
    const baseUrl = await start();
    const bobs = watch(baseUrl, "bob");
    await within(2000, () => bobs.reads() > 0);
    const settled = bobs.reads();

    const alice = createClient({ userId: "alice", baseUrl });
    const { id } = await alice.flow("chat").createSession();
    await alice.flow("chat").send("say", {}, { sessionId: id });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(bobs.reads()).toBe(settled);
    expect(bobs.rows()).toEqual([]);
  });
});

/**
 * `sessionFeed` against a real `serve()` host: what a board of workers or a
 * task transcript sees when it follows a session it did not send to.
 *
 * Two clients share a session. One follows it with a feed; the other sends.
 * The feed must hear the other client's turn without polling, keep its own
 * sent answer through `followResponse`, and say when the host is gone and
 * when it is back, because a view that still says "live" over a dead
 * connection shows the person stale work as current.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createFlowState, inMemoryStores, type FlowState } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createClient, sessionFeed, type SessionFeed } from "@flow-state-dev/client";
import { z } from "zod";
import { serve, type ServeHandle } from "../src/serve";

const notesFlow = defineFlow({
  kind: "notes",
  actions: {
    say: {
      inputSchema: z.object({ text: z.string() }),
      block: handler({
        name: "say",
        inputSchema: z.object({ text: z.string() }),
        execute: async (input, ctx) => {
          await ctx.emit.message(input.text);
          return {};
        },
      }),
    },
  },
})();

const handles: ServeHandle[] = [];
const feeds: SessionFeed[] = [];
afterEach(async () => {
  for (const feed of feeds.splice(0)) feed.close();
  while (handles.length > 0) await handles.pop()!.close();
});

async function host(flowState: FlowState, port = 0): Promise<ServeHandle> {
  const handle = await serve(flowState, { port, handleSignals: false, disposeOnClose: false, shutdownGraceMs: 0 });
  handles.push(handle);
  return handle;
}

function until(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() > deadline) return reject(new Error("condition never held"));
      setTimeout(tick, 20);
    };
    tick();
  });
}

const texts = (feed: SessionFeed): string[] =>
  feed
    .getSnapshot()
    .items.filter((item) => item.type === "message" && (item as { role?: string }).role !== "user")
    .map((item) => (item as unknown as { content: Array<{ text: string }> }).content[0]?.text ?? "");

describe("a session feed on a real host", () => {
  it("hears another client's turn, keeps its own sent answer, and says lapsed when the host goes and live when it is back", async () => {
    const flowState = createFlowState({
      flows: { notes: notesFlow },
      modelResolver: createMockModelResolver({}),
      stores: { default: { primary: inMemoryStores() } },
    });
    const first = await host(flowState);
    await flowState.ready();
    const baseUrl = `http://127.0.0.1:${first.port}`;
    const watcher = createClient({ userId: "alice", baseUrl });
    const sender = createClient({ userId: "alice", baseUrl });
    await sender.flow("notes").createSession({ sessionId: "s1" });
    await sender.flow("notes").send("say", { text: "before the feed" }, { sessionId: "s1" });

    const feed = sessionFeed(watcher, "s1");
    feeds.push(feed);
    const states: string[] = [];
    feed.subscribe(({ state }) => {
      if (states[states.length - 1] !== state) states.push(state);
    });

    // The history, then live once the stream names the runs.
    await until(() => feed.getSnapshot().state === "live");
    expect(texts(feed)).toEqual(["before the feed"]);
    expect(feed.getSnapshot().runs).toEqual([]);

    // Another client's turn arrives through the stream: nothing re-reads the history.
    await sender.flow("notes").send("say", { text: "from another tab" }, { sessionId: "s1" });
    await until(() => texts(feed).includes("from another tab"));

    // The watcher's own send, followed through its response.
    const response = await watcher.flow("notes").send("say", { text: "my own" }, { sessionId: "s1", stream: true });
    feed.followResponse(response);
    await until(() => texts(feed).includes("my own"));
    expect(texts(feed)).toEqual(["before the feed", "from another tab", "my own"]);

    // The host goes away: the feed stops vouching for what it shows.
    await first.close();
    handles.splice(handles.indexOf(first), 1);
    await until(() => feed.getSnapshot().state === "lapsed");
    expect(texts(feed)).toHaveLength(3);

    // The host comes back on the same address: the feed is live again by itself.
    await host(flowState, first.port);
    await until(() => feed.getSnapshot().state === "live", 20_000);
    expect(states).toEqual(["connecting", "live", "reconnecting", "lapsed", "live"]);
  }, 40_000);
});

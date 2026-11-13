// FIX-2675.
/**
 * The bound on what a request's SSE stream holds for its reader,
 * through the HTTP routes: a reader that falls behind gets its stream ended
 * and resumes by sequence number, and a 202 answer fills no live stream.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { createFlowApiRouter, createFlowRegistry } from "../../src";
import { createFlowRouteHandlers } from "../../src/routes/http-handlers";
import { createInMemoryStores } from "../../src/host";
import { DEFAULT_MAX_BUFFERED_SSE_BYTES } from "../../src/streaming/sse-stream";
import type { StoreRegistry } from "../../src/stores/types";

const KIND = "bounded-stream-flow";
const MESSAGE_BYTES = 64 * 1024;
// Each message travels twice (item.added, item.done): ~2.5x the bound in all.
const MESSAGES = Math.ceil((1.25 * DEFAULT_MAX_BUFFERED_SSE_BYTES) / MESSAGE_BYTES);

/** Emits its messages once `ready` settles (at once when absent). */
function chattyFlow(ready?: Promise<void>) {
  return defineFlow({
    kind: KIND,
    actions: {
      run: handler({
        name: "chatty",
        inputSchema: z.object({}),
        outputSchema: z.string(),
        execute: async (_input, ctx) => {
          await ready;
          for (let i = 0; i < MESSAGES; i++) {
            await ctx.emit.message(`m${i}:${"x".repeat(MESSAGE_BYTES)}`);
          }
          return "done";
        }
      })
    }
  })();
}

function setup(): { router: ReturnType<typeof createFlowApiRouter>; stores: StoreRegistry } {
  const stores = createInMemoryStores();
  const registry = createFlowRegistry();
  registry.register(chattyFlow());
  return { router: createFlowApiRouter({ registry, stores }), stores };
}

function postRun(router: ReturnType<typeof createFlowApiRouter>, requestId: string, accept?: string) {
  return router.POST(
    new Request(`http://localhost/api/flows/${KIND}/actions/run`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(accept ? { accept } : {}) },
      body: JSON.stringify({ userId: "user_1", requestId, input: {} })
    }),
    { params: { path: [KIND, "actions", "run"] } }
  );
}

async function waitForTerminal(stores: StoreRegistry, requestId: string): Promise<void> {
  for (let i = 0; i < 500; i++) {
    const status = (await stores.request.get(requestId))?.status;
    if (status === "completed") return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("request did not complete");
}

type Frame = { id?: string; event?: string; data?: string };

function parseFrames(text: string): Frame[] {
  return text
    .split("\n\n")
    .filter((block) => block.trim() !== "" && !block.startsWith(":"))
    .map((block) => {
      const frame: Frame = {};
      for (const line of block.split("\n")) {
        const at = line.indexOf(": ");
        if (at < 0) continue;
        const key = line.slice(0, at);
        const value = line.slice(at + 2);
        if (key === "id") frame.id = value;
        else if (key === "event") frame.event = value;
        else if (key === "data") frame.data = value;
      }
      return frame;
    });
}

/** The message indexes whose `item.done` the frames carry. */
function doneMessages(frames: Frame[]): number[] {
  return frames
    .filter((f) => f.event === "item.done" && f.data !== undefined)
    .map((f) => JSON.parse(f.data!) as { item: { type: string; content?: Array<{ text?: string }> } })
    .filter((e) => e.item.type === "message")
    .map((e) => Number(/^m(\d+):/.exec(e.item.content?.[0]?.text ?? "")?.[1]));
}

describe("request SSE stream buffer bound", () => {
  it("ends the inline stream of a reader that fell behind; resuming from its last id delivers every event", async () => {
    const { router, stores } = setup();
    const requestId = "req_slow_reader";

    const response = await postRun(router, requestId, "text/event-stream");
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    // The reader takes nothing while the whole run happens.
    await waitForTerminal(stores, requestId);

    const inline = parseFrames(await response.text());
    // Cut off before the end: no terminal event reached this reader.
    expect(inline.some((f) => f.event === "request.completed")).toBe(false);
    const lastId = inline.at(-1)?.id;
    expect(lastId).toBeDefined();

    const resumed = await router.GET(
      new Request(`http://localhost/api/flows/${KIND}/requests/${requestId}/stream`, {
        headers: { "last-event-id": lastId! }
      }),
      { params: { path: [KIND, "requests", requestId, "stream"] } }
    );
    const rest = parseFrames(await resumed.text());
    expect(rest.some((f) => f.event === "request.completed")).toBe(true);

    // Together the two streams deliver every message exactly once.
    const all = [...doneMessages(inline), ...doneMessages(rest)];
    expect(all).toEqual(Array.from({ length: MESSAGES }, (_, i) => i));
  });

  it("answers a caller that did not ask for a stream with 202 and fills no live stream", async () => {
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    let answered!: () => void;
    registry.register(chattyFlow(new Promise<void>((resolve) => (answered = resolve))));
    const handlers = createFlowRouteHandlers({ registry, stores, runtimeConfig: {} });
    // Watch the handle the action route gets back, to read what its live
    // stream was given.
    const dispatch = vi.spyOn(handlers.host, "dispatch");
    const requestId = "req_no_reader";

    const response = await handlers.handle(
      new Request(`http://localhost/api/flows/${KIND}/actions/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "user_1", requestId, input: {} })
      }),
      { path: [KIND, "actions", "run"] }
    );
    expect(response.status).toBe(202);
    // The run emits only after the caller has its answer.
    answered();
    await waitForTerminal(stores, requestId);

    const liveStream = dispatch.mock.results[0]?.value.liveStream;
    expect(liveStream).not.toBeNull();
    // Nothing the run emitted after the 202 went into it.
    const held = parseFrames(await new Response(liveStream.readable).text());
    expect(doneMessages(held)).toEqual([]);
    expect(held.some((f) => f.event === "request.completed")).toBe(false);
  });
});

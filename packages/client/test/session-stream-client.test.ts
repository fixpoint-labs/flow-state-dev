/**
 * `createSessionSSEClient`: following a whole session, and every way the
 * connection ends. The server side of the contract (what is sent, and when) is
 * the engine's conformance suite; this file holds the client to its half: hand
 * back the last server time on a reconnect, back off, and stop quietly where
 * retrying cannot help.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionStreamEvent } from "@flow-state-dev/core/items";
import { createSessionSSEClient, type ClientFetch } from "../src";

function frame(event: SessionStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function itemEvent(at: number, requestId: string, id: string): SessionStreamEvent {
  return {
    stream: "session",
    sessionId: "s1",
    at,
    type: "session.item",
    requestId,
    item: {
      id,
      type: "message",
      status: "completed",
      requestId,
      itemIndex: 0,
      ts: at,
      provenance: { blockName: "b", blockInstanceId: "b_1", phase: "main" },
      role: "assistant",
      content: [{ type: "output_text", text: id }]
    } as never
  };
}

function runsEvent(at: number, ids: string[]): SessionStreamEvent {
  return {
    stream: "session",
    sessionId: "s1",
    at,
    type: "session.runs",
    runs: ids.map((id) => ({ id, parentSessionId: "s1", createdAt: at, updatedAt: at }))
  };
}

/** A response whose body sends `text` and then ends: the server closed. */
function ended(text: string): Response {
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** A response whose body sends `text` and stays open until the request is aborted. */
function held(text: string, signal: AbortSignal | undefined): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      signal?.addEventListener("abort", () => {
        try {
          controller.error(new DOMException("aborted", "AbortError"));
        } catch {
          // Already closed.
        }
      });
    }
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function until(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() > deadline) return reject(new Error("condition never held"));
      setTimeout(tick, 5);
    };
    tick();
  });
}

const handles: Array<{ close(): void }> = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});

describe("createSessionSSEClient", () => {
  it("follows the session: items, runs, and the last server time heard", async () => {
    const urls: string[] = [];
    const fetcher: ClientFetch = vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(url);
      return held(frame(runsEvent(100, ["run_1"])) + frame(itemEvent(200, "req_1", "m1")), init?.signal ?? undefined);
    }) as unknown as ClientFetch;
    const onItem = vi.fn();
    const onRuns = vi.fn();
    const handle = createSessionSSEClient({
      sessionId: "s 1",
      baseUrl: "http://host",
      fetcher,
      itemTypes: ["message", "status"],
      onItem,
      onRuns
    });
    handles.push(handle);

    await until(() => onItem.mock.calls.length === 1);
    expect(urls).toEqual([
      "http://host/api/flows/sessions/s%201/stream?item_types=message%2Cstatus"
    ]);
    expect(onRuns.mock.calls[0][0].runs.map((r: { id: string }) => r.id)).toEqual(["run_1"]);
    expect(onItem.mock.calls[0][0]).toMatchObject({ requestId: "req_1", item: { id: "m1" } });
    expect(handle.lastAt).toBe(200);
    expect(handle.stopped).toBe(false);
  });

  it("reconnects when the server closes, handing back the last time it heard (BR-13, BR-24)", async () => {
    const urls: string[] = [];
    let call = 0;
    const fetcher: ClientFetch = (async (url: string, init?: RequestInit) => {
      urls.push(url);
      call += 1;
      if (call === 1) return ended(frame(itemEvent(1_000, "req_1", "m1")));
      return held(frame(itemEvent(2_000, "req_2", "m2")), init?.signal ?? undefined);
    }) as ClientFetch;
    const onItem = vi.fn();
    handles.push(
      createSessionSSEClient({
        sessionId: "s1",
        fetcher,
        since: 500,
        retry: { initialDelayMs: 10 },
        onItem
      })
    );

    await until(() => onItem.mock.calls.length === 2);
    expect(urls).toEqual([
      "/api/flows/sessions/s1/stream?since=500",
      "/api/flows/sessions/s1/stream?since=1000"
    ]);
  });

  it("backs off between failed attempts, doubling up to the cap", async () => {
    const at: number[] = [];
    const fetcher: ClientFetch = (async () => {
      at.push(Date.now());
      if (at.length <= 3) return new Response("down", { status: 503 });
      throw new TypeError("network down");
    }) as ClientFetch;
    const onError = vi.fn();
    handles.push(
      createSessionSSEClient({
        sessionId: "s1",
        fetcher,
        retry: { initialDelayMs: 20, maxDelayMs: 60 },
        onError
      })
    );

    await until(() => at.length >= 5);
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    // 20, 40, then capped at 60.
    expect(gaps[0]).toBeGreaterThanOrEqual(18);
    expect(gaps[1]).toBeGreaterThanOrEqual(38);
    expect(gaps[2]).toBeGreaterThanOrEqual(58);
    expect(gaps[3]).toBeGreaterThanOrEqual(58);
    expect(gaps[3]).toBeLessThan(120);
    // A dropped connection is expected; the view shows nothing for it.
    expect(onError).not.toHaveBeenCalled();
  });

  it("starts the backoff over once a connection has delivered events", async () => {
    const at: number[] = [];
    const fetcher: ClientFetch = (async () => {
      at.push(Date.now());
      // Two failures build the delay up; then a connection that delivers and
      // ends; then the next reconnect should wait only the initial delay.
      if (at.length <= 2) return new Response("down", { status: 503 });
      if (at.length === 3) return ended(frame(itemEvent(1, "req_1", "m1")));
      return new Response("down", { status: 503 });
    }) as ClientFetch;
    handles.push(
      createSessionSSEClient({ sessionId: "s1", fetcher, retry: { initialDelayMs: 40, maxDelayMs: 1_000 } })
    );

    await until(() => at.length >= 4);
    const afterDelivery = at[3] - at[2];
    expect(at[2] - at[1]).toBeGreaterThanOrEqual(78);
    expect(afterDelivery).toBeLessThan(78);
  });

  // A caller showing what the stream last said needs to know when that stops
  // being current: 1 is the routine reconnect after a close, 2 or more means a
  // try has failed since the stream last delivered.
  it("says each time it will try again, counting the tries since the stream last delivered", async () => {
    let calls = 0;
    const fetcher: ClientFetch = (async () => {
      calls += 1;
      if (calls === 1) return ended(frame(runsEvent(1, ["run_1"])));
      if (calls === 4) return ended(frame(runsEvent(2, [])));
      return new Response("down", { status: 503 });
    }) as ClientFetch;
    const attempts: number[] = [];
    handles.push(
      createSessionSSEClient({
        sessionId: "s1",
        fetcher,
        retry: { initialDelayMs: 5, maxDelayMs: 20 },
        onReconnecting: ({ attempt }) => attempts.push(attempt)
      })
    );

    await until(() => attempts.length >= 5);
    expect(attempts.slice(0, 5)).toEqual([1, 2, 3, 1, 2]);
  });

  it.each([404, 501, 401, 403])(
    "stops quietly on %i: no error, no retry (BR-15, BR-16)",
    async (status) => {
      const fetcher = vi.fn(async () => new Response("{}", { status }));
      const onStop = vi.fn();
      const onError = vi.fn();
      const onReconnecting = vi.fn();
      const handle = createSessionSSEClient({
        sessionId: "s1",
        fetcher: fetcher as unknown as ClientFetch,
        retry: { initialDelayMs: 5 },
        onStop,
        onError,
        onReconnecting
      });
      handles.push(handle);

      await until(() => onStop.mock.calls.length === 1);
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(onStop).toHaveBeenCalledWith({ status });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
      expect(onReconnecting).not.toHaveBeenCalled();
      expect(handle.stopped).toBe(true);
    }
  );

  // A session kept before records named their owner is refused the same way on
  // every try until an operator migrates it; retrying only adds load.
  it("stops quietly on a 409 migration-required: no error, no retry (BR-15)", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "migration-required", message: "unattributed" }), {
          status: 409,
          headers: { "content-type": "application/json" }
        })
    );
    const onStop = vi.fn();
    const onError = vi.fn();
    const handle = createSessionSSEClient({
      sessionId: "s1",
      fetcher: fetcher as unknown as ClientFetch,
      retry: { initialDelayMs: 5 },
      onStop,
      onError
    });
    handles.push(handle);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledWith({ status: 409 });
    expect(onError).not.toHaveBeenCalled();
    expect(handle.stopped).toBe(true);
  });

  it("does not stop on a server error: a 500 is retried", async () => {
    let call = 0;
    const fetcher: ClientFetch = (async (_url: string, init?: RequestInit) => {
      call += 1;
      if (call === 1) return new Response("boom", { status: 500 });
      return held(frame(itemEvent(1, "req_1", "m1")), init?.signal ?? undefined);
    }) as ClientFetch;
    const onItem = vi.fn();
    const onStop = vi.fn();
    handles.push(
      createSessionSSEClient({ sessionId: "s1", fetcher, retry: { initialDelayMs: 5 }, onItem, onStop })
    );

    await until(() => onItem.mock.calls.length === 1);
    expect(onStop).not.toHaveBeenCalled();
  });

  it("close() ends the connection and cancels a pending reconnect", async () => {
    let calls = 0;
    let aborted = false;
    const fetcher: ClientFetch = (async (_url: string, init?: RequestInit) => {
      calls += 1;
      init?.signal?.addEventListener("abort", () => (aborted = true));
      if (calls === 1) return held(frame(itemEvent(1, "req_1", "m1")), init?.signal ?? undefined);
      return ended("");
    }) as ClientFetch;
    const onItem = vi.fn();
    const handle = createSessionSSEClient({
      sessionId: "s1",
      fetcher,
      retry: { initialDelayMs: 5 },
      onItem
    });

    await until(() => onItem.mock.calls.length === 1);
    handle.close();
    expect(aborted).toBe(true);
    expect(handle.stopped).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toBe(1);
  });

  it("reports an event it cannot parse and keeps following", async () => {
    const fetcher: ClientFetch = (async (_url: string, init?: RequestInit) =>
      held(`data: {not json\n\n${frame(itemEvent(5, "req_1", "m1"))}`, init?.signal ?? undefined)) as ClientFetch;
    const onItem = vi.fn();
    const onError = vi.fn();
    handles.push(createSessionSSEClient({ sessionId: "s1", fetcher, onItem, onError }));

    await until(() => onItem.mock.calls.length === 1);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

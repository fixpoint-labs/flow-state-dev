/**
 * A send the server never answers fails instead of hanging.
 *
 * The server answers a send as soon as it takes it, so a send with no answer
 * is lost on the way. Before this limit, `flow().send` awaited a bare fetch
 * for ever and every message box built on it stayed busy with Send greyed
 * out. These tests pin the refusal (status 0, a plain message, the request
 * aborted), that a started stream is never cut off, and that `0` turns the
 * limit off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientHttpError, createClient, type ClientFetch } from "../src";

/** A fetcher that never answers, recording the signal each call carried. */
function silent() {
  const signals: (AbortSignal | undefined)[] = [];
  const fetcher: ClientFetch = (_input, init) => {
    signals.push(init?.signal ?? undefined);
    return new Promise<Response>(() => {});
  };
  return { fetcher, signals };
}

/** Settles `promise` into a tagged result, so a pending one can be told apart. */
function track<T>(promise: Promise<T>) {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  promise.then(
    (value) => Object.assign(state, { settled: true, value }),
    (error) => Object.assign(state, { settled: true, error })
  );
  return state;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a send the server never answers", () => {
  it("fails after 30 seconds by default, with status 0 and a plain message, and aborts the request", async () => {
    const { fetcher, signals } = silent();
    const sent = track(createClient({ userId: "u", fetcher }).flow("demo").send("run", {}));

    await vi.advanceTimersByTimeAsync(29_999);
    expect(sent.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(sent.error).toBeInstanceOf(ClientHttpError);
    expect((sent.error as ClientHttpError).status).toBe(0);
    expect((sent.error as Error).message).toBe("The server didn't answer the send within 30 seconds.");
    expect(signals[0]?.aborted).toBe(true);
  });

  it("takes its limit from sendTimeoutMs, for a streamed send too", async () => {
    const { fetcher } = silent();
    const sent = track(
      createClient({ userId: "u", fetcher, sendTimeoutMs: 5_000 }).flow("demo").send("run", {}, { stream: true })
    );

    await vi.advanceTimersByTimeAsync(5_000);

    expect((sent.error as Error).message).toBe("The server didn't answer the send within 5 seconds.");
  });

  it("waits for ever with sendTimeoutMs 0", async () => {
    const { fetcher } = silent();
    const sent = track(createClient({ userId: "u", fetcher, sendTimeoutMs: 0 }).flow("demo").send("run", {}));

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(sent.settled).toBe(false);
  });

  it("never cuts off a stream once its answer has started", async () => {
    let signal: AbortSignal | undefined;
    const fetcher: ClientFetch = async (_input, init) => {
      signal = init?.signal ?? undefined;
      // Headers now, the body never: a long-running stream.
      return new Response(new ReadableStream(), { status: 200, headers: { "content-type": "text/event-stream" } });
    };
    const sent = track(
      createClient({ userId: "u", fetcher, sendTimeoutMs: 1_000 }).flow("demo").send("run", {}, { stream: true })
    );

    await vi.advanceTimersByTimeAsync(60_000);

    expect(sent.value).toBeInstanceOf(Response);
    expect(signal?.aborted).toBe(false);
  });
});

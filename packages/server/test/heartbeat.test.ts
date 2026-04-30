import { describe, expect, it, vi, afterEach } from "vitest";
import { injectHeartbeat } from "../src/streaming/heartbeat";

describe("injectHeartbeat", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the original stream when intervalMs is 0 or negative", () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.close();
      }
    });
    expect(injectHeartbeat(stream, 0)).toBe(stream);

    const stream2 = new ReadableStream<Uint8Array>({
      start(c) {
        c.close();
      }
    });
    expect(injectHeartbeat(stream2, -100)).toBe(stream2);
  });

  it("emits a `: ping\\n\\n` frame at the configured cadence", async () => {
    vi.useFakeTimers();
    const decoder = new TextDecoder();

    // Source stream that never produces data on its own — heartbeat is the
    // only source of frames.
    let sourceController: ReadableStreamDefaultController<Uint8Array> | null =
      null;
    const source = new ReadableStream<Uint8Array>({
      start(c) {
        sourceController = c;
      }
    });

    const wrapped = injectHeartbeat(source, 1000);
    const reader = wrapped.getReader();

    // Tick past one interval and read one heartbeat.
    await vi.advanceTimersByTimeAsync(1100);
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(decoder.decode(first.value)).toBe(": ping\n\n");

    // Second interval -> second heartbeat.
    await vi.advanceTimersByTimeAsync(1000);
    const second = await reader.read();
    expect(second.done).toBe(false);
    expect(decoder.decode(second.value)).toBe(": ping\n\n");

    // Close source so reader observes done.
    sourceController!.close();
    await reader.cancel();
  });

  it("forwards source-stream data alongside heartbeats", async () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    let sourceController: ReadableStreamDefaultController<Uint8Array> | null =
      null;
    const source = new ReadableStream<Uint8Array>({
      start(c) {
        sourceController = c;
      }
    });

    // Real timers — write data immediately and verify it propagates.
    const wrapped = injectHeartbeat(source, 60_000);
    const reader = wrapped.getReader();

    sourceController!.enqueue(encoder.encode("data: hello\n\n"));
    sourceController!.close();

    const collected: string[] = [];
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      collected.push(decoder.decode(result.value));
    }
    expect(collected.join("")).toBe("data: hello\n\n");
  });
});

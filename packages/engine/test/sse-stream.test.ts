/**
 * Unit tests for `createSSEStream` — the unified writable surface that
 * replaces the hand-rolled `ReadableStream` + heartbeat wrapper pair.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { createSSEStream } from "../src/streaming/sse-stream";

const decoder = new TextDecoder();

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const parts: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(decoder.decode(value));
  }
  return parts.join("");
}

describe("createSSEStream", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("serializes frames written via writeFrame", async () => {
    const handle = createSSEStream();
    handle.writeFrame({ id: "req:1", event: "request.in_progress", data: { ok: true } });
    handle.writeFrame({ id: "req:2", event: "ping" });
    handle.close();

    const output = await readAll(handle.readable);
    expect(output).toContain("id: req:1\n");
    expect(output).toContain("event: request.in_progress\n");
    expect(output).toContain('data: {"ok":true}\n');
    expect(output).toContain("id: req:2\n");
  });

  it("forwards pre-encoded SSE chunks via writeRaw", async () => {
    const handle = createSSEStream();
    handle.writeRaw("id: a:1\nevent: foo\ndata: x\n\n");
    handle.writeRaw("id: a:2\nevent: bar\ndata: y\n\n");
    handle.close();

    const output = await readAll(handle.readable);
    expect(output).toBe(
      "id: a:1\nevent: foo\ndata: x\n\nid: a:2\nevent: bar\ndata: y\n\n"
    );
  });

  it("emits `: ping\\n\\n` comment frames at the configured cadence", async () => {
    vi.useFakeTimers();
    const handle = createSSEStream({ pingIntervalMs: 1000 });
    const reader = handle.readable.getReader();

    await vi.advanceTimersByTimeAsync(1100);
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(decoder.decode(first.value)).toBe(": ping\n\n");

    await vi.advanceTimersByTimeAsync(1000);
    const second = await reader.read();
    expect(second.done).toBe(false);
    expect(decoder.decode(second.value)).toBe(": ping\n\n");

    handle.close();
  });

  it("disables the heartbeat when pingIntervalMs is 0 or undefined", async () => {
    vi.useFakeTimers();
    const handleZero = createSSEStream({ pingIntervalMs: 0 });
    const handleUndef = createSSEStream();
    handleZero.writeRaw("data: a\n\n");
    handleUndef.writeRaw("data: b\n\n");

    await vi.advanceTimersByTimeAsync(60_000);

    handleZero.close();
    handleUndef.close();

    const a = await readAll(handleZero.readable);
    const b = await readAll(handleUndef.readable);
    expect(a).toBe("data: a\n\n");
    expect(b).toBe("data: b\n\n");
  });

  it("closes when the abort signal fires and stops the heartbeat timer", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const handle = createSSEStream({
      pingIntervalMs: 100,
      signal: controller.signal
    });

    // First heartbeat fires.
    await vi.advanceTimersByTimeAsync(110);

    controller.abort();
    // After abort, no more heartbeats should land in the readable.
    await vi.advanceTimersByTimeAsync(500);

    expect(handle.closed).toBe(true);

    const output = await readAll(handle.readable);
    // Exactly one ping written before abort.
    expect(output).toBe(": ping\n\n");
  });

  it("closes immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const handle = createSSEStream({ signal: controller.signal });

    expect(handle.closed).toBe(true);
    const output = await readAll(handle.readable);
    expect(output).toBe("");
  });

  it("close() is idempotent", async () => {
    const handle = createSSEStream();
    handle.close();
    handle.close();
    handle.close();
    expect(handle.closed).toBe(true);
  });

  it("subsequent writes after close are no-ops", async () => {
    const handle = createSSEStream();
    handle.writeRaw("data: before\n\n");
    handle.close();
    handle.writeRaw("data: after\n\n");
    handle.writeFrame({ id: "z", event: "x", data: "y" });
    handle.writeComment("late");

    const output = await readAll(handle.readable);
    expect(output).toBe("data: before\n\n");
  });

  it("writeComment emits `: <text>\\n\\n`", async () => {
    const handle = createSSEStream();
    handle.writeComment("hello");
    handle.close();
    const output = await readAll(handle.readable);
    expect(output).toBe(": hello\n\n");
  });
});

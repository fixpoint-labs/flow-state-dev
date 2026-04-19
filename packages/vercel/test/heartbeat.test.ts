import { describe, it, expect, vi } from "vitest";
import { injectHeartbeat } from "../src/heartbeat";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function createTestStream(chunks: string[], delayMs = 0): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });
}

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

describe("injectHeartbeat", () => {
  it("passes through all data from the source stream", async () => {
    const source = createTestStream(["data: hello\n\n", "data: world\n\n"]);
    // Use a very long heartbeat interval so it doesn't fire during the test
    const wrapped = injectHeartbeat(source, 60_000);
    const result = await readAll(wrapped);

    expect(result).toContain("data: hello\n\n");
    expect(result).toContain("data: world\n\n");
  });

  it("injects heartbeat comments on interval", async () => {
    // Create a stream with a delay to allow heartbeats to fire
    const source = createTestStream(["data: test\n\n"], 100);
    const wrapped = injectHeartbeat(source, 30); // 30ms heartbeat

    const result = await readAll(wrapped);

    expect(result).toContain("data: test\n\n");
    expect(result).toContain(": ping\n\n");
  });

  it("handles empty streams", async () => {
    const source = createTestStream([]);
    const wrapped = injectHeartbeat(source, 60_000);
    const result = await readAll(wrapped);

    expect(result).toBe("");
  });

  it("cleans up heartbeat timer when source closes", async () => {
    vi.useFakeTimers();
    const source = createTestStream(["data: done\n\n"]);
    const wrapped = injectHeartbeat(source, 100);

    const reader = wrapped.getReader();
    // Read all data
    const { value: first } = await reader.read();
    expect(decoder.decode(first)).toBe("data: done\n\n");

    const { done } = await reader.read();
    expect(done).toBe(true);

    vi.useRealTimers();
  });

  it("cleans up on cancel", async () => {
    const source = new ReadableStream<Uint8Array>({
      start() {
        // Never closes — simulates a long-lived SSE stream
      }
    });

    const wrapped = injectHeartbeat(source, 60_000);
    const reader = wrapped.getReader();

    // Cancel the consumer side (simulates client disconnect)
    await reader.cancel();

    // Should not throw — cleanup is graceful
  });
});

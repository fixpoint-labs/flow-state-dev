/**
 * Audio-player tests for the Web Audio API rewrite (FIX-523).
 *
 * The player is the consumer side of the streaming TTS contract. These
 * tests use a hand-rolled `AudioContext` fake (no jsdom/web-audio-api
 * polyfill available in this package) covering the minimum surface the
 * player touches: `currentTime`, `destination`, `decodeAudioData`,
 * `createBufferSource`, `state`, `resume`, `close`.
 *
 * Verified behavior:
 * - `enqueueChunk` decodes the chunk, creates a buffer source, and starts
 *   it at a monotonically increasing `nextStartTime` cursor (gap-free).
 * - The whole-buffer `enqueue` path is equivalent to `enqueueChunk` with
 *   `isLast: true`.
 * - `stop()` cancels in-flight sources and resets the cursor.
 * - `dispose()` releases the AudioContext.
 * - A suspended AudioContext buffers chunks and drains them on resume.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAudioPlayer } from "../../src/voice/audio-player";

type FakeBufferSource = {
  buffer: { duration: number } | null;
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
};

type FakeAudioContext = {
  state: "suspended" | "running" | "closed";
  currentTime: number;
  destination: object;
  decodeAudioData: ReturnType<typeof vi.fn>;
  createBufferSource: () => FakeBufferSource;
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

const startedSources: FakeBufferSource[] = [];

function createFakeContext(initialState: FakeAudioContext["state"] = "running"): FakeAudioContext {
  const ctx: FakeAudioContext = {
    state: initialState,
    currentTime: 0,
    destination: {},
    decodeAudioData: vi.fn((buffer: ArrayBuffer) => {
      // Encode the chunk's "duration" in the first byte for predictable
      // monotonic-cursor assertions: every chunk is 0.5 seconds long.
      void buffer;
      return Promise.resolve({ duration: 0.5 });
    }),
    createBufferSource: () => {
      const source: FakeBufferSource = {
        buffer: null,
        connect: vi.fn(),
        start: vi.fn(() => {
          startedSources.push(source);
        }),
        stop: vi.fn(),
        onended: null
      };
      return source;
    },
    resume: vi.fn(async () => {
      ctx.state = "running";
    }),
    close: vi.fn(async () => {
      ctx.state = "closed";
    })
  };
  return ctx;
}

let activeContext: FakeAudioContext;

beforeEach(() => {
  startedSources.length = 0;
  activeContext = createFakeContext();
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = vi.fn(
    () => activeContext
  );
  // atob is needed by base64ToArrayBuffer.
  if (typeof globalThis.atob === "undefined") {
    (globalThis as unknown as { atob: (s: string) => string }).atob = (s: string) =>
      Buffer.from(s, "base64").toString("binary");
  }
});

afterEach(() => {
  delete (globalThis as { AudioContext?: unknown }).AudioContext;
});

function flush(): Promise<void> {
  // Two microtask hops — one for decodeAudioData's promise, one for the
  // `.then` chain that schedules the source.
  return Promise.resolve().then(() => Promise.resolve());
}

const SAMPLE_AUDIO_BASE64 = Buffer.from(new Uint8Array([0x00, 0x01, 0x02])).toString(
  "base64"
);

describe("audio-player — Web Audio scheduling", () => {
  it("enqueueChunk decodes and schedules with monotonically increasing start times", async () => {
    const player = createAudioPlayer();

    player.enqueueChunk({ audio: SAMPLE_AUDIO_BASE64, mediaType: "audio/mpeg" });
    player.enqueueChunk({ audio: SAMPLE_AUDIO_BASE64, mediaType: "audio/mpeg" });
    player.enqueueChunk({
      audio: SAMPLE_AUDIO_BASE64,
      mediaType: "audio/mpeg",
      isLast: true
    });

    await flush();

    expect(activeContext.decodeAudioData).toHaveBeenCalledTimes(3);
    expect(startedSources).toHaveLength(3);

    const startTimes = startedSources.map((s) => s.start.mock.calls[0]![0] as number);
    // Each chunk reports duration 0.5 → cursor advances 0.5s per chunk
    // → start times are 0, 0.5, 1.0.
    expect(startTimes).toEqual([0, 0.5, 1.0]);
  });

  it("enqueue (whole-buffer) flows through the same Web Audio pipeline", async () => {
    const player = createAudioPlayer();

    player.enqueue(SAMPLE_AUDIO_BASE64, "audio/mpeg");

    await flush();

    expect(activeContext.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(startedSources).toHaveLength(1);
    expect(startedSources[0]!.connect).toHaveBeenCalledWith(activeContext.destination);
  });

  it("stop() invalidates in-flight decodeAudioData promises so they don't play after stop", async () => {
    // Hold the decode promise so stop() lands while the decode is in
    // flight. Then resolve it and assert no source was scheduled — the
    // generation counter must have caught the stale chunk.
    let resolveDecode!: (buf: { duration: number }) => void;
    activeContext.decodeAudioData = vi.fn(
      () => new Promise<{ duration: number }>((res) => { resolveDecode = res; })
    );

    const player = createAudioPlayer();
    player.enqueueChunk({ audio: SAMPLE_AUDIO_BASE64, mediaType: "audio/mpeg" });

    player.stop();

    resolveDecode({ duration: 0.5 });
    await flush();

    expect(startedSources).toHaveLength(0);
  });

  it("stop() aborts in-flight sources and resets the cursor", async () => {
    const player = createAudioPlayer();
    player.enqueueChunk({ audio: SAMPLE_AUDIO_BASE64, mediaType: "audio/mpeg" });
    player.enqueueChunk({ audio: SAMPLE_AUDIO_BASE64, mediaType: "audio/mpeg" });

    await flush();
    expect(startedSources).toHaveLength(2);

    player.stop();

    expect(startedSources[0]!.stop).toHaveBeenCalled();
    expect(startedSources[1]!.stop).toHaveBeenCalled();

    // After stop, a new chunk starts back at currentTime, not the prior cursor.
    activeContext.currentTime = 5;
    player.enqueueChunk({ audio: SAMPLE_AUDIO_BASE64, mediaType: "audio/mpeg" });

    await flush();

    const newest = startedSources[startedSources.length - 1]!;
    expect(newest.start.mock.calls[0]![0]).toBe(5);
  });

  it("dispose() closes the AudioContext", async () => {
    const player = createAudioPlayer();
    player.enqueueChunk({ audio: SAMPLE_AUDIO_BASE64, mediaType: "audio/mpeg" });
    await flush();

    player.dispose();

    expect(activeContext.close).toHaveBeenCalled();
  });

  it("onStateChange transitions idle -> playing -> idle as chunks complete", async () => {
    const states: string[] = [];
    const player = createAudioPlayer({
      onStateChange: (s) => states.push(s)
    });

    player.enqueueChunk({ audio: SAMPLE_AUDIO_BASE64, mediaType: "audio/mpeg" });
    await flush();

    expect(states).toContain("playing");

    // Simulate the underlying source ending naturally.
    startedSources[0]!.onended?.();

    expect(states[states.length - 1]).toBe("idle");
  });
});

describe("audio-player — suspended AudioContext handling", () => {
  it("buffers chunks while suspended and drains them on resume", async () => {
    activeContext = createFakeContext("suspended");
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = vi.fn(
      () => activeContext
    );

    const player = createAudioPlayer();
    player.enqueueChunk({ audio: SAMPLE_AUDIO_BASE64, mediaType: "audio/mpeg" });

    expect(activeContext.resume).toHaveBeenCalled();
    expect(activeContext.decodeAudioData).not.toHaveBeenCalled();

    // After resume flips state to "running", the buffered chunk replays.
    await flush();
    await flush();

    expect(activeContext.decodeAudioData).toHaveBeenCalledTimes(1);
  });

  it("discards chunks once the suspended-buffer limit is reached", () => {
    activeContext = createFakeContext("suspended");
    // Make resume hang so the buffer can't drain.
    activeContext.resume = vi.fn(() => new Promise(() => {}));
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = vi.fn(
      () => activeContext
    );

    const errors: Error[] = [];
    const player = createAudioPlayer({ onError: (e) => errors.push(e) });

    // Limit is 3; the 4th must be rejected.
    for (let i = 0; i < 4; i++) {
      player.enqueueChunk({ audio: SAMPLE_AUDIO_BASE64, mediaType: "audio/mpeg" });
    }

    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]!.message).toMatch(/suspended/i);
  });
});

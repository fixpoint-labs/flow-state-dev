/**
 * Tests for the TTS pipeline (FIX-528): batch vs streaming dispatch, ordered
 * emission across concurrent synthesis, first-chunk timeout, AbortSignal
 * honoring, mid-stream errors, empty iterables, and the non-fatal error path.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { VoiceError, type SpeakChunk, type VoiceProvider } from "@flow-state-dev/core/types";
import type { TTSConfig } from "@flow-state-dev/core/types";
import { createResponseEmitter, type RequestStreamEventWithId } from "../src/streaming/response-emitter";
import { createTTSPipeline } from "../src/voice/tts-pipeline";

const config: TTSConfig = { model: "mock-tts", voice: "alloy" };

function makeEmitter() {
  const captured: RequestStreamEventWithId[] = [];
  const emitter = createResponseEmitter({
    requestId: "req_tts",
    onEvent: (event) => {
      captured.push(event);
    }
  });
  return { emitter, captured };
}

function chunk(bytes: number[], isLast?: boolean): SpeakChunk {
  return {
    kind: "audio",
    bytes: new Uint8Array(bytes),
    mediaType: "audio/mp3",
    ...(isLast === true ? { isLast: true } : {})
  };
}

function audioDeltas(captured: RequestStreamEventWithId[]) {
  return captured.filter((e) => e.type === "content.audio.delta");
}
function contentDone(captured: RequestStreamEventWithId[]) {
  return captured.filter((e) => e.type === "content.done");
}
function contentAdded(captured: RequestStreamEventWithId[]) {
  return captured.filter((e) => e.type === "content.added");
}
function synthErrors(captured: RequestStreamEventWithId[]) {
  return captured.filter(
    (e) => e.type === "debug" && (e as any).name === "tts.synthesis.error"
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("TTS pipeline — batch dispatch", () => {
  it("dispatches to speak() and emits content.added + content.done", async () => {
    const speak = vi.fn(async () => ({
      audio: new Uint8Array([1, 2, 3]),
      mediaType: "audio/mp3"
    }));
    const provider: VoiceProvider = {
      id: "mock-batch:1",
      providerName: "mock",
      abilities: { speak: true, speakStream: false, transcribe: false, listVoices: false },
      speak
    };
    const { emitter, captured } = makeEmitter();
    const pipeline = createTTSPipeline({ provider, config, emitter });

    pipeline.onContentDelta("item1", 0, "Hello world");
    await pipeline.flush("item1");

    expect(speak).toHaveBeenCalledTimes(1);
    expect(contentAdded(captured)).toHaveLength(1);
    expect(contentDone(captured)).toHaveLength(1);
    expect((contentDone(captured)[0] as any).content.type).toBe("output_audio");
    expect(audioDeltas(captured)).toHaveLength(0);
  });

  it("preserves per-item emission order across two concurrent sentences", async () => {
    const order: string[] = [];
    const speak = vi.fn(async (opts: { text: string }) => {
      // Second sentence resolves first, but emission must stay ordered.
      await new Promise((r) => setTimeout(r, opts.text.startsWith("One") ? 20 : 1));
      return { audio: new Uint8Array([1]), mediaType: "audio/mp3" };
    });
    const provider: VoiceProvider = {
      id: "mock-batch:2",
      providerName: "mock",
      abilities: { speak: true, speakStream: false, transcribe: false, listVoices: false },
      speak
    };
    const { emitter, captured } = makeEmitter();
    const pipeline = createTTSPipeline({ provider, config, emitter });

    pipeline.onContentDelta("item1", 0, "One. Two. ");
    await pipeline.flush("item1");

    expect(speak).toHaveBeenCalledTimes(2);
    const dones = contentDone(captured);
    expect(dones).toHaveLength(2);
    // First emitted done carries the first sentence's transcript.
    expect((dones[0] as any).content.transcript).toBe("One.");
    expect((dones[1] as any).content.transcript).toBe("Two.");
    void order;
  });

  it("times out a slow batch call and reports a non-fatal error", async () => {
    vi.useFakeTimers();
    const provider: VoiceProvider = {
      id: "mock-batch:slow",
      providerName: "mock",
      abilities: { speak: true, speakStream: false, transcribe: false, listVoices: false },
      speak: vi.fn(() => new Promise(() => {})) // never resolves
    };
    const { emitter, captured } = makeEmitter();
    const pipeline = createTTSPipeline({ provider, config, emitter });

    pipeline.onContentDelta("item1", 0, "Hello world");
    const flushed = pipeline.flush("item1");
    await vi.advanceTimersByTimeAsync(15_100);
    await flushed;

    expect(synthErrors(captured)).toHaveLength(1);
    expect(contentDone(captured)).toHaveLength(0);
  });

  it("reports a VoiceError kind and logs at warn for a hard-fail kind", async () => {
    const provider: VoiceProvider = {
      id: "mock-batch:auth",
      providerName: "mock",
      abilities: { speak: true, speakStream: false, transcribe: false, listVoices: false },
      speak: vi.fn(async () => {
        throw new VoiceError({ kind: "auth", provider: "mock", message: "bad key" });
      })
    };
    const { emitter, captured } = makeEmitter();
    const pipeline = createTTSPipeline({ provider, config, emitter });

    pipeline.onContentDelta("item1", 0, "Hello world");
    await pipeline.flush("item1");

    const errors = synthErrors(captured);
    expect(errors).toHaveLength(1);
    expect((errors[0] as any).data.kind).toBe("auth");
    expect((errors[0] as any).data.level).toBe("warn");
    expect((errors[0] as any).data.retryable).toBe(false);
  });

  it("wraps a non-VoiceError as kind=unknown logged at error", async () => {
    const provider: VoiceProvider = {
      id: "mock-batch:boom",
      providerName: "mock",
      abilities: { speak: true, speakStream: false, transcribe: false, listVoices: false },
      speak: vi.fn(async () => {
        throw new Error("kaboom");
      })
    };
    const { emitter, captured } = makeEmitter();
    const pipeline = createTTSPipeline({ provider, config, emitter });

    pipeline.onContentDelta("item1", 0, "Hello world");
    await pipeline.flush("item1");

    const errors = synthErrors(captured);
    expect(errors).toHaveLength(1);
    expect((errors[0] as any).data.kind).toBe("unknown");
    expect((errors[0] as any).data.level).toBe("error");
  });

  it("logs retryable kinds at info", async () => {
    const provider: VoiceProvider = {
      id: "mock-batch:rl",
      providerName: "mock",
      abilities: { speak: true, speakStream: false, transcribe: false, listVoices: false },
      speak: vi.fn(async () => {
        throw new VoiceError({ kind: "rate_limit", provider: "mock", message: "slow down" });
      })
    };
    const { emitter, captured } = makeEmitter();
    const pipeline = createTTSPipeline({ provider, config, emitter });

    pipeline.onContentDelta("item1", 0, "Hello world");
    await pipeline.flush("item1");

    const errors = synthErrors(captured);
    expect((errors[0] as any).data.level).toBe("info");
    expect((errors[0] as any).data.retryable).toBe(true);
  });
});

describe("TTS pipeline — streaming dispatch", () => {
  function streamProvider(
    gen: (opts: { signal?: AbortSignal }) => AsyncIterable<SpeakChunk>
  ): VoiceProvider {
    return {
      id: "mock-stream:1",
      providerName: "mock",
      abilities: { speak: false, speakStream: true, transcribe: false, listVoices: false },
      speakStream: vi.fn(gen)
    };
  }

  it("dispatches to speakStream() and emits audio deltas then content.done", async () => {
    const provider = streamProvider(() =>
      (async function* () {
        yield chunk([1, 2]);
        yield chunk([3, 4], true);
      })()
    );
    const { emitter, captured } = makeEmitter();
    const pipeline = createTTSPipeline({ provider, config, emitter });

    pipeline.onContentDelta("item1", 0, "Hello world");
    await pipeline.flush("item1");

    const deltas = audioDeltas(captured);
    expect(deltas).toHaveLength(2);
    expect((deltas[1] as any).isLast).toBe(true);
    expect(contentDone(captured)).toHaveLength(1);
    // The streaming path opens the content part with an empty-audio
    // placeholder before the first delta (same protocol as batch), so the
    // client can allocate its decoding slot and resolve mediaType.
    const added = contentAdded(captured);
    expect(added).toHaveLength(1);
    expect((added[0] as any).content.audio).toBe("");
    // Ordering: content.added precedes every audio delta, which precede
    // content.done.
    const order = captured
      .map((e, i) => ({ type: e.type, i }))
      .filter((e) =>
        ["content.added", "content.audio.delta", "content.done"].includes(e.type)
      );
    expect(order[0]!.type).toBe("content.added");
    expect(order.at(-1)!.type).toBe("content.done");
  });

  it("emits a content.added placeholder + single content.done for an empty iterable", async () => {
    const provider = streamProvider(() => (async function* () {})());
    const { emitter, captured } = makeEmitter();
    const pipeline = createTTSPipeline({ provider, config, emitter });

    pipeline.onContentDelta("item1", 0, "Hello world");
    await pipeline.flush("item1");

    expect(audioDeltas(captured)).toHaveLength(0);
    const added = contentAdded(captured);
    expect(added).toHaveLength(1);
    expect((added[0] as any).content.audio).toBe("");
    const dones = contentDone(captured);
    expect(dones).toHaveLength(1);
    expect((dones[0] as any).content.audio).toBe("");
    expect(synthErrors(captured)).toHaveLength(0);
  });

  it("times out when the first chunk never arrives and reports a non-fatal error", async () => {
    vi.useFakeTimers();
    const provider = streamProvider(() =>
      (async function* () {
        await new Promise(() => {}); // never yields
      })()
    );
    const { emitter, captured } = makeEmitter();
    const pipeline = createTTSPipeline({ provider, config, emitter });

    pipeline.onContentDelta("item1", 0, "Hello world");
    const flushed = pipeline.flush("item1");
    await vi.advanceTimersByTimeAsync(15_100);
    await flushed;

    expect(synthErrors(captured)).toHaveLength(1);
    expect(contentDone(captured)).toHaveLength(0);
  });

  it("truncates a mid-stream error but still runs the next sentence", async () => {
    let call = 0;
    const provider = streamProvider(() => {
      call++;
      if (call === 1) {
        return (async function* () {
          yield chunk([1]);
          yield chunk([2]);
          throw new VoiceError({ kind: "network", provider: "mock", message: "drop" });
        })();
      }
      return (async function* () {
        yield chunk([9], true);
      })();
    });
    const { emitter, captured } = makeEmitter();
    const pipeline = createTTSPipeline({ provider, config, emitter });

    pipeline.onContentDelta("item1", 0, "One. Two. ");
    await pipeline.flush("item1");

    // First sentence: 2 deltas, then error. Second sentence: 1 delta.
    expect(audioDeltas(captured).length).toBe(3);
    expect(synthErrors(captured)).toHaveLength(1);
    // Both sentences opened a part (content.added), and both close it
    // (content.done) — the errored sentence still closes the part it opened
    // so the client is never left with a dangling empty output_audio.
    expect(contentAdded(captured)).toHaveLength(2);
    expect(contentDone(captured)).toHaveLength(2);
  });

  it("closes the content part with content.done when the drain aborts mid-stream", async () => {
    // A synthesis failure after the placeholder must still emit content.done
    // for the same part, or clients that allocate on content.added leak an
    // open empty output_audio.
    const provider = streamProvider(() =>
      (async function* () {
        yield chunk([1]);
        throw new VoiceError({ kind: "network", provider: "mock", message: "drop" });
      })()
    );
    const { emitter, captured } = makeEmitter();
    const pipeline = createTTSPipeline({ provider, config, emitter });

    pipeline.onContentDelta("item1", 0, "Hello world");
    await pipeline.flush("item1");

    expect(synthErrors(captured)).toHaveLength(1);
    const added = contentAdded(captured);
    const done = contentDone(captured);
    expect(added).toHaveLength(1);
    expect(done).toHaveLength(1);
    // The close targets the same (itemId, contentIndex) that was opened.
    expect((done[0] as any).contentIndex).toBe((added[0] as any).contentIndex);
  });

  it("calls iterator.return() on the upstream generator after draining", async () => {
    const returnSpy = vi.fn(async () => ({ done: true, value: undefined }));
    const provider = streamProvider(() => {
      const inner = (async function* () {
        yield chunk([1], true);
      })();
      return {
        [Symbol.asyncIterator]() {
          const it = inner[Symbol.asyncIterator]();
          return {
            next: () => it.next(),
            return: returnSpy
          } as AsyncIterator<SpeakChunk>;
        }
      };
    });
    const { emitter } = makeEmitter();
    const pipeline = createTTSPipeline({ provider, config, emitter });

    pipeline.onContentDelta("item1", 0, "Hello world");
    await pipeline.flush("item1");

    expect(returnSpy).toHaveBeenCalled();
  });
});

describe("TTS pipeline — cancellation", () => {
  it("cancel() releases slots and stops further emission", async () => {
    const returns: number[] = [];
    let n = 0;
    const provider: VoiceProvider = {
      id: "mock-stream:cancel",
      providerName: "mock",
      abilities: { speak: false, speakStream: true, transcribe: false, listVoices: false },
      speakStream: vi.fn(() => {
        const id = n++;
        return {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                await new Promise((r) => setTimeout(r, 1000));
                return { done: false, value: chunk([1]) };
              },
              async return() {
                returns.push(id);
                return { done: true, value: undefined };
              }
            } as AsyncIterator<SpeakChunk>;
          }
        };
      })
    };
    const { emitter, captured } = makeEmitter();
    const pipeline = createTTSPipeline({ provider, config, emitter });

    pipeline.onContentDelta("item1", 0, "One. Two. Three. ");
    // Let the syntheses start (acquire slots, begin first-chunk pulls).
    await new Promise((r) => setTimeout(r, 10));
    await pipeline.cancel();

    // Active iterators were returned; no content.done emitted.
    expect(returns.length).toBeGreaterThan(0);
    expect(contentDone(captured)).toHaveLength(0);
  });

  it("aborting the request signal mid-batch surfaces a non-fatal aborted item", async () => {
    const controller = new AbortController();
    const provider: VoiceProvider = {
      id: "mock-batch:abort",
      providerName: "mock",
      abilities: { speak: true, speakStream: false, transcribe: false, listVoices: false },
      speak: vi.fn(async (opts: { signal?: AbortSignal }) => {
        const aborted = () =>
          new VoiceError({ kind: "aborted", provider: "mock", message: "client gone" });
        if (opts.signal?.aborted === true) throw aborted();
        await new Promise((_resolve, reject) => {
          opts.signal?.addEventListener("abort", () => reject(aborted()));
        });
        return { audio: new Uint8Array(), mediaType: "audio/mp3" };
      })
    };
    const { emitter, captured } = makeEmitter();
    const pipeline = createTTSPipeline({ provider, config, emitter, signal: controller.signal });

    pipeline.onContentDelta("item1", 0, "Hello world");
    const flushed = pipeline.flush("item1");
    // Let the synthesis IIFE reach speak() and attach its abort listener.
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    await flushed;

    const errors = synthErrors(captured);
    expect(errors).toHaveLength(1);
    expect((errors[0] as any).data.kind).toBe("aborted");
    expect((errors[0] as any).data.level).toBe("debug");
  });
});

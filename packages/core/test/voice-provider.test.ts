import { describe, it, expect, vi } from "vitest";
import {
  canListVoices,
  canSpeak,
  canSpeakStream,
  canTranscribe,
  createCompositeVoiceProvider,
  VoiceError,
  type SpeakChunk,
  type SpeakResult,
  type TranscribeResult,
  type VoiceAbilities,
  type VoiceErrorKind,
  type VoiceInfo,
  type VoiceProvider,
} from "../src";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(overrides: Partial<VoiceProvider> & {
  abilities: Partial<VoiceAbilities>;
}): VoiceProvider {
  const abilities: VoiceAbilities = {
    speak: false,
    speakStream: false,
    transcribe: false,
    listVoices: false,
    ...overrides.abilities,
  };
  return {
    id: overrides.id ?? "fake:1",
    providerName: overrides.providerName ?? "fake",
    abilities,
    ...(overrides.defaultModels ? { defaultModels: overrides.defaultModels } : {}),
    ...(overrides.speak ? { speak: overrides.speak } : {}),
    ...(overrides.speakStream ? { speakStream: overrides.speakStream } : {}),
    ...(overrides.transcribe ? { transcribe: overrides.transcribe } : {}),
    ...(overrides.listVoices ? { listVoices: overrides.listVoices } : {}),
  };
}

async function* makeAudioStream(): AsyncIterable<SpeakChunk> {
  yield { kind: "audio", bytes: new Uint8Array([1]), mediaType: "audio/mpeg" };
  yield { kind: "audio", bytes: new Uint8Array([2]), mediaType: "audio/mpeg", isLast: true };
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

describe("voice type guards", () => {
  it("canSpeak reflects abilities.speak", () => {
    const yes = makeProvider({
      abilities: { speak: true },
      speak: async () => ({ audio: new Uint8Array(), mediaType: "audio/mpeg" }),
    });
    const no = makeProvider({ abilities: { speak: false } });
    expect(canSpeak(yes)).toBe(true);
    expect(canSpeak(no)).toBe(false);
  });

  it("canSpeakStream reflects abilities.speakStream", () => {
    const yes = makeProvider({
      abilities: { speakStream: true },
      speakStream: () => makeAudioStream(),
    });
    const no = makeProvider({ abilities: { speakStream: false } });
    expect(canSpeakStream(yes)).toBe(true);
    expect(canSpeakStream(no)).toBe(false);
  });

  it("canTranscribe reflects abilities.transcribe", () => {
    const yes = makeProvider({
      abilities: { transcribe: true },
      transcribe: async () => ({ text: "hi" }),
    });
    const no = makeProvider({ abilities: { transcribe: false } });
    expect(canTranscribe(yes)).toBe(true);
    expect(canTranscribe(no)).toBe(false);
  });

  it("canListVoices reflects abilities.listVoices", () => {
    const yes = makeProvider({
      abilities: { listVoices: true },
      listVoices: async () => [],
    });
    const no = makeProvider({ abilities: { listVoices: false } });
    expect(canListVoices(yes)).toBe(true);
    expect(canListVoices(no)).toBe(false);
  });

  it("narrows the call-site type after guarding", async () => {
    // This test passes if it compiles. After `canSpeak(p)`, `p.speak` must be
    // callable without `!`. After `canListVoices(p)`, `p.listVoices` likewise.
    const p = makeProvider({
      abilities: { speak: true, listVoices: true },
      speak: async () => ({ audio: new Uint8Array([7]), mediaType: "audio/mpeg" }),
      listVoices: async (): Promise<VoiceInfo[]> => [{ id: "v", name: "V", provider: "fake" }],
    });
    if (canSpeak(p)) {
      const r: SpeakResult = await p.speak({ text: "hi" });
      expect(r.mediaType).toBe("audio/mpeg");
    }
    if (canListVoices(p)) {
      const voices = await p.listVoices();
      expect(voices[0].id).toBe("v");
    }
  });
});

// ---------------------------------------------------------------------------
// createCompositeVoiceProvider
// ---------------------------------------------------------------------------

describe("createCompositeVoiceProvider", () => {
  it("with no slots, every ability is false and id+name are stable", () => {
    const c = createCompositeVoiceProvider({});
    expect(c.providerName).toBe("composite");
    expect(c.id).toBe("composite:speak=-|stream=-|tx=-|voices=-");
    expect(c.abilities).toEqual({
      speak: false,
      speakStream: false,
      transcribe: false,
      listVoices: false,
    });
  });

  it("delegates speak to the slot provider", async () => {
    const speak = vi.fn(async () => ({
      audio: new Uint8Array([42]),
      mediaType: "audio/mpeg",
    }));
    const underlying = makeProvider({
      id: "openai:1",
      providerName: "openai",
      abilities: { speak: true },
      speak,
    });
    const c = createCompositeVoiceProvider({ speak: underlying });
    expect(c.abilities.speak).toBe(true);
    expect(canSpeak(c)).toBe(true);
    const result = await c.speak!({ text: "hello" });
    expect(speak).toHaveBeenCalledWith({ text: "hello" });
    expect(result.audio[0]).toBe(42);
  });

  it("respects the underlying ability flag, not slot presence", () => {
    // Slot is set but its provider declares speak=false: composite is also false.
    const underlying = makeProvider({ abilities: { speak: false } });
    const c = createCompositeVoiceProvider({ speak: underlying });
    expect(c.abilities.speak).toBe(false);
    expect(c.speak).toBeUndefined();
  });

  it("falls back to the speak slot for speakStream when underlying is streaming-capable", async () => {
    const speakStream = vi.fn(() => makeAudioStream());
    const underlying = makeProvider({
      id: "stream:1",
      abilities: { speak: true, speakStream: true },
      speak: async () => ({ audio: new Uint8Array(), mediaType: "audio/mpeg" }),
      speakStream,
    });
    const c = createCompositeVoiceProvider({ speak: underlying });
    expect(c.abilities.speakStream).toBe(true);
    expect(canSpeakStream(c)).toBe(true);
    const chunks: SpeakChunk[] = [];
    for await (const chunk of c.speakStream!({ text: "x" })) {
      chunks.push(chunk);
    }
    expect(speakStream).toHaveBeenCalled();
    expect(chunks).toHaveLength(2);
    expect(chunks[1].isLast).toBe(true);
  });

  it("does not enable speakStream when the speak slot lacks streaming", () => {
    const underlying = makeProvider({
      abilities: { speak: true, speakStream: false },
      speak: async () => ({ audio: new Uint8Array(), mediaType: "audio/mpeg" }),
    });
    const c = createCompositeVoiceProvider({ speak: underlying });
    expect(c.abilities.speakStream).toBe(false);
    expect(c.speakStream).toBeUndefined();
  });

  it("delegates each ability to its slot provider in a mixed config", async () => {
    const a = makeProvider({
      id: "openai:1",
      providerName: "openai",
      abilities: { speak: true, speakStream: false },
      speak: async () => ({ audio: new Uint8Array([1]), mediaType: "audio/mpeg" }),
    });
    const b = makeProvider({
      id: "elevenlabs:1",
      providerName: "elevenlabs",
      abilities: { transcribe: true, listVoices: true },
      transcribe: async (): Promise<TranscribeResult> => ({ text: "hello" }),
      listVoices: async (): Promise<VoiceInfo[]> => [{ id: "v1", name: "V1", provider: "elevenlabs" }],
    });
    const c = createCompositeVoiceProvider({
      speak: a,
      transcribe: b,
      listVoices: b,
    });
    expect(c.abilities).toEqual({
      speak: true,
      speakStream: false,
      transcribe: true,
      listVoices: true,
    });
    const transcribed = await c.transcribe!({ audio: new Uint8Array() });
    expect(transcribed.text).toBe("hello");
    const voices = await c.listVoices!();
    expect(voices[0].provider).toBe("elevenlabs");
    const spoken = await c.speak!({ text: "hi" });
    expect(spoken.audio[0]).toBe(1);
  });

  it("id is deterministic across builds with the same slot ids", () => {
    const p = makeProvider({ id: "openai:1", abilities: { speak: true }, speak: async () => ({ audio: new Uint8Array(), mediaType: "x" }) });
    const a = createCompositeVoiceProvider({ speak: p });
    const b = createCompositeVoiceProvider({ speak: p });
    expect(a.id).toBe(b.id);
  });

  it("empty-config method bad-cast throws VoiceError", () => {
    const c = createCompositeVoiceProvider({}) as VoiceProvider & {
      speak: () => Promise<SpeakResult>;
    };
    expect(() => c.speak({ text: "x" } as any)).toThrow(VoiceError);
    try {
      c.speak({ text: "x" } as any);
    } catch (err) {
      expect(err).toBeInstanceOf(VoiceError);
      expect((err as VoiceError).kind).toBe("invalid_input");
      expect((err as VoiceError).provider).toBe("composite");
    }
  });
});

// ---------------------------------------------------------------------------
// VoiceError
// ---------------------------------------------------------------------------

describe("VoiceError", () => {
  const retryableByKind: Record<VoiceErrorKind, boolean> = {
    auth: false,
    rate_limit: true,
    not_found: false,
    invalid_input: false,
    format_unsupported: false,
    provider_unavailable: true,
    network: true,
    aborted: false,
    unknown: false,
  };

  for (const [kind, expected] of Object.entries(retryableByKind) as Array<
    [VoiceErrorKind, boolean]
  >) {
    it(`defaults retryable=${expected} for kind="${kind}"`, () => {
      const err = new VoiceError({ kind, provider: "openai", message: "x" });
      expect(err.retryable).toBe(expected);
      expect(err.kind).toBe(kind);
      expect(err.provider).toBe("openai");
    });
  }

  it("explicit retryable overrides the default", () => {
    const err = new VoiceError({
      kind: "rate_limit",
      provider: "openai",
      message: "x",
      retryable: false,
    });
    expect(err.retryable).toBe(false);
  });

  it("preserves cause via Error.cause", () => {
    const cause = new Error("inner");
    const err = new VoiceError({
      kind: "network",
      provider: "openai",
      message: "outer",
      cause,
    });
    expect(err.cause).toBe(cause);
  });

  it("is instanceof VoiceError and Error, name is 'VoiceError'", () => {
    const err = new VoiceError({ kind: "unknown", provider: "openai", message: "x" });
    expect(err).toBeInstanceOf(VoiceError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("VoiceError");
  });

  it("preserves status when set", () => {
    const err = new VoiceError({
      kind: "rate_limit",
      provider: "openai",
      message: "x",
      status: 429,
    });
    expect(err.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// SpeakChunk discriminator
// ---------------------------------------------------------------------------

describe("SpeakChunk", () => {
  it("narrows fields via the kind discriminator", () => {
    const chunk: SpeakChunk = {
      kind: "audio",
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: "audio/mpeg",
      isLast: true,
    };
    if (chunk.kind === "audio") {
      // After narrowing, bytes/mediaType are reachable without `as`.
      expect(chunk.bytes.length).toBe(3);
      expect(chunk.mediaType).toBe("audio/mpeg");
      expect(chunk.isLast).toBe(true);
    }
  });
});

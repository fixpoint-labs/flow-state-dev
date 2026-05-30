import { describe, it, expect, vi, beforeEach } from "vitest";
import { VoiceError } from "@flow-state-dev/core";

const stubs = {
  speechCreate: vi.fn(),
  transcriptionCreate: vi.fn(),
};

vi.mock("openai", async () => {
  // Preserve the real error classes — translate-error.ts uses `instanceof`
  // against them, and tests want to verify the discrimination works against
  // genuine SDK error types.
  const real = await vi.importActual<typeof import("openai")>("openai");
  class OpenAI {
    audio = {
      speech: { create: stubs.speechCreate },
      transcriptions: { create: stubs.transcriptionCreate },
    };
    constructor(_opts?: unknown) {}
    static APIError = real.default.APIError;
    static APIConnectionError = real.default.APIConnectionError;
    static APIConnectionTimeoutError = real.default.APIConnectionTimeoutError;
    static APIUserAbortError = real.default.APIUserAbortError;
    static AuthenticationError = real.default.AuthenticationError;
    static PermissionDeniedError = real.default.PermissionDeniedError;
    static RateLimitError = real.default.RateLimitError;
    static NotFoundError = real.default.NotFoundError;
    static BadRequestError = real.default.BadRequestError;
    static UnprocessableEntityError = real.default.UnprocessableEntityError;
    static InternalServerError = real.default.InternalServerError;
  }
  return {
    ...real,
    default: OpenAI,
    toFile: real.toFile,
  };
});

import { OpenAIVoiceProvider } from "../src/openai-voice-provider";
import { OPENAI_VOICE_CATALOG } from "../src/voice-catalog";
import { mapOutputFormat, mediaTypeForFormat } from "../src/output-format";

beforeEach(() => {
  stubs.speechCreate.mockReset();
  stubs.transcriptionCreate.mockReset();
});

function audioResponse(bytes: number[]): Response {
  return new Response(new Uint8Array(bytes));
}

describe("OpenAIVoiceProvider — abilities and identity", () => {
  it("declares the expected abilities matrix", () => {
    const p = new OpenAIVoiceProvider({ apiKey: "test" });
    expect(p.providerName).toBe("openai");
    expect(p.abilities).toEqual({
      speak: true,
      speakStream: false,
      transcribe: true,
      listVoices: true,
    });
  });

  it("uses gpt-4o-mini-tts / gpt-4o-mini-transcribe as defaultModels", () => {
    const p = new OpenAIVoiceProvider({ apiKey: "test" });
    expect(p.defaultModels).toEqual({
      speak: "gpt-4o-mini-tts",
      transcribe: "gpt-4o-mini-transcribe",
    });
  });

  it("reflects constructor overrides in defaultModels", () => {
    const p = new OpenAIVoiceProvider({
      apiKey: "test",
      ttsModel: "tts-1-hd",
      sttModel: "whisper-1",
    });
    expect(p.defaultModels).toEqual({ speak: "tts-1-hd", transcribe: "whisper-1" });
  });

  it("derives a deterministic id across two identical constructions", () => {
    const a = new OpenAIVoiceProvider({ apiKey: "key", ttsModel: "tts-1" });
    const b = new OpenAIVoiceProvider({ apiKey: "key", ttsModel: "tts-1" });
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^openai:[0-9a-f]{12}$/);
  });

  it("never includes the apiKey in the derived id", () => {
    const a = new OpenAIVoiceProvider({ apiKey: "secret-1" });
    const b = new OpenAIVoiceProvider({ apiKey: "secret-2" });
    expect(a.id).toBe(b.id);
  });

  it("id differs when ttsModel differs", () => {
    const a = new OpenAIVoiceProvider({ ttsModel: "gpt-4o-mini-tts" });
    const b = new OpenAIVoiceProvider({ ttsModel: "tts-1" });
    expect(a.id).not.toBe(b.id);
  });
});

describe("OpenAIVoiceProvider.speak", () => {
  it("forwards default options to the SDK and returns audio/mpeg", async () => {
    stubs.speechCreate.mockResolvedValueOnce(audioResponse([1, 2, 3]));
    const p = new OpenAIVoiceProvider({ apiKey: "test" });
    const result = await p.speak({ text: "hello" });

    expect(result.audio).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.mediaType).toBe("audio/mpeg");
    expect(stubs.speechCreate).toHaveBeenCalledWith(
      {
        input: "hello",
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        response_format: "mp3",
        speed: undefined,
        instructions: undefined,
      },
      { signal: undefined },
    );
  });

  it("forwards voice, model, speed, and signal overrides", async () => {
    stubs.speechCreate.mockResolvedValueOnce(audioResponse([0]));
    const p = new OpenAIVoiceProvider({ apiKey: "test" });
    const ac = new AbortController();
    await p.speak({
      text: "hi",
      voice: "nova",
      model: "tts-1-hd",
      speed: 1.25,
      signal: ac.signal,
    });
    expect(stubs.speechCreate).toHaveBeenCalledWith(
      expect.objectContaining({ voice: "nova", model: "tts-1-hd", speed: 1.25 }),
      { signal: ac.signal },
    );
  });

  it("maps outputFormat wav → response_format wav, mediaType audio/wav", async () => {
    stubs.speechCreate.mockResolvedValueOnce(audioResponse([9]));
    const p = new OpenAIVoiceProvider({ apiKey: "test" });
    const result = await p.speak({ text: "x", outputFormat: "wav" });
    expect(stubs.speechCreate).toHaveBeenCalledWith(
      expect.objectContaining({ response_format: "wav" }),
      expect.anything(),
    );
    expect(result.mediaType).toBe("audio/wav");
  });

  it("throws format_unsupported synchronously for an unknown outputFormat and never calls the SDK", async () => {
    const p = new OpenAIVoiceProvider({ apiKey: "test" });
    await expect(p.speak({ text: "x", outputFormat: "ogg" })).rejects.toMatchObject({
      name: "VoiceError",
      kind: "format_unsupported",
    });
    expect(stubs.speechCreate).not.toHaveBeenCalled();
  });

  it.each(["tts-1", "tts-1-hd"])(
    "rejects instructions on legacy model %s with invalid_input",
    async (model) => {
      const p = new OpenAIVoiceProvider({ apiKey: "test" });
      await expect(
        p.speak({
          text: "x",
          model,
          providerOptions: { openai: { instructions: "be cheerful" } },
        }),
      ).rejects.toMatchObject({ kind: "invalid_input" });
      expect(stubs.speechCreate).not.toHaveBeenCalled();
    },
  );

  it("forwards instructions on non-mini TTS models OpenAI accepts (e.g. gpt-4o-tts)", async () => {
    stubs.speechCreate.mockResolvedValueOnce(audioResponse([1]));
    const p = new OpenAIVoiceProvider({ apiKey: "test" });
    await p.speak({
      text: "x",
      model: "gpt-4o-tts",
      providerOptions: { openai: { instructions: "be cheerful" } },
    });
    expect(stubs.speechCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o-tts", instructions: "be cheerful" }),
      expect.anything(),
    );
  });

  it("forwards instructions when the model is gpt-4o-mini-tts", async () => {
    stubs.speechCreate.mockResolvedValueOnce(audioResponse([1]));
    const p = new OpenAIVoiceProvider({ apiKey: "test" });
    await p.speak({
      text: "x",
      providerOptions: { openai: { instructions: "be cheerful" } },
    });
    expect(stubs.speechCreate).toHaveBeenCalledWith(
      expect.objectContaining({ instructions: "be cheerful" }),
      expect.anything(),
    );
  });

  it("translates SDK errors into VoiceError", async () => {
    const real = await vi.importActual<typeof import("openai")>("openai");
    stubs.speechCreate.mockRejectedValueOnce(
      new real.default.RateLimitError(429 as never, {} as never, "slow", new Headers()),
    );
    const p = new OpenAIVoiceProvider({ apiKey: "test" });
    await expect(p.speak({ text: "x" })).rejects.toMatchObject({
      name: "VoiceError",
      kind: "rate_limit",
      retryable: true,
    });
  });
});

describe("OpenAIVoiceProvider.transcribe", () => {
  it("forwards default options to the SDK", async () => {
    stubs.transcriptionCreate.mockResolvedValueOnce({ text: "hello world" });
    const p = new OpenAIVoiceProvider({ apiKey: "test" });
    const blob = new Blob([new Uint8Array([0])], { type: "audio/mpeg" });
    const result = await p.transcribe({ audio: blob });
    expect(result).toEqual({ text: "hello world", language: undefined });
    expect(stubs.transcriptionCreate).toHaveBeenCalledWith(
      {
        file: blob,
        model: "gpt-4o-mini-transcribe",
        language: undefined,
        response_format: "json",
      },
      { signal: undefined },
    );
  });

  it("preserves the caller's language hint in the result", async () => {
    stubs.transcriptionCreate.mockResolvedValueOnce({ text: "hola" });
    const p = new OpenAIVoiceProvider({ apiKey: "test" });
    const blob = new Blob([new Uint8Array([0])], { type: "audio/mpeg" });
    const result = await p.transcribe({ audio: blob, language: "es" });
    expect(result.language).toBe("es");
    expect(stubs.transcriptionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ language: "es" }),
      expect.anything(),
    );
  });

  it("handles the legacy string response (non-json overload)", async () => {
    stubs.transcriptionCreate.mockResolvedValueOnce("plain text result");
    const p = new OpenAIVoiceProvider({ apiKey: "test" });
    const blob = new Blob([new Uint8Array([0])], { type: "audio/mpeg" });
    const result = await p.transcribe({ audio: blob });
    expect(result.text).toBe("plain text result");
  });

  it("wraps Uint8Array audio via toFile when mediaType is provided", async () => {
    stubs.transcriptionCreate.mockResolvedValueOnce({ text: "ok" });
    const p = new OpenAIVoiceProvider({ apiKey: "test" });
    const bytes = new Uint8Array([0x01, 0x02, 0x03]);
    await p.transcribe({ audio: bytes, mediaType: "audio/mpeg" });
    const call = stubs.transcriptionCreate.mock.calls[0]?.[0] as { file: File };
    expect(call.file).toBeInstanceOf(File);
    expect(call.file.name).toBe("audio.mp3");
    expect(call.file.type).toBe("audio/mpeg");
  });

  it("throws invalid_input synchronously for Uint8Array audio without mediaType", async () => {
    const p = new OpenAIVoiceProvider({ apiKey: "test" });
    await expect(
      p.transcribe({ audio: new Uint8Array([0]) }),
    ).rejects.toMatchObject({ name: "VoiceError", kind: "invalid_input" });
    expect(stubs.transcriptionCreate).not.toHaveBeenCalled();
  });

  it("forwards the abort signal", async () => {
    stubs.transcriptionCreate.mockResolvedValueOnce({ text: "" });
    const p = new OpenAIVoiceProvider({ apiKey: "test" });
    const ac = new AbortController();
    const blob = new Blob([new Uint8Array([0])], { type: "audio/mpeg" });
    await p.transcribe({ audio: blob, signal: ac.signal });
    expect(stubs.transcriptionCreate).toHaveBeenCalledWith(
      expect.anything(),
      { signal: ac.signal },
    );
  });

  it("translates SDK errors", async () => {
    const real = await vi.importActual<typeof import("openai")>("openai");
    stubs.transcriptionCreate.mockRejectedValueOnce(
      new real.default.AuthenticationError(401 as never, {} as never, "no key", new Headers()),
    );
    const p = new OpenAIVoiceProvider({ apiKey: "test" });
    const blob = new Blob([new Uint8Array([0])], { type: "audio/mpeg" });
    await expect(p.transcribe({ audio: blob })).rejects.toMatchObject({
      name: "VoiceError",
      kind: "auth",
      retryable: false,
    });
  });
});

describe("OpenAIVoiceProvider.listVoices", () => {
  it("returns all 13 catalog entries", async () => {
    const p = new OpenAIVoiceProvider({ apiKey: "test" });
    const voices = await p.listVoices();
    expect(voices).toHaveLength(13);
    expect(voices.map((v) => v.id)).toEqual([
      "alloy", "ash", "ballad", "coral", "echo", "fable",
      "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar",
    ]);
  });

  it("every entry declares provider: 'openai' with non-empty id and name", async () => {
    const p = new OpenAIVoiceProvider({ apiKey: "test" });
    const voices = await p.listVoices();
    for (const v of voices) {
      expect(v.provider).toBe("openai");
      expect(v.id.length).toBeGreaterThan(0);
      expect(v.name.length).toBeGreaterThan(0);
    }
  });

  it("gates marin and cedar to gpt-4o-mini-tts via supportedModels", () => {
    const marin = OPENAI_VOICE_CATALOG.find((v) => v.id === "marin");
    const cedar = OPENAI_VOICE_CATALOG.find((v) => v.id === "cedar");
    expect(marin?.supportedModels).toEqual(["gpt-4o-mini-tts"]);
    expect(cedar?.supportedModels).toEqual(["gpt-4o-mini-tts"]);
  });

  it("returns a deep-cloned catalog so callers can't mutate the module-global table", async () => {
    const p = new OpenAIVoiceProvider({ apiKey: "test" });
    const first = await p.listVoices();
    const marinFirst = first.find((v) => v.id === "marin")!;
    marinFirst.name = "MUTATED";
    marinFirst.supportedModels!.push("evil");

    const second = await p.listVoices();
    const marinSecond = second.find((v) => v.id === "marin")!;
    expect(marinSecond.name).toBe("Marin");
    expect(marinSecond.supportedModels).toEqual(["gpt-4o-mini-tts"]);
  });

  it("leaves supportedModels undefined for the unconstrained voices", () => {
    const unconstrained = OPENAI_VOICE_CATALOG.filter(
      (v) => v.id !== "marin" && v.id !== "cedar",
    );
    expect(unconstrained).toHaveLength(11);
    for (const v of unconstrained) {
      expect(v.supportedModels).toBeUndefined();
    }
  });
});

describe("output-format helpers", () => {
  it("each allowed format maps to its documented MIME", () => {
    const expected: Record<string, string> = {
      mp3: "audio/mpeg",
      opus: "audio/ogg; codecs=opus",
      aac: "audio/aac",
      flac: "audio/flac",
      wav: "audio/wav",
      pcm: "audio/pcm;rate=24000",
    };
    for (const [format, mime] of Object.entries(expected)) {
      expect(mediaTypeForFormat(mapOutputFormat(format))).toBe(mime);
    }
  });

  it("undefined → mp3 → audio/mpeg", () => {
    expect(mapOutputFormat(undefined)).toBe("mp3");
    expect(mediaTypeForFormat("mp3")).toBe("audio/mpeg");
  });

  it("unknown format throws format_unsupported", () => {
    expect(() => mapOutputFormat("ogg")).toThrow(VoiceError);
    try {
      mapOutputFormat("ogg");
    } catch (e) {
      expect((e as VoiceError).kind).toBe("format_unsupported");
    }
  });
});

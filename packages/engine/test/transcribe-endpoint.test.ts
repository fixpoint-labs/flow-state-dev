/**
 * Tests for the transcribe endpoint (FIX-528): model-resolution precedence,
 * provider/ability 501 ladder, and the exhaustive VoiceError → HTTP mapping.
 */
import { describe, it, expect, vi } from "vitest";
import { VoiceError, type VoiceErrorKind, type VoiceProvider } from "@flow-state-dev/core/types";
import { handleTranscribe, voiceErrorToHttpStatus } from "../src/routes/stream-routes";
import type { FlowRegistry } from "../src/registry/flow-registry";
import type { StoreRegistry } from "../src/stores/types";

const route = { kind: "transcribe" } as any;
const ctxBase = {
  registry: {} as FlowRegistry,
  stores: {} as StoreRegistry
};

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/flows/transcribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

const AUDIO_B64 = Buffer.from([1, 2, 3, 4]).toString("base64");

function transcribeProvider(
  overrides: Partial<VoiceProvider> & {
    transcribeImpl?: VoiceProvider["transcribe"];
  } = {}
): VoiceProvider {
  const { transcribeImpl, ...rest } = overrides;
  return {
    id: "mock:tx",
    providerName: "mock",
    abilities: { speak: false, speakStream: false, transcribe: true, listVoices: false },
    transcribe: transcribeImpl ?? vi.fn(async () => ({ text: "hello", language: "en" })),
    ...rest
  };
}

describe("transcribe endpoint — model resolution", () => {
  it("uses the provider default when the request omits a model", async () => {
    const transcribe = vi.fn(async () => ({ text: "hi", language: "en" }));
    const provider = transcribeProvider({
      defaultModels: { transcribe: "whisper-default" },
      transcribeImpl: transcribe
    });
    const res = await handleTranscribe(
      jsonRequest({ userId: "u1", audio: AUDIO_B64 }),
      route,
      { ...ctxBase, voiceProvider: provider }
    );
    expect(res.status).toBe(200);
    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ model: "whisper-default" })
    );
  });

  it("prefers the per-request model over the provider default", async () => {
    const transcribe = vi.fn(async () => ({ text: "hi" }));
    const provider = transcribeProvider({
      defaultModels: { transcribe: "whisper-default" },
      transcribeImpl: transcribe
    });
    const res = await handleTranscribe(
      jsonRequest({ userId: "u1", audio: AUDIO_B64, model: "whisper-large" }),
      route,
      { ...ctxBase, voiceProvider: provider }
    );
    expect(res.status).toBe(200);
    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ model: "whisper-large" })
    );
  });

  it("returns 400 no_model when neither request nor provider supplies one", async () => {
    const provider = transcribeProvider();
    const res = await handleTranscribe(
      jsonRequest({ userId: "u1", audio: AUDIO_B64 }),
      route,
      { ...ctxBase, voiceProvider: provider }
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("no_model");
  });

  it("returns 400 no_model when defaultModels is absent entirely", async () => {
    const provider = transcribeProvider({ defaultModels: undefined });
    const res = await handleTranscribe(
      jsonRequest({ userId: "u1", audio: AUDIO_B64 }),
      route,
      { ...ctxBase, voiceProvider: provider }
    );
    expect(res.status).toBe(400);
  });

  it("treats an empty-string default model as falsy → 400", async () => {
    const provider = transcribeProvider({ defaultModels: { transcribe: "" } });
    const res = await handleTranscribe(
      jsonRequest({ userId: "u1", audio: AUDIO_B64 }),
      route,
      { ...ctxBase, voiceProvider: provider }
    );
    expect(res.status).toBe(400);
  });
});

describe("transcribe endpoint — provider/ability ladder", () => {
  it("returns 501 transcription_not_configured with no provider", async () => {
    const res = await handleTranscribe(
      jsonRequest({ userId: "u1", audio: AUDIO_B64 }),
      route,
      { ...ctxBase, voiceProvider: undefined }
    );
    expect(res.status).toBe(501);
    expect((await res.json()).error).toBe("transcription_not_configured");
  });

  it("returns 501 when the provider cannot transcribe", async () => {
    const provider = transcribeProvider({
      abilities: { speak: true, speakStream: false, transcribe: false, listVoices: false }
    });
    const res = await handleTranscribe(
      jsonRequest({ userId: "u1", audio: AUDIO_B64 }),
      route,
      { ...ctxBase, voiceProvider: provider }
    );
    expect(res.status).toBe(501);
    expect((await res.json()).error).toBe("provider_does_not_support_transcription");
  });

  it("returns 200 with the transcription result", async () => {
    const provider = transcribeProvider({
      defaultModels: { transcribe: "m" },
      transcribeImpl: vi.fn(async () => ({ text: "transcribed", language: "es" }))
    });
    const res = await handleTranscribe(
      jsonRequest({ userId: "u1", audio: AUDIO_B64 }),
      route,
      { ...ctxBase, voiceProvider: provider }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "transcribed", language: "es" });
  });
});

describe("transcribe endpoint — VoiceError → HTTP status", () => {
  const expected: Record<VoiceErrorKind, number> = {
    auth: 401,
    rate_limit: 429,
    not_found: 404,
    invalid_input: 400,
    format_unsupported: 415,
    provider_unavailable: 503,
    network: 502,
    aborted: 499,
    unknown: 500
  };

  it.each(Object.entries(expected))(
    "maps kind=%s to status %i",
    (kind, status) => {
      expect(voiceErrorToHttpStatus(kind as VoiceErrorKind)).toBe(status);
    }
  );

  it.each(Object.entries(expected))(
    "translates a thrown VoiceError(%s) to %i",
    async (kind, status) => {
      const provider = transcribeProvider({
        defaultModels: { transcribe: "m" },
        transcribeImpl: vi.fn(async () => {
          throw new VoiceError({
            kind: kind as VoiceErrorKind,
            provider: "mock",
            message: `boom ${kind}`
          });
        })
      });
      const res = await handleTranscribe(
        jsonRequest({ userId: "u1", audio: AUDIO_B64 }),
        route,
        { ...ctxBase, voiceProvider: provider }
      );
      expect(res.status).toBe(status);
      const body = await res.json();
      expect(body.error).toBe(kind);
    }
  );
});

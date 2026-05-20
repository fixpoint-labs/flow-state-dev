/**
 * `OpenAIVoiceProvider`: implements the `VoiceProvider` contract against the
 * official `openai` SDK. Exposes batch `speak`, batch `transcribe`, and a
 * static `listVoices` catalog. `speakStream` is intentionally absent —
 * `abilities.speakStream === false`.
 */

import { createHash } from "node:crypto";
import OpenAI, { toFile } from "openai";
import { VoiceError } from "@flow-state-dev/core";
import type {
  SpeakOptions,
  SpeakResult,
  TranscribeOptions,
  TranscribeResult,
  VoiceAbilities,
  VoiceInfo,
  VoiceProvider,
} from "@flow-state-dev/core";

import { mapOutputFormat, mediaTypeForFormat } from "./output-format";
import { translateError } from "./translate-error";
import { OPENAI_VOICE_CATALOG } from "./voice-catalog";

/** Constructor options for {@link OpenAIVoiceProvider}. */
export interface OpenAIVoiceProviderOptions {
  /**
   * OpenAI API key. Omit to fall back to the SDK's default behaviour, which
   * reads `OPENAI_API_KEY` from the environment.
   */
  apiKey?: string;
  /** Override the API base URL (Azure-OpenAI compatible endpoints, proxies). */
  baseURL?: string;
  /** OpenAI organization id, forwarded to the SDK. */
  organization?: string;
  /** OpenAI project id, forwarded to the SDK. */
  project?: string;
  /** Default TTS model for `speak()`. Defaults to `"gpt-4o-mini-tts"`. */
  ttsModel?: string;
  /** Default STT model for `transcribe()`. Defaults to `"gpt-4o-mini-transcribe"`. */
  sttModel?: string;
  /** Default voice for `speak()`. Defaults to `"alloy"`. */
  voice?: string;
  /**
   * Escape hatch: supply a pre-configured `OpenAI` client. When set, all
   * other client-configuration options (`apiKey`, `baseURL`, `organization`,
   * `project`) are ignored — the caller owns the client.
   */
  client?: OpenAI;
}

/**
 * OpenAI-backed `VoiceProvider`. Single-instance, reusable across requests;
 * the underlying SDK client is shared, so HTTP-keep-alive and per-instance
 * options (org, project) are honoured for the instance's lifetime.
 */
export class OpenAIVoiceProvider implements VoiceProvider {
  readonly providerName = "openai";
  readonly id: string;
  readonly abilities: VoiceAbilities = {
    speak: true,
    speakStream: false,
    transcribe: true,
    listVoices: true,
  };
  readonly defaultModels: { speak: string; transcribe: string };

  private readonly client: OpenAI;
  private readonly defaultVoice: string;

  constructor(opts: OpenAIVoiceProviderOptions = {}) {
    const ttsModel = opts.ttsModel ?? "gpt-4o-mini-tts";
    const sttModel = opts.sttModel ?? "gpt-4o-mini-transcribe";
    this.defaultModels = { speak: ttsModel, transcribe: sttModel };
    this.defaultVoice = opts.voice ?? "alloy";
    this.client =
      opts.client ??
      new OpenAI({
        apiKey: opts.apiKey,
        baseURL: opts.baseURL,
        organization: opts.organization,
        project: opts.project,
      });
    // Read identity fields from the resolved client so a caller-supplied
    // `opts.client` contributes its own baseURL/org/project to the id
    // instead of degenerating to all-`undefined`. Never include `apiKey`.
    this.id = deriveId({
      ttsModel,
      sttModel,
      voice: this.defaultVoice,
      baseURL: this.client.baseURL,
      organization: this.client.organization ?? undefined,
      project: this.client.project ?? undefined,
    });
  }

  async speak(o: SpeakOptions): Promise<SpeakResult> {
    const model = o.model ?? this.defaultModels.speak;
    const voice = o.voice ?? this.defaultVoice;
    const responseFormat = mapOutputFormat(o.outputFormat);

    // `instructions` is rejected by OpenAI on the legacy `tts-1` / `tts-1-hd`
    // models. Pre-validate at the boundary so callers get a typed error
    // rather than a 400 round-trip.
    const providerOpts = o.providerOptions?.openai as
      | { instructions?: string }
      | undefined;
    const instructions = providerOpts?.instructions;
    if (instructions !== undefined && !model.startsWith("gpt-4o-mini-tts")) {
      throw new VoiceError({
        kind: "invalid_input",
        provider: "openai",
        message: `instructions is only supported on gpt-4o-mini-tts* models; got model="${model}"`,
      });
    }

    try {
      const response = await this.client.audio.speech.create(
        {
          input: o.text,
          model,
          // The SDK's `voice` union is narrower than OpenAI's actual catalog
          // (it lags new voices and never accepts custom voice ids). The
          // catalog truth lives in `voice-catalog.ts`.
          voice: voice as never,
          response_format: responseFormat,
          speed: o.speed,
          instructions,
        },
        { signal: o.signal },
      );
      const audio = new Uint8Array(await response.arrayBuffer());
      return { audio, mediaType: mediaTypeForFormat(responseFormat) };
    } catch (err) {
      throw translateError(err);
    }
  }

  async transcribe(o: TranscribeOptions): Promise<TranscribeResult> {
    const model = o.model ?? this.defaultModels.transcribe;
    const file = await coerceUploadable(o.audio, o.mediaType);

    try {
      const result = await this.client.audio.transcriptions.create(
        {
          file,
          model,
          language: o.language,
          response_format: "json",
        },
        { signal: o.signal },
      );
      // `json` always returns an object; the string overload only fires for
      // `text` / `srt` / `vtt`. Handle both so the type assertion stays honest.
      const text = typeof result === "string" ? result : result.text;
      // OpenAI's `json` response doesn't echo a language field. Preserve the
      // caller's hint so the result shape stays useful for downstream code.
      return { text, language: o.language };
    } catch (err) {
      throw translateError(err);
    }
  }

  async listVoices(): Promise<VoiceInfo[]> {
    // Deep-copy entries: `supportedModels` is a mutable array on each entry,
    // so a shallow spread would let callers mutate the module-global catalog.
    return OPENAI_VOICE_CATALOG.map((v) => ({
      ...v,
      ...(v.supportedModels !== undefined
        ? { supportedModels: [...v.supportedModels] }
        : {}),
    }));
  }
}

/**
 * Builds a stable, opaque `id` from the instance's defining configuration.
 * Identical options produce identical ids across processes (useful for
 * registry deduplication and structured logging). The API key is NEVER
 * included so the id is safe to log.
 */
function deriveId(fields: {
  ttsModel: string;
  sttModel: string;
  voice: string;
  baseURL?: string;
  organization?: string;
  project?: string;
}): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(fields))
    .digest("hex")
    .slice(0, 12);
  return `openai:${hash}`;
}

/**
 * Normalizes `TranscribeOptions.audio` into something the SDK accepts as
 * its `file` parameter. `Blob` passes through; `Uint8Array` is wrapped via
 * `toFile()` with a filename whose extension matches `mediaType` so OpenAI
 * can infer the audio format. `Uint8Array` without `mediaType` throws.
 */
async function coerceUploadable(
  audio: Uint8Array | Blob,
  mediaType: string | undefined,
): Promise<Awaited<ReturnType<typeof toFile>> | Blob> {
  if (audio instanceof Blob) return audio;

  if (mediaType === undefined) {
    throw new VoiceError({
      kind: "invalid_input",
      provider: "openai",
      message:
        "transcribe(audio: Uint8Array) requires mediaType — pass mediaType: 'audio/mpeg' (etc.) so OpenAI can infer the format.",
    });
  }

  return toFile(audio, filenameForMediaType(mediaType), { type: mediaType });
}

/**
 * Maps common audio MIME types to a filename with the matching extension.
 * Unrecognized subtypes fall back to using the subtype itself as the
 * extension (e.g. `audio/mp4` → `audio.mp4`), which is OpenAI's preferred
 * inference signal.
 */
function filenameForMediaType(mediaType: string): string {
  const known: Record<string, string> = {
    "audio/mpeg": "audio.mp3",
    "audio/mp3": "audio.mp3",
    "audio/wav": "audio.wav",
    "audio/x-wav": "audio.wav",
    "audio/webm": "audio.webm",
    "audio/ogg": "audio.ogg",
    "audio/flac": "audio.flac",
    "audio/m4a": "audio.m4a",
    "audio/mp4": "audio.mp4",
  };
  const normalized = mediaType.split(";")[0].trim().toLowerCase();
  if (normalized in known) return known[normalized];

  const slash = normalized.indexOf("/");
  if (slash !== -1) {
    const subtype = normalized.slice(slash + 1).replace(/^x-/, "");
    if (subtype.length > 0) return `audio.${subtype}`;
  }
  return "audio.bin";
}

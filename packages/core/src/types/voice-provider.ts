/**
 * The `VoiceProvider` contract. A single ability-flagged object that owns one
 * or more voice surfaces (speak, speakStream, transcribe, listVoices). Replaces
 * the previous two-resolver-factory pattern (`SpeechResolver` /
 * `TranscriptionResolver`). See the FIX-522 design spec for the full rationale.
 *
 * Per-ability narrowing interfaces (`SpeakCapable` etc.) and runtime type
 * guards (`canSpeak` etc.) let callers branch on what a provider supports.
 * The field on `VoiceProvider` is `abilities` (not `capabilities`) to avoid
 * collision with the framework's first-class `Capability` concept.
 */

import { VoiceError } from "./voice-error";

// ---------------------------------------------------------------------------
// Ability flags
// ---------------------------------------------------------------------------

/**
 * Per-ability flags declared by a provider. A `true` flag guarantees the
 * corresponding method is present and callable; a `false` flag means the
 * method is absent (and the narrowing type guards will return `false`).
 */
export interface VoiceAbilities {
  readonly speak: boolean;
  readonly speakStream: boolean;
  readonly transcribe: boolean;
  readonly listVoices: boolean;
}

// ---------------------------------------------------------------------------
// Options & results
// ---------------------------------------------------------------------------

/** Arguments to {@link VoiceProvider.speak} and {@link VoiceProvider.speakStream}. */
export interface SpeakOptions {
  /** Text to synthesize. */
  text: string;
  /** Provider-specific voice id. If omitted, the provider's default voice is used. */
  voice?: string;
  /** Override the provider's default speak model. */
  model?: string;
  /** Speech speed multiplier (1.0 = normal). Provider may clamp. */
  speed?: number;
  /** Requested audio container/codec (e.g. `"mp3"`, `"wav"`, `"pcm16"`). */
  outputFormat?: string;
  /** Abort signal forwarded to the underlying transport. */
  signal?: AbortSignal;
  /** Escape hatch for provider-specific options not covered by this interface. */
  providerOptions?: Record<string, unknown>;
}

/** Result of a batch {@link VoiceProvider.speak} call. */
export interface SpeakResult {
  audio: Uint8Array;
  /** MIME media type of `audio` (e.g. `"audio/mpeg"`). */
  mediaType: string;
}

/**
 * A chunk yielded by {@link VoiceProvider.speakStream}. Discriminated by `kind`
 * so future variants (markers, viseme frames, etc.) can be added without
 * breaking existing consumers. M1 ships only the `"audio"` variant.
 */
export type SpeakChunk = {
  kind: "audio";
  bytes: Uint8Array;
  /** MIME media type of `bytes`. Stable across the stream. */
  mediaType: string;
  /** Set on the final chunk so consumers can flush without waiting for `return`. */
  isLast?: boolean;
};

/** Arguments to {@link VoiceProvider.transcribe}. */
export interface TranscribeOptions {
  audio: Uint8Array | Blob;
  /** MIME media type of `audio`. Some providers infer; declaring is safer. */
  mediaType?: string;
  /** BCP-47 language hint (e.g. `"en"`, `"es-MX"`). */
  language?: string;
  /** Override the provider's default transcribe model. */
  model?: string;
  /** Abort signal forwarded to the underlying transport. */
  signal?: AbortSignal;
  /** Escape hatch for provider-specific options not covered by this interface. */
  providerOptions?: Record<string, unknown>;
}

/** Result of a {@link VoiceProvider.transcribe} call. */
export interface TranscribeResult {
  text: string;
  /** BCP-47 language detected (or echoed from `TranscribeOptions.language`). */
  language?: string;
}

/**
 * One entry in the provider's voice catalog. Returned by
 * {@link VoiceProvider.listVoices}.
 */
export interface VoiceInfo {
  /** Provider-specific voice id used as `SpeakOptions.voice`. */
  id: string;
  /** Human-readable label. */
  name: string;
  /** `providerName` of the owning provider. */
  provider: string;
  /** BCP-47 language tag, if the catalog declares one. */
  language?: string;
  /** Accent label, if the catalog declares one (e.g. `"british"`, `"southern"`). */
  accent?: string;
  /** Gender label, if the catalog declares one (e.g. `"female"`, `"male"`, `"neutral"`). */
  gender?: string;
  /** Age label, if the catalog declares one (e.g. `"young"`, `"middle-aged"`). */
  age?: string;
  /** URL to a short audio preview, if the catalog provides one. */
  previewUrl?: string;
  /** Speak models the voice is known to work with, if the catalog declares it. */
  supportedModels?: string[];
  /** Raw provider payload, for callers that want to surface custom fields. */
  raw?: unknown;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

/**
 * The canonical voice contract. All four methods are optional at the type
 * level; presence is governed by `abilities`. Provider authors must keep the
 * two in sync — declaring `abilities.speak: true` without implementing
 * `speak` is a contract violation that the type guards trust (callers will
 * see a native `TypeError` when they invoke a missing method).
 */
export interface VoiceProvider {
  /** Stable identifier for telemetry/registry use. */
  readonly id: string;
  /** Short provider name (e.g. `"openai"`, `"elevenlabs"`, `"composite"`). */
  readonly providerName: string;
  readonly abilities: VoiceAbilities;
  /**
   * Provider-suggested default model ids per ability. Routers/pipelines fall
   * back to these when the caller doesn't specify a model in
   * `SpeakOptions.model` / `TranscribeOptions.model`.
   */
  readonly defaultModels?: {
    speak?: string;
    transcribe?: string;
  };

  speak?(options: SpeakOptions): Promise<SpeakResult>;
  speakStream?(options: SpeakOptions): AsyncIterable<SpeakChunk>;
  transcribe?(options: TranscribeOptions): Promise<TranscribeResult>;
  listVoices?(): Promise<VoiceInfo[]>;
}

// ---------------------------------------------------------------------------
// Per-ability narrowing interfaces
// ---------------------------------------------------------------------------

/** {@link VoiceProvider} narrowed to require `speak`. */
export interface SpeakCapable extends VoiceProvider {
  speak(options: SpeakOptions): Promise<SpeakResult>;
}

/** {@link VoiceProvider} narrowed to require `speakStream`. */
export interface SpeakStreamCapable extends VoiceProvider {
  speakStream(options: SpeakOptions): AsyncIterable<SpeakChunk>;
}

/** {@link VoiceProvider} narrowed to require `transcribe`. */
export interface TranscribeCapable extends VoiceProvider {
  transcribe(options: TranscribeOptions): Promise<TranscribeResult>;
}

/** {@link VoiceProvider} narrowed to require `listVoices`. */
export interface ListVoicesCapable extends VoiceProvider {
  listVoices(): Promise<VoiceInfo[]>;
}

// ---------------------------------------------------------------------------
// Runtime type guards
// ---------------------------------------------------------------------------

/** Narrows to {@link SpeakCapable} when the provider advertises `speak`. */
export function canSpeak(p: VoiceProvider): p is SpeakCapable {
  return p.abilities.speak === true;
}

/** Narrows to {@link SpeakStreamCapable} when the provider advertises `speakStream`. */
export function canSpeakStream(p: VoiceProvider): p is SpeakStreamCapable {
  return p.abilities.speakStream === true;
}

/** Narrows to {@link TranscribeCapable} when the provider advertises `transcribe`. */
export function canTranscribe(p: VoiceProvider): p is TranscribeCapable {
  return p.abilities.transcribe === true;
}

/** Narrows to {@link ListVoicesCapable} when the provider advertises `listVoices`. */
export function canListVoices(p: VoiceProvider): p is ListVoicesCapable {
  return p.abilities.listVoices === true;
}

// ---------------------------------------------------------------------------
// Composite provider
// ---------------------------------------------------------------------------

/** Slot configuration for {@link createCompositeVoiceProvider}. */
export interface CompositeVoiceProviderConfig {
  /** Provider that owns the `speak` ability. */
  speak?: VoiceProvider;
  /** Provider that owns the `transcribe` ability. */
  transcribe?: VoiceProvider;
  /** Provider that owns the `listVoices` ability. */
  listVoices?: VoiceProvider;
  /**
   * Provider that owns the `speakStream` ability. If omitted, the `speak`
   * provider is used when it advertises `speakStream`; otherwise streaming
   * is unavailable.
   */
  speakStream?: VoiceProvider;
}

/**
 * Build a synthetic provider that delegates each ability to a different
 * underlying provider. The returned `abilities` reflect what the underlying
 * providers actually advertise — declaring a slot whose provider doesn't
 * support that ability yields a `false` flag rather than a runtime failure.
 *
 * Composite-only invariants:
 * - `providerName` is `"composite"`.
 * - `id` is `"composite:speak=<id>|stream=<id>|tx=<id>|voices=<id>"`, stable
 *   across processes. Empty slots render as `-`; underlying-provider ids
 *   are percent-escaped on `|` and `=` so the format stays unambiguous.
 * - Methods are present only when the corresponding ability is `true`, so
 *   the narrowing guards (`canSpeak` etc.) work transparently.
 * - With no slots set, every ability is `false`. A method call reached via
 *   a bad cast throws `VoiceError({ kind: "invalid_input" })`.
 */
export function createCompositeVoiceProvider(
  config: CompositeVoiceProviderConfig
): VoiceProvider {
  const speakProvider = config.speak;
  const transcribeProvider = config.transcribe;
  const listVoicesProvider = config.listVoices;
  // If `speakStream` slot is omitted, fall back to the `speak` provider —
  // but only if that provider itself advertises streaming. Slot-presence
  // does not imply ability; the underlying flag rules.
  const speakStreamProvider = config.speakStream ?? speakProvider;

  const abilities: VoiceAbilities = {
    speak: speakProvider?.abilities.speak === true,
    speakStream: speakStreamProvider?.abilities.speakStream === true,
    transcribe: transcribeProvider?.abilities.transcribe === true,
    listVoices: listVoicesProvider?.abilities.listVoices === true,
  };

  // Id reflects the configured slots (not the resolved speakStream fallback)
  // so two composites configured identically share an id, and a composite
  // with an explicit `speakStream: sameProviderAsSpeak` is distinguishable
  // from one that relies on the implicit fallback.
  const id = `composite:${formatSlotIds({
    speak: speakProvider?.id,
    speakStream: config.speakStream?.id,
    transcribe: transcribeProvider?.id,
    listVoices: listVoicesProvider?.id,
  })}`;

  const provider: VoiceProvider = {
    id,
    providerName: "composite",
    abilities,
  };

  if (abilities.speak) {
    provider.speak = (options) => speakProvider!.speak!(options);
  }
  if (abilities.speakStream) {
    provider.speakStream = (options) => speakStreamProvider!.speakStream!(options);
  }
  if (abilities.transcribe) {
    provider.transcribe = (options) => transcribeProvider!.transcribe!(options);
  }
  if (abilities.listVoices) {
    provider.listVoices = () => listVoicesProvider!.listVoices!();
  }

  // No-slot edge case. The spec is in slight tension here: "Methods are not
  // present on the returned object" vs. "Direct call via a bad cast throws
  // VoiceError." We choose the testable behavior — attach throwing stubs so
  // a bad cast surfaces a typed error rather than a native `TypeError`. The
  // `abilities` flags above stay `false`, so the runtime type guards never
  // expose these stubs to well-behaved callers.
  const hasAnySlot =
    speakProvider !== undefined ||
    config.speakStream !== undefined ||
    transcribeProvider !== undefined ||
    listVoicesProvider !== undefined;
  if (!hasAnySlot) {
    const throwUnconfigured = (): never => {
      throw new VoiceError({
        kind: "invalid_input",
        provider: "composite",
        message: "CompositeVoiceProvider has no underlying providers configured",
      });
    };
    provider.speak = throwUnconfigured;
    provider.speakStream = throwUnconfigured;
    provider.transcribe = throwUnconfigured;
    provider.listVoices = throwUnconfigured;
  }

  return provider;
}

/**
 * Formats the slot ids into a readable, deterministic suffix for the
 * composite provider's `id`. Stable across processes; trivially debuggable
 * in logs (unlike a hash). Slot values are percent-escaped on `|` and `=`
 * so provider ids containing the delimiters can't corrupt the format.
 */
function formatSlotIds(slots: {
  speak?: string;
  speakStream?: string;
  transcribe?: string;
  listVoices?: string;
}): string {
  const escape = (s: string | undefined): string =>
    (s ?? "-").replace(/[|=]/g, encodeURIComponent);
  return [
    `speak=${escape(slots.speak)}`,
    `stream=${escape(slots.speakStream)}`,
    `tx=${escape(slots.transcribe)}`,
    `voices=${escape(slots.listVoices)}`,
  ].join("|");
}

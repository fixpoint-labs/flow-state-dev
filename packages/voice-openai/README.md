# @flow-state-dev/voice-openai

OpenAI implementation of the `VoiceProvider` contract: batch text-to-speech, batch transcription, and the OpenAI voice catalog. Use it directly, or compose it with another provider via `createCompositeVoiceProvider`.

`VoiceProvider` is the framework's single-object voice contract: one provider exposes some combination of `speak`, `speakStream`, `transcribe`, and `listVoices`, and declares which ones it supports via an `abilities` flags object. Callers branch on the flags (or the matching `canSpeak` / `canTranscribe` runtime type guards) instead of holding separate resolver objects per surface.

## Installation

```bash
pnpm add @flow-state-dev/voice-openai openai
```

`openai` is a direct dependency of this package, not a peer — it ships with the package so you don't have to pin a compatible version yourself. You only need to install it explicitly if your app calls the SDK directly elsewhere.

## Quick start

```ts
import { OpenAIVoiceProvider } from "@flow-state-dev/voice-openai";

const provider = new OpenAIVoiceProvider({ apiKey: process.env.OPENAI_API_KEY });

const { audio, mediaType } = await provider.speak({ text: "Hello, world." });
// audio: Uint8Array (MP3 by default), mediaType: "audio/mpeg"
```

Pass it to your flow router via the M1 voice config; until the router migration lands you can still consume the provider directly in custom blocks.

## Configuration

```ts
new OpenAIVoiceProvider({
  apiKey:       process.env.OPENAI_API_KEY,
  baseURL:      "https://my-proxy.example.com/v1", // optional
  organization: "org-...",                          // optional
  project:      "proj_...",                         // optional
  ttsModel:     "gpt-4o-mini-tts",                 // default
  sttModel:     "gpt-4o-mini-transcribe",          // default
  voice:        "alloy",                            // default
});
```

| Option | Purpose |
| --- | --- |
| `apiKey` | OpenAI API key. Omit to let the SDK read `OPENAI_API_KEY` from the environment. |
| `baseURL` | Override the API endpoint. The SDK also reads `OPENAI_BASE_URL` from the environment when this is omitted. |
| `organization` | OpenAI organization id, forwarded to the SDK. |
| `project` | OpenAI project id, forwarded to the SDK. |
| `ttsModel` | Default model for `speak()`. Caller-supplied `SpeakOptions.model` overrides per call. |
| `sttModel` | Default model for `transcribe()`. Caller-supplied `TranscribeOptions.model` overrides per call. |
| `voice` | Default voice id for `speak()`. Caller-supplied `SpeakOptions.voice` overrides per call. |
| `client` | Escape hatch: supply a pre-configured `OpenAI` client. When set, the other client-config options (`apiKey`, `baseURL`, `organization`, `project`) are ignored. |

## Abilities

| Ability | Value | Notes |
| --- | --- | --- |
| `speak` | `true` | Batch TTS via `audio.speech.create`. |
| `speakStream` | `false` | Not in scope for M1. OpenAI's SDK does support streaming via `stream_format`; expect a follow-up. For now, compose with another provider for streaming. |
| `transcribe` | `true` | Batch STT via `audio.transcriptions.create`. |
| `listVoices` | `true` | Static catalog; OpenAI does not expose a discovery endpoint. |

## Voice catalog

`listVoices()` returns a 13-entry static list:

```
alloy, ash, ballad, coral, echo, fable, nova, onyx,
sage, shimmer, verse, marin, cedar
```

`marin` and `cedar` are only available on `gpt-4o-mini-tts`. They declare this via `supportedModels: ["gpt-4o-mini-tts"]`. Every other entry omits `supportedModels`, which by convention means "supported by every OpenAI TTS model" — there's no implicit allowlist to forget about.

The catalog is hand-maintained. When OpenAI ships a new voice, update `src/voice-catalog.ts`.

## Output formats

`SpeakOptions.outputFormat` accepts six values; the returned `mediaType` follows OpenAI's encoding directly:

| `outputFormat` | `mediaType` |
| --- | --- |
| `mp3` (default) | `audio/mpeg` |
| `opus` | `audio/ogg; codecs=opus` |
| `aac` | `audio/aac` |
| `flac` | `audio/flac` |
| `wav` | `audio/wav` |
| `pcm` | `audio/pcm;rate=24000` |

PCM output is raw 24 kHz 16-bit little-endian mono. Unsupported values throw `VoiceError({ kind: "format_unsupported" })` synchronously, before any network call.

## Provider-specific options

`SpeakOptions.providerOptions.openai.instructions` is forwarded as OpenAI's `instructions` parameter (style guidance like "speak slowly and warmly"). This field is only valid on `gpt-4o-mini-tts*` models. Passing it with `tts-1` / `tts-1-hd` throws `VoiceError({ kind: "invalid_input" })` at the provider boundary rather than wasting a 400 round-trip.

## Error handling

Every method translates SDK errors into `VoiceError`, a discriminated class with a `kind` field. Branch on `kind` and inspect `retryable` instead of parsing message strings:

```ts
import { VoiceError } from "@flow-state-dev/core";

try {
  await provider.speak({ text: "hello" });
} catch (err) {
  if (err instanceof VoiceError) {
    if (err.kind === "rate_limit" && err.retryable) {
      // back off and retry
    } else if (err.kind === "auth") {
      // surface to the operator
    }
  }
}
```

Full mapping:

| OpenAI SDK error | `VoiceError.kind` | `retryable` |
| --- | --- | --- |
| `APIUserAbortError` | `aborted` | `false` |
| `AuthenticationError` (401) | `auth` | `false` |
| `PermissionDeniedError` (403) | `auth` | `false` |
| `RateLimitError` (429) | `rate_limit` | `true` |
| `NotFoundError` (404) | `not_found` | `false` |
| `BadRequestError` (400) — format signal | `format_unsupported` | `false` |
| `BadRequestError` (400) — otherwise | `invalid_input` | `false` |
| `UnprocessableEntityError` (422) | `invalid_input` (or `format_unsupported`) | `false` |
| `InternalServerError` (≥500) | `provider_unavailable` | `true` |
| `APIConnectionError` / `APIConnectionTimeoutError` | `network` | `true` |
| `APIError` (other) | `unknown` | `false` |
| Anything else | `unknown` | `false` |

The "format signal" heuristic looks at `err.code`, `err.param`, and the message; bad-format 400s become `format_unsupported`, generic bad inputs stay `invalid_input`.

## Composing with another provider

```ts
import { createCompositeVoiceProvider } from "@flow-state-dev/core";
import { OpenAIVoiceProvider } from "@flow-state-dev/voice-openai";
// import { ElevenLabsVoiceProvider } from "@flow-state-dev/voice-elevenlabs";

const openai = new OpenAIVoiceProvider({ apiKey: process.env.OPENAI_API_KEY });

const composite = createCompositeVoiceProvider({
  // speak:      new ElevenLabsVoiceProvider({ ... }),  // streaming-capable provider
  transcribe: openai,
  listVoices: openai,
});
```

Each ability slot can come from a different provider. Slots whose underlying provider doesn't advertise the matching ability show up as `false` in the composite's `abilities` rather than as a runtime failure.

## What's not in M1

- **Streaming TTS.** OpenAI's SDK supports it via `stream_format`, but the framework's pipeline doesn't need it from OpenAI yet, so the surface is left off the provider. ElevenLabs is the canonical streaming provider in M2.
- **Custom-voice helpers.** The SDK accepts custom voice ids; the catalog lists OpenAI's prebuilt voices only. Pass a custom voice via `SpeakOptions.voice` if you need one.
- **Realtime API.** Out of M1 scope.
- **Live-API integration tests.** The unit tests mock the SDK at its boundary. Live-credentials tests live under `packages/integration-tests/` and arrive in a follow-up.

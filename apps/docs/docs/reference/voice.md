---
title: Voice
type: reference
description: "Every setting, provider member, endpoint response and content field for speaking a flow's replies aloud and transcribing a user's speech."
---

# Voice

Voice lets a flow speak its replies and lets a client send speech in as text. A **voice provider** is the object that talks to a speech service: it turns text into audio (text to speech, TTS) and audio into text (transcription). The server holds one provider. A flow can name its own for TTS. The framework cuts a streaming reply into sentences and synthesizes each as it completes, so audio starts before the reply ends and the text is never held back.

The examples use a `narration` flow and the OpenAI provider from `@flow-state-dev/voice-openai`.

```ts title="src/server.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { OpenAIVoiceProvider } from "@flow-state-dev/voice-openai";
import { narration } from "./flows/narration/flow";

export const flowState = createFlowState({
  flows: [narration()],
  voice: { provider: new OpenAIVoiceProvider() },
});
```

```ts title="src/flows/narration/flow.ts"
import { defineFlow } from "@flow-state-dev/core";

export const narration = defineFlow({
  kind: "narration",
  voice: { tts: { voice: "alloy", speed: 1.0 } },
  actions: {
    /* ... */
  },
});
```

## Server settings

| Setting | Type | Meaning |
|---|---|---|
| `createFlowState({ voice: { provider } })` | `VoiceProvider` | The server's provider, for TTS and transcription. |
| `createFlowApiRouter({ registry, voiceProvider })` | `VoiceProvider` | The same provider, on the lower-level router. `createFlowState` passes its `voice.provider` here. |

Both are optional. With no provider, a flow that asks for TTS skips synthesis, with no error, and its text streams as usual. The transcription endpoint returns `501`.

With a provider that has neither `speak` nor `speakStream`, a flow that asks for TTS runs text-only and the server writes a `warn` log line.

## Flow settings

Set on `defineFlow({ voice })`.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `voice.provider` | `VoiceProvider` | the server's provider | Provider for this flow's TTS. It never applies to the transcription endpoint, which always uses the server's. |
| `voice.tts` | object | absent | Turns TTS on for the flow. A flow without it never speaks. |
| `voice.tts.model` | `string` | none; the provider's default | Speech model id, passed to the provider. |
| `voice.tts.voice` | `string` | none; the provider's default | Provider-specific voice id. |
| `voice.tts.speed` | `number` | none; the provider's default | Speed multiplier, 1.0 is normal. A provider may clamp it. |

### When a reply is spoken

A reply is spoken only when:

1. The flow has `voice.tts`.
2. The provider can `speak` or `speakStream`.
3. The request sets `metadata.voice.ttsEnabled` to `true`. TTS is off by default.

`useVoice` sets `ttsEnabled` for you from its `autoPlayTTS` option. A client that calls an action itself passes `metadata: { voice: { ttsEnabled: true } }`. `useVoice` also sends `inputModality: "speech"` in the same object.

`voiceContext`, exported from `@flow-state-dev/engine`, goes in a generator's `context` array. When `ttsEnabled` is set it tells the model to keep sentences short and to avoid markdown, tables, code blocks and bullet lists. When `inputModality` is `"speech"` it adds that the user spoke. With no voice metadata it adds nothing.

## How a reply is synthesized

Only assistant messages are voiced.

| Lookup | Answer |
|---|---|
| Where a sentence ends | At `.`, `!` or `?` followed by whitespace. Text left in the buffer when the message part finishes is sent as the last sentence. It also splits after an abbreviation, so "Dr. Smith" is spoken as two sentences. |
| Which provider method runs | `speakStream()` when `abilities.speakStream` is `true`, otherwise `speak()`. |
| What the client receives, streaming | A `content.added` with empty audio, a run of `content.audio.delta` events, then `content.done`. |
| What the client receives, batch | `content.added` and `content.done`, both carrying the full audio. |
| Order | Strictly by sentence, per message. Every chunk of sentence N goes out before the first chunk of N+1. |
| Concurrency | Up to 3 synthesis calls in flight. A streaming call holds its slot until its sentence has gone out. |
| What a failed sentence does | It is skipped and text streaming continues. A part that fails mid-stream is closed with `content.done`. |
| Timeout | 15 seconds. See below. |

The timeout covers the first chunk of each sentence when streaming, and the whole `speak()` call in batch. Once a streaming sentence's first chunk arrives, its timer stops, so a long sentence is not cut off. A sentence that times out is abandoned and reported like any failed sentence. When the client disconnects, in-flight synthesis is cancelled. A reverse proxy in front of the server needs an idle timeout longer than 15 seconds.

A failed sentence is reported as a debug event named `tts.synthesis.error`, not as an `error` item:

| Field | Value |
|---|---|
| `itemId` | the message the sentence belongs to |
| `text` | the first 100 characters of the sentence |
| `kind` | the `VoiceError` kind. A thrown error that is not a `VoiceError` is `unknown`. |
| `retryable` | whether the error was marked retryable |
| `level` | `debug` for `aborted`; `error` for `unknown`; otherwise `info` if retryable, else `warn` |
| `message` | the error message |

Debug events are never replayed when a client reconnects. See [Items](./items.md).

## Providers

### `VoiceProvider`

Exported from `@flow-state-dev/core`.

| Member | Type | Meaning |
|---|---|---|
| `id` | `string` | Stable id for telemetry. |
| `providerName` | `string` | Short name, such as `"openai"` or `"composite"`. |
| `abilities` | `{ speak, speakStream, transcribe, listVoices }` | Booleans. `true` means the method exists, `false` means it is absent. If `abilities` says `true` for a method the provider lacks, the framework's call throws a `TypeError`. |
| `defaultModels?` | `{ speak?, transcribe? }` | Models used when a call names none. The transcription endpoint reads `transcribe`. |
| `speak?(options)` | `Promise<{ audio: Uint8Array; mediaType: string }>` | Batch synthesis. |
| `speakStream?(options)` | `AsyncIterable<{ kind: "audio"; bytes: Uint8Array; mediaType: string; isLast?: boolean }>` | Streamed synthesis. `isLast` is set on the final chunk. |
| `transcribe?(options)` | `Promise<{ text: string; language?: string }>` | Speech to text. |
| `listVoices?()` | `Promise<VoiceInfo[]>` | The voice catalog. |

`SpeakOptions` are `text`, `voice?`, `model?`, `speed?`, `outputFormat?`, `signal?` and `providerOptions?`. The framework passes `voice`, `speed` and `model` from `voice.tts`, plus `text` and `signal`, and leaves `outputFormat` to the provider's default. `TranscribeOptions` are `audio` (`Uint8Array | Blob`), `mediaType?`, `language?` (a BCP-47 hint), `model?`, `signal?` and `providerOptions?`. A provider should stop work when `signal` aborts.

`VoiceInfo` has `id`, `name`, `provider`, and optional `language`, `accent`, `gender`, `age`, `previewUrl`, `supportedModels` and `raw`.

`canSpeak`, `canSpeakStream`, `canTranscribe` and `canListVoices` read `abilities`.

### `VoiceError`

A provider throws `new VoiceError({ kind, provider, message, retryable?, status?, cause? })`, exported from `@flow-state-dev/core`. It exposes `kind`, `provider`, `retryable` and `status`. `retryable` defaults by kind.

| `kind` | `retryable` default |
|---|---|
| `rate_limit`, `provider_unavailable`, `network` | `true` |
| `auth`, `not_found`, `invalid_input`, `format_unsupported`, `aborted`, `unknown` | `false` |

### `createCompositeVoiceProvider`

Builds one provider from several, so TTS and transcription can come from different services.

```ts title="src/lib/voice.ts"
import { createCompositeVoiceProvider } from "@flow-state-dev/core";
import { OpenAIVoiceProvider } from "@flow-state-dev/voice-openai";

export const voice = createCompositeVoiceProvider({
  speak: new OpenAIVoiceProvider({ voice: "nova" }),
  transcribe: new OpenAIVoiceProvider({ sttModel: "gpt-4o-mini-transcribe" }),
});
```

| Slot | Meaning |
|---|---|
| `speak`, `speakStream`, `transcribe`, `listVoices` | Each takes a `VoiceProvider`. All are optional. |

`providerName` is `"composite"`. `abilities` come from the provider in each slot, so an empty slot, or one whose provider lacks the ability, reports `false`. With `speakStream` omitted, the `speak` provider serves streaming when it advertises `speakStream`. With no slots every ability is `false`.

### `OpenAIVoiceProvider`

From `@flow-state-dev/voice-openai`. `new OpenAIVoiceProvider(options?)`.

| Option | Default | Meaning |
|---|---|---|
| `apiKey` | the SDK reads `OPENAI_API_KEY` | OpenAI API key. |
| `baseURL` | OpenAI's | Override for compatible endpoints or proxies. |
| `organization`, `project` | none | Forwarded to the SDK. |
| `ttsModel` | `gpt-4o-mini-tts` | Becomes `defaultModels.speak`. |
| `sttModel` | `gpt-4o-mini-transcribe` | Becomes `defaultModels.transcribe`. |
| `voice` | `alloy` | Default voice for `speak`. |
| `client` | none | A pre-built `OpenAI` client. When set, `apiKey`, `baseURL`, `organization` and `project` are ignored. |

Abilities: `speak`, `transcribe` and `listVoices` are `true`; `speakStream` is `false`, so TTS with this provider is always batch.

| `outputFormat` | Media type |
|---|---|
| `mp3` (default) | `audio/mpeg` |
| `opus` | `audio/ogg; codecs=opus` |
| `aac` | `audio/aac` |
| `flac` | `audio/flac` |
| `wav` | `audio/wav` |
| `pcm` | `audio/pcm;rate=24000` (24 kHz, 16-bit little-endian, mono) |

Any other format throws `format_unsupported`. `providerOptions.openai.instructions` is passed through, and throws `invalid_input` on `tts-1` and `tts-1-hd`. `transcribe` with a `Uint8Array` needs `mediaType`, or it throws `invalid_input`. OpenAI returns no language, so the result's `language` is the one you passed.

`listVoices()` returns 13 voices: alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse, marin and cedar. `marin` and `cedar` list `supportedModels: ["gpt-4o-mini-tts"]`.

OpenAI errors map to `VoiceError` kinds: authentication and permission to `auth`, rate limit to `rate_limit`, not found to `not_found`, a bad request to `invalid_input` or `format_unsupported`, a server error to `provider_unavailable`, a connection failure to `network`, an abort to `aborted`, anything else to `unknown`.

## The transcription endpoint

`POST /api/flows/transcribe`. It belongs to no flow, always uses the server's provider, requires an authenticated caller, as the session listing does (see [Authentication and tenancy](./authentication.md)), and stores nothing.

| Form | Request | Fields |
|---|---|---|
| JSON | `Content-Type` contains `application/json` | `userId` (required), `audio` (required, base64), `mediaType` (default `audio/webm`), `language`, `model` |
| Raw | any other content type | The body is the audio. Query: `userId` (required), `language`, `model`. `mediaType` is the `Content-Type` without parameters, default `audio/webm`. |

Audio over 25 MiB (26,214,400 bytes) is refused. A model is the request's `model`, else the provider's `defaultModels.transcribe`. The framework has no default.

`200` returns `{ text, language }`. `language` is absent when the provider returns none.

| Status | `error` | When |
|---|---|---|
| 400 | a message naming `userId` | No `userId`. |
| 400 | a message naming the audio | No audio, or empty audio. |
| 400 | `no_model` | No `model` in the request (an empty string counts) and no `defaultModels.transcribe`. |
| 413 | `Audio payload exceeds maximum size of 26214400 bytes` | Audio over 25 MiB. The raw form checks `Content-Length` first. |
| 501 | `transcription_not_configured` | The server has no provider. |
| 501 | `provider_does_not_support_transcription` | `abilities.transcribe` is `false`. |

When the provider throws a `VoiceError`, the response is `{ error: <kind>, message }` with a status by kind:

| `kind` | Status |
|---|---|
| `invalid_input` | 400 |
| `auth` | 401 |
| `not_found` | 404 |
| `format_unsupported` | 415 |
| `aborted` | 499 |
| `unknown` | 500 |
| `network` | 502 |
| `provider_unavailable` | 503 |
| `rate_limit` | 429 |

From a client, `client.transcribe({ audio, mediaType?, language? })` takes a `Uint8Array` or `Blob`, sends the raw form with the session's `userId`, and returns `{ text, language? }`. `mediaType` defaults to `audio/webm`.

## Audio content type

A spoken reply sentence is an `OutputAudioContent`, a member of the `Content` union, imported from `@flow-state-dev/core/items`.

| Field | Type | Meaning |
|---|---|---|
| `type` | `"output_audio"` | |
| `audio` | `string` | Base64 audio. Empty while streaming. |
| `mediaType` | `string` | For example `audio/mpeg`. |
| `transcript?` | `string` | The sentence that was synthesized. |
| `ephemeral?` | `boolean` | Always `true` on audio the framework produces. |

Each sentence is its own content part on the assistant message. A streamed part is `content.added` (empty `audio`, `mediaType` `audio/mpeg`), then `content.audio.delta` events, then `content.done` (empty `audio`, the last chunk's `mediaType`, the `transcript`).

`content.audio.delta` carries `{ type, itemId, contentIndex, audio, isLast? }`, where `audio` is one base64 chunk.

Audio is not saved with the request's items, so it cannot be read back later; the reply's text is saved as a normal assistant message. On a reconnect, the events that were saved are replayed. A batch sentence comes back whole, with its audio and `transcript`. A streamed sentence comes back with its `transcript` and empty `audio`, because `content.audio.delta` chunks are never replayed. A client that reconnects mid-sentence hears no more of that sentence. [Items](./items.md) lists what is saved and replayed.

## `useVoice`

`useVoice(session, options)` from `@flow-state-dev/react` records the microphone, transcribes it, sends the text to an action and plays the reply.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `action` | `string` | required | The action that receives the transcript. |
| `buildInput` | `(text: string) => unknown` | `text => ({ message: text })` | Turns the transcript into the action's input. |
| `baseUrl` | `string` | none | Base URL for the transcription call. |
| `apiPath` | `string` | `"/api/flows"` | Where the flow API is mounted. |
| `language` | `string` | `en-US` for browser recognition; none sent to transcription | Recognition language and transcription hint. |
| `autoPlayTTS` | `boolean` | `true` | Play audio from assistant messages, and set `ttsEnabled` on each request. |

| Return | Type | Meaning |
|---|---|---|
| `isListening` | `boolean` | The microphone is recording. |
| `isSpeaking` | `boolean` | Audio is playing. |
| `isProcessing` | `boolean` | The server is transcribing. |
| `interimTranscript` | `string` | The browser's live speech result. Empty without the Web Speech API. |
| `isAvailable` | `boolean` | `getUserMedia` and `MediaRecorder` exist. `false` on the first render. |
| `startListening()` | `() => Promise<void>` | Start recording. Does nothing when unavailable or already listening. |
| `stopListening()` | `() => Promise<void>` | Stop recording, transcribe, send the action. |
| `stopSpeaking()` | `() => void` | Stop playback. |

`stopListening` sends the transcript from the server, taken from the whole recording. If transcription throws, it sends the interim transcript instead; with none, nothing is sent and no error surfaces. A blank transcript sends nothing. `useVoice` plays streamed and batch audio, each part once, and skips replayed parts whose `audio` is empty.

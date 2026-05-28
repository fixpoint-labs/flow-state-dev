---
sidebar_position: 8
---

# Voice

Add speech input and audio output to a flow. Users speak into a microphone, the framework transcribes the audio to text, runs the flow, then synthesizes the response back to speech. It all layers on top of existing text streaming, so flows that don't opt in are unaffected.

Voice is opt-in on two sides: a `voice.tts` block on the flow (so the server knows to synthesize), and a voice provider on the server (so it knows how to call the TTS/STT APIs).

## What you need

1. **A provider package.** `@flow-state-dev/voice-openai` ships now; an ElevenLabs adapter is planned. A provider is a single object that knows how to `speak`, `transcribe`, and (optionally) stream audio.
2. **`voice.tts`** on your flow definition, so the server synthesizes that flow's responses.
3. **`useVoice()`** in React, so the browser captures audio and plays the response.

## Server setup

Pass a single `voiceProvider` to your router. The provider owns both directions of voice (text-to-speech and speech-to-text), so there's one thing to wire instead of two resolver functions.

```ts title="lib/server.ts"
import { createFlowApiRouter, createFlowRegistry } from "@flow-state-dev/server";
import { OpenAIVoiceProvider } from "@flow-state-dev/voice-openai";

const registry = createFlowRegistry();
registry.register(myFlow);

export const router = createFlowApiRouter({
  registry,
  voiceProvider: new OpenAIVoiceProvider({ apiKey: process.env.OPENAI_API_KEY }),
});
```

If you use the higher-level `createFlowState` setup, the provider goes under `voice`:

```ts
createFlowState({
  flows: { myFlow },
  voice: { provider: new OpenAIVoiceProvider({ apiKey: process.env.OPENAI_API_KEY }) },
});
```

`voiceProvider` is optional. Without it, flows that request TTS skip synthesis (text still streams) and the transcribe endpoint returns 501.

## Per-flow provider override

Most apps use one provider for everything. If you need a different one for a specific flow, for example one flow on ElevenLabs while the rest use OpenAI, set `voice.provider` on that flow. It wins over the router-level provider at dispatch time.

```ts
defineFlow({
  kind: "narration",
  voice: {
    provider: new ElevenLabsVoiceProvider({ apiKey: process.env.ELEVENLABS_API_KEY }),
    tts: { voice: "Rachel" },
  },
  actions: { /* ... */ },
});
```

The per-flow override applies to TTS synthesis only. The transcribe endpoint is HTTP-level (not tied to a flow), so it always uses the router-level provider.

## Flow configuration

Add `voice.tts` to a flow to enable audio synthesis for its responses.

```ts title="flows/my-flow/flow.ts"
const myFlow = defineFlow({
  kind: "my-flow",
  voice: {
    tts: { model: "gpt-4o-mini-tts", voice: "alloy" },
  },
  actions: { /* ... */ },
});
```

### TTS options

| Option  | Type     | Default          | Description                                                         |
| ------- | -------- | ---------------- | ------------------------------------------------------------------- |
| `model` | `string` | provider default | Speak model id passed to the provider. Omit to use its default.     |
| `voice` | `string` | provider default | Voice variant (e.g. OpenAI's `alloy`, `echo`, `nova`).              |
| `speed` | `number` | `1.0`            | Playback speed multiplier.                                          |

The model now goes straight to the provider; there's no separate resolver to register. If `voice` is omitted from the flow definition entirely, no audio processing happens.

## How TTS works

When a flow has `voice.tts` configured and the client opts in, the server's TTS pipeline runs during action execution:

1. As the generator streams text, a sentence buffer collects it and detects sentence boundaries (a `.`, `!`, or `?` followed by whitespace).
2. Each complete sentence is dispatched to the provider. How depends on what the provider advertises in its `abilities`:
   - If `abilities.speakStream` is `true`, the pipeline calls `speakStream()` and emits the audio as a sequence of `content.audio.delta` chunks. The browser can start playing the first chunk before the sentence finishes synthesizing.
   - Otherwise the pipeline calls `speak()` and emits the whole sentence as one `OutputAudioContent` part.
3. Sentences are emitted strictly in order: every chunk of sentence N flushes before sentence N+1's first chunk.

Synthesis errors are non-fatal. A sentence that fails to synthesize is logged and skipped; text streaming is never interrupted. Retryable provider errors (rate limits, transient network failures) are logged quietly; hard failures are logged at warning level.

## Streaming and the first-chunk timeout

Streaming exists to cut time-to-first-audio. Instead of waiting for a whole sentence to render before any sound plays, a streaming provider emits audio as it generates it.

The tradeoff is head-of-line blocking. Because audio must play in order, sentence N+1 waits for sentence N to finish draining before its chunks go out. For normal speech this is fine; the chunks for one sentence arrive quickly.

There's one timer: a 15-second timeout on the **first** chunk of each sentence. If the provider hasn't produced any audio in that window, the sentence is abandoned as a non-fatal error. After the first chunk arrives, the timer is dropped, so a long sentence won't be cut off mid-stream. If a stream stalls partway through, the escape hatch is the request-level abort signal: when the client disconnects, in-flight synthesis is cancelled. Deployments should still set a reverse-proxy idle timeout to bound the worst case.

## React: `useVoice`

`useVoice` composes with `useSession` to manage the full loop: microphone capture, transcription, and playback. It handles both batch and streaming audio transparently, so nothing changes in your component when you switch to a streaming provider.

```tsx
import { useSession, useVoice } from "@flow-state-dev/react";

function VoiceChat() {
  const session = useSession(sessionId);
  const voice = useVoice(session, {
    action: "run",
    buildInput: (transcript) => ({ message: transcript }),
  });

  return (
    <div>
      <button onPointerDown={voice.startListening} onPointerUp={voice.stopListening}>
        {voice.isListening ? "Listening..." : "Hold to speak"}
      </button>
      {voice.interimTranscript && <p className="interim">{voice.interimTranscript}</p>}
      {voice.isSpeaking && <button onClick={voice.stopSpeaking}>Stop</button>}
    </div>
  );
}
```

### Return value

| Property            | Type         | Description                                            |
| ------------------- | ------------ | ------------------------------------------------------ |
| `isListening`       | `boolean`    | Microphone is recording.                               |
| `isSpeaking`        | `boolean`    | Audio playback is active.                              |
| `isProcessing`      | `boolean`    | Server is transcribing audio.                          |
| `interimTranscript` | `string`     | Browser's live (non-final) speech recognition result. |
| `startListening()`  | `() => void` | Start recording.                                       |
| `stopListening()`   | `() => void` | Stop recording and transcribe.                         |
| `stopSpeaking()`    | `() => void` | Stop audio playback.                                   |

The browser's Web Speech API supplies the interim transcript for instant feedback, but the authoritative text comes from server transcription on the full recording. When the browser API is missing, `useVoice` still works; you just won't see interim text.

## Transcription endpoint

The server exposes a transcription endpoint:

```
POST /api/flows/transcribe
```

Send audio as base64 JSON:

```json
{
  "userId": "u_123",
  "audio": "<base64-encoded audio bytes>",
  "mediaType": "audio/webm",
  "model": "gpt-4o-mini-transcribe",
  "language": "en"
}
```

Or as raw binary with the model as a query parameter:

```
POST /api/flows/transcribe?userId=u_123&model=gpt-4o-mini-transcribe
Content-Type: audio/webm

<raw audio bytes>
```

The model is resolved in order: the per-request `model` field wins, then the provider's `defaultModels.transcribe`. If neither is set, the endpoint returns `400 no_model` — there is no built-in default model string. If no provider is configured, or the configured provider can't transcribe, it returns 501.

Response:

```json
{ "text": "Hello, how are you?", "language": "en" }
```

You don't need to call this directly when using `useVoice`; the hook handles it.

## Content type: `OutputAudioContent`

Voice adds one member to the `Content` union:

```ts
type OutputAudioContent = {
  type: "output_audio";
  audio: string; // base64-encoded audio data
  mediaType: string; // "audio/mp3", "audio/wav", etc.
  transcript?: string; // the text that was synthesized
};
```

For batch synthesis this carries the full audio. For streaming, the audio plays via `content.audio.delta` chunks and the snapshot carries the transcript with empty audio (streamed chunks are live-only and not replayable on reconnect).

## Custom providers

A provider implements the `VoiceProvider` interface: an `abilities` object declaring which surfaces it supports, plus the matching methods. Implement only what you need.

```ts
import type { VoiceProvider } from "@flow-state-dev/core";

const myStreamingProvider: VoiceProvider = {
  id: "my-tts:1",
  providerName: "my-tts",
  abilities: { speak: false, speakStream: true, transcribe: false, listVoices: false },
  defaultModels: { speak: "my-model" },
  async *speakStream({ text, voice, signal }) {
    for await (const bytes of myApi.stream(text, { voice, signal })) {
      yield { kind: "audio", bytes, mediaType: "audio/mp3" };
    }
  },
};
```

The framework branches on `abilities`, so a provider that sets `speakStream: true` automatically gets the streaming path; one that only sets `speak: true` gets the batch path. Providers should throw `VoiceError` (with a typed `kind`) on failure and stop producing audio when the abort `signal` fires.

## Composite providers

To mix providers, for example synthesize with one and transcribe with another, use `createCompositeVoiceProvider`:

```ts
import { createCompositeVoiceProvider } from "@flow-state-dev/core";

const provider = createCompositeVoiceProvider({
  speak: elevenLabsProvider,
  transcribe: openAiProvider,
});
```

The composite's `abilities` reflect what the underlying providers actually support.

## Environment variables

Each provider reads its own credentials (e.g. `OPENAI_API_KEY` for `OpenAIVoiceProvider`). See the provider package for specifics.

# Voice Support

Flow State Dev supports speech-to-text (STT) input and text-to-speech (TTS) output, enabling voice-driven interaction with flows. Users can speak to a flow and hear responses read back as audio.

## How It Works

Voice support spans three layers:

1. **Server** — dispatches to a single `VoiceProvider` for both synthesis and transcription, runs the TTS synthesis pipeline, exposes a transcription HTTP endpoint
2. **Client** — provides an isomorphic `transcribe()` helper for sending audio to the server
3. **React** — `useVoice()` hook manages mic capture, browser speech recognition, audio playback, and voice activity detection

```
Browser                           Server
  │                                 │
  ├─ MediaRecorder captures audio   │
  ├─ POST /api/flows/transcribe ──►│─ VoiceProvider.transcribe()
  │◄── { text } ──────────────────│
  ├─ sendAction("run", { text }) ─►│─ block executes, generator streams
  │                                 ├─ TTS pipeline buffers sentences
  │                                 ├─ VoiceProvider.speak() / speakStream() per sentence
  │◄── content.added (audio) ─────│─ OutputAudioContent streamed via SSE
  ├─ HTMLAudioElement plays audio   │
```

## Setup

> This section is the architectural summary. The full user-facing walkthrough lives in [`apps/docs/docs/advanced/voice.md`](../../apps/docs/docs/advanced/voice.md).

### 1. Install a voice provider package

Voice synthesis and transcription are owned by a `VoiceProvider` implementation, shipped as its own package. The reference implementation is `@flow-state-dev/voice-openai`, which wraps the official `openai` SDK and advertises `speak`, `transcribe`, and `listVoices` (it does not stream — `abilities.speakStream === false`).

### 2. Wire the provider on the server

A single `VoiceProvider` instance owns both directions of voice. Pass it once; the router uses it for synthesis and the transcribe endpoint alike.

```typescript
import { createFlowApiRouter, createFlowRegistry } from "@flow-state-dev/engine";
import { OpenAIVoiceProvider } from "@flow-state-dev/voice-openai";

const registry = createFlowRegistry();
registry.register(myFlow);

export const router = createFlowApiRouter({
  registry,
  voiceProvider: new OpenAIVoiceProvider({ apiKey: process.env.OPENAI_API_KEY }),
});
```

With the higher-level `createFlowState` assembly, the provider goes under `voice`:

```typescript
createFlowState({
  flows: { myFlow },
  voice: { provider: new OpenAIVoiceProvider({ apiKey: process.env.OPENAI_API_KEY }) },
});
```

`voiceProvider` is optional. Without it, flows that request TTS skip synthesis (text streaming still works normally) and the `POST /api/flows/transcribe` endpoint returns 501.

### 3. Add voice config to your flow

Add a `voice` property to `defineFlow()` to enable TTS for that flow's responses:

```typescript
import { defineFlow } from "@flow-state-dev/core";

const myFlow = defineFlow({
  kind: "my-flow",
  voice: {
    tts: {
      // `model` is optional — omit it to use the provider's default
      // (`gpt-4o-mini-tts` for OpenAIVoiceProvider).
      voice: "alloy",            // OpenAI voice: alloy, echo, fable, onyx, nova, shimmer
      speed: 1.0,                // playback speed multiplier (0.25–4.0)
    },
  },
  actions: { /* ... */ },
});
```

When `voice.tts` is set, the server's TTS pipeline automatically:
- Buffers streaming text deltas into complete sentences
- Calls `VoiceProvider.speak()` (or `speakStream()` when the provider advertises it) for each sentence
- Emits `OutputAudioContent` items alongside the text stream via SSE

If `voice.tts` is omitted, no audio is generated. Text streaming works exactly as before.

### 4. Add voice UI in React

Use the `useVoice()` hook from `@flow-state-dev/react`:

```tsx
import { useSession, useVoice } from "@flow-state-dev/react";

function ChatWithVoice() {
  const session = useSession(sessionId, { items: { itemTypes: ["message"] } });

  const voice = useVoice(session, {
    action: "run",
    buildInput: (transcript) => ({ message: transcript }),
  });

  return (
    <div>
      <button
        onPointerDown={voice.startListening}
        onPointerUp={voice.stopListening}
      >
        {voice.isListening ? "Listening..." : "Hold to speak"}
      </button>

      {voice.interimTranscript && <p>{voice.interimTranscript}</p>}

      {voice.isSpeaking && (
        <button onClick={voice.stopSpeaking}>Stop audio</button>
      )}
    </div>
  );
}
```

#### `useVoice` options

| Option | Type | Description |
|--------|------|-------------|
| `action` | `string` | Action name to call with the transcribed text |
| `buildInput` | `(text: string) => object` | Builds action input from the transcript |

#### `VoiceState` return value

| Property | Type | Description |
|----------|------|-------------|
| `isListening` | `boolean` | Microphone is active and recording |
| `isSpeaking` | `boolean` | Audio playback is in progress |
| `isProcessing` | `boolean` | Audio is being transcribed server-side |
| `interimTranscript` | `string` | Live browser speech recognition (interim, not final) |
| `startListening()` | `() => void` | Begin recording from microphone |
| `stopListening()` | `() => void` | Stop recording and send audio for transcription |
| `stopSpeaking()` | `() => void` | Stop audio playback |

### 5. Environment variables

Voice requires the same `OPENAI_API_KEY` used for text generation. No additional keys are needed when using OpenAI for both STT and TTS.

## Content Types

Voice introduces one new content type:

### `OutputAudioContent`

```typescript
type OutputAudioContent = {
  type: "output_audio";
  audio: string;        // base64-encoded audio data
  mediaType: string;    // "audio/mp3", "audio/wav", "audio/pcm16"
  transcript?: string;  // text that was synthesized (for accessibility)
};
```

This sits alongside `OutputTextContent`, `ReasoningTextContent`, `RefusalContent`, and `FileContent` in the `Content` union.

## Transcription Endpoint

The server exposes `POST /api/flows/transcribe` for server-side speech-to-text.

**JSON request:**
```json
{
  "audio": "<base64-encoded audio>",
  "mediaType": "audio/webm",
  "model": "gpt-4o-mini-transcribe",
  "language": "en"
}
```

**Response:**
```json
{
  "text": "Hello, how are you?",
  "language": "en",
  "duration": 2.5,
  "segments": [
    { "text": "Hello, how are you?", "start": 0.0, "end": 2.5 }
  ]
}
```

Available OpenAI transcription models: `gpt-4o-mini-transcribe` and `gpt-4o-transcribe`.

The endpoint also accepts raw binary audio with the model specified as a query parameter: `POST /api/flows/transcribe?model=gpt-4o-mini-transcribe` with `Content-Type: audio/webm`.

## TTS Pipeline Internals

The TTS pipeline runs inside `runAction()` when a flow has `voice.tts` configured:

1. A `TTSEmitterHook` observes `ResponseEmitter` events
2. When `content.delta` events arrive for assistant message items, text is fed to a `SentenceBuffer`
3. The buffer detects sentence boundaries (`.` `!` `?` followed by whitespace) and yields complete sentences
4. Each sentence is dispatched to the provider: `speakStream()` when `abilities.speakStream` is `true`, otherwise `speak()`
5. The resulting audio is emitted as an `OutputAudioContent` via `content.added`
6. On action completion, any remaining buffered text is flushed and synthesized

Synthesis errors are non-fatal. If a sentence fails to synthesize, the error is logged and text streaming continues uninterrupted.

## Streaming TTS path

When the configured `VoiceProvider` has `abilities.speakStream === true`, the TTS pipeline (see FIX-528 for the dispatch implementation) emits audio via the `content.audio.delta` event type instead of buffering each sentence to a single `OutputAudioContent` part. First-audio latency drops from sentence-completion time (\~1–2s with batch providers) to first-chunk latency (\~100ms with streaming-capable providers like ElevenLabs).

**Pipeline contract.** Before the first chunk for a content part, the pipeline emits `content.added` with an `OutputAudioContent` placeholder declaring the `mediaType`. Chunks follow, each carrying base64-encoded bytes. Once synthesis finishes, the pipeline reassembles the chunks and emits the final `OutputAudioContent.audio` snapshot via `content.added` (or `content.done`, depending on the pipeline's chosen finalization signal — FIX-528 sets this).

**Player contract.** The React `audio-player` (`packages/react/src/voice/audio-player.ts`) consumes chunks via the Web Audio API: each chunk is decoded into an `AudioBuffer` and scheduled on an `AudioBufferSourceNode` at a moving `nextStartTime` cursor so consecutive sources butt up gap-free. The same player also handles the batch path (whole-buffer `enqueue`) as a thin wrapper over `enqueueChunk` with `isLast: true`. M1 supports MP3 only; PCM and WAV require either WAV-header injection or an AudioWorklet path and are deferred.

**Dedup.** `useVoice` tracks `(itemId, contentIndex)` pairs that have received streaming chunks and skips the batch-path scanner for those parts so the eventual `OutputAudioContent` snapshot doesn't double-play.

**Resume.** Same posture as text deltas — chunks are non-replayable. See [streaming.md](./streaming.md) for the event taxonomy and replay rules.

```ts
type ContentAudioDeltaEvent = {
  type: "content.audio.delta";
  itemId: string;
  contentIndex: number;
  audio: string;     // base64-encoded chunk bytes
  isLast?: boolean;
};

audioPlayer.enqueueChunk({ audio, mediaType: "audio/mpeg", isLast: false });
```

## Provider-Agnostic Design

`VoiceProvider` is the single provider-agnostic interface defined in `@flow-state-dev/core` (`packages/core/src/types/voice-provider.ts`). One object owns every voice surface — synthesis, streaming synthesis, transcription, and voice cataloging. Which surfaces it actually supports is declared by its `abilities` flags rather than by which package you import:

```typescript
interface VoiceAbilities {
  readonly speak: boolean;        // batch text → audio
  readonly speakStream: boolean;  // streamed text → audio chunks
  readonly transcribe: boolean;   // audio → text
  readonly listVoices: boolean;   // voice catalog
}
```

The router and TTS pipeline never call a method blindly. They narrow with the runtime type guards (`canSpeak`, `canSpeakStream`, `canTranscribe`, `canListVoices`) so a provider that advertises only some surfaces degrades cleanly — a transcribe-only provider leaves TTS off, a non-streaming provider falls back to batch `speak()`.

`@flow-state-dev/voice-openai` is the reference implementation contributors copy when building a new provider package (ElevenLabs, Deepgram, browser-native `SpeechSynthesis`, etc.). A minimal one only has to declare its abilities and implement the matching methods:

```typescript
import type { VoiceProvider } from "@flow-state-dev/core";

const myProvider: VoiceProvider = {
  id: "my-tts:default",
  providerName: "my-tts",
  abilities: { speak: true, speakStream: false, transcribe: false, listVoices: false },
  defaultModels: { speak: "my-tts-1" },
  async speak({ text, voice, model }) {
    const bytes = await myTtsSdk.synthesize(text, { voice, model });
    return { audio: bytes, mediaType: "audio/mpeg" };
  },
};
```

Wire it the same way as the OpenAI provider — pass the instance as `voiceProvider` to `createFlowApiRouter`, or as `voice.provider` on a single flow to override the router-level provider for that flow.

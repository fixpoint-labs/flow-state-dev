# Voice Support

Flow State Dev supports speech-to-text (STT) input and text-to-speech (TTS) output, enabling voice-driven interaction with flows. Users can speak to a flow and hear responses read back as audio.

## How It Works

Voice support spans three layers:

1. **Server** — resolves speech/transcription models, runs the TTS synthesis pipeline, exposes a transcription HTTP endpoint
2. **Client** — provides an isomorphic `transcribe()` helper for sending audio to the server
3. **React** — `useVoice()` hook manages mic capture, browser speech recognition, audio playback, and voice activity detection

```
Browser                           Server
  │                                 │
  ├─ MediaRecorder captures audio   │
  ├─ POST /api/flows/transcribe ──►│─ TranscriptionModel.transcribe()
  │◄── { text } ──────────────────│
  ├─ sendAction("run", { text }) ─►│─ block executes, generator streams
  │                                 ├─ TTS pipeline buffers sentences
  │                                 ├─ SpeechModel.generate() per sentence
  │◄── content.added (audio) ─────│─ OutputAudioContent streamed via SSE
  ├─ HTMLAudioElement plays audio   │
```

## Setup

### 1. Install the AI SDK speech provider

Voice uses the same `@ai-sdk/openai` provider you already have for text generation. No extra packages needed. The OpenAI provider exposes `.speech()` and `.transcription()` factory methods.

### 2. Configure resolvers on the server

The server router needs two additional resolvers: one for TTS (speech synthesis) and one for STT (transcription).

```typescript
import { openai } from "@ai-sdk/openai";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createAiSdkModelResolver,
  createAiSdkSpeechResolver,
  createAiSdkTranscriptionResolver,
} from "@flow-state-dev/server";

const modelResolver = createAiSdkModelResolver(openai);

// Map model IDs like "tts-1" to OpenAI speech models
const speechResolver = createAiSdkSpeechResolver(
  (modelId) => openai.speech(modelId)
);

// Map model IDs like "whisper-1" to OpenAI transcription models
const transcriptionResolver = createAiSdkTranscriptionResolver(
  (modelId) => openai.transcription(modelId)
);

export const router = createFlowApiRouter({
  registry,
  modelResolver,
  speechResolver,
  transcriptionResolver,
});
```

Without `speechResolver`, the TTS pipeline won't activate (text streaming still works normally). Without `transcriptionResolver`, the `POST /api/flows/transcribe` endpoint returns 501.

### 3. Add voice config to your flow

Add a `voice` property to `defineFlow()` to enable TTS for that flow's responses:

```typescript
import { defineFlow } from "@flow-state-dev/core";

const myFlow = defineFlow({
  kind: "my-flow",
  voice: {
    tts: {
      model: "tts-1",    // resolved by speechResolver
      voice: "alloy",     // OpenAI voice: alloy, echo, fable, onyx, nova, shimmer
      speed: 1.0,         // playback speed multiplier (0.25–4.0)
    },
  },
  actions: { /* ... */ },
});
```

Available OpenAI TTS models: `tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`.

When `voice.tts` is set, the server's TTS pipeline automatically:
- Buffers streaming text deltas into complete sentences
- Calls `SpeechModel.generate()` for each sentence
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
  duration?: number;    // duration in seconds
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
  "model": "whisper-1",
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

Available OpenAI transcription models: `whisper-1`, `gpt-4o-mini-transcribe`, `gpt-4o-transcribe`.

The endpoint also accepts raw binary audio with the model specified as a query parameter: `POST /api/flows/transcribe?model=whisper-1` with `Content-Type: audio/webm`.

## TTS Pipeline Internals

The TTS pipeline runs inside `runAction()` when a flow has `voice.tts` configured:

1. A `TTSEmitterHook` observes `ResponseEmitter` events
2. When `content.delta` events arrive for assistant message items, text is fed to a `SentenceBuffer`
3. The buffer detects sentence boundaries (`.` `!` `?` followed by whitespace) and yields complete sentences
4. Each sentence is sent to `SpeechModel.generate()` for synthesis
5. The resulting audio is emitted as an `OutputAudioContent` via `content.added`
6. On action completion, any remaining buffered text is flushed and synthesized

Synthesis errors are non-fatal. If a sentence fails to synthesize, the error is logged and text streaming continues uninterrupted.

## Provider-Agnostic Design

`SpeechModel` and `TranscriptionModel` are provider-agnostic interfaces defined in `@flow-state-dev/core`. The AI SDK adapters (`createAiSdkSpeechResolver`, `createAiSdkTranscriptionResolver`) are one implementation. You can implement these interfaces directly for other providers (ElevenLabs, Deepgram, browser-native SpeechSynthesis, etc.).

```typescript
import type { SpeechModel } from "@flow-state-dev/core";

const customSpeechModel: SpeechModel = {
  modelId: "my-tts",
  async generate(options) {
    const audio = await myTtsProvider.synthesize(options.text, options.voice);
    return { audio, mediaType: "audio/mp3" };
  },
};
```

Pass a custom `SpeechModel` directly in the flow's voice config instead of a string model ID:

```typescript
defineFlow({
  voice: { tts: { model: customSpeechModel } },
  // ...
});
```

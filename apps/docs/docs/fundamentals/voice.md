---
sidebar_position: 8
---

# Voice

Add speech input and audio output to a flow. Users speak into a microphone, the framework transcribes the audio to text, runs the flow, then synthesizes the response back to speech. All of this layers on top of existing text streaming — nothing changes for flows that don't opt in.

## What you need

Voice uses the same `@ai-sdk/openai` provider you already have for text generation. No extra packages.

Three things to configure:

1. **Speech and transcription resolvers** on the server (so it knows how to call TTS/STT APIs)
2. **`voice.tts`** on your flow definition (so the server knows to synthesize audio)
3. **`useVoice()`** in React (so the browser captures audio and plays responses)

## Server setup

Add `speechResolver` and `transcriptionResolver` to your router. These map model ID strings (like `"gpt-4o-mini-tts"` or `"gpt-4o-mini-transcribe"`) to actual provider models, the same way `modelResolver` maps IDs like `"openai/gpt-5.4-mini"` to language models.

```ts title="lib/server.ts"
import { openai } from "@ai-sdk/openai";
import {
  createFlowApiRouter,
  createFlowRegistry,
} from "@flow-state-dev/server";
import {
  createModelResolver,
  createAiSdkSpeechResolver,
  createAiSdkTranscriptionResolver,
} from "@flow-state-dev/core/models";

const modelResolver = createModelResolver();
const speechResolver = createAiSdkSpeechResolver(
  (modelId) => openai.speech(modelId)
);
const transcriptionResolver = createAiSdkTranscriptionResolver(
  (modelId) => openai.transcription(modelId)
);

const registry = createFlowRegistry();
registry.register(myFlow);

export const router = createFlowApiRouter({
  registry,
  modelResolver,
  speechResolver,
  transcriptionResolver,
});
```

Both resolvers are optional. Without `speechResolver`, flows won't generate audio (text streaming still works). Without `transcriptionResolver`, the transcription endpoint returns 501.

## Flow configuration

Add `voice.tts` to your flow definition to enable audio synthesis for that flow's responses.

```ts title="flows/my-flow/flow.ts"
const myFlow = defineFlow({
  kind: "my-flow",
  voice: {
    tts: {
      model: "gpt-4o-mini-tts",
      voice: "alloy",
    },
  },
  actions: { /* ... */ },
});
```

### TTS options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `string` | — | Model ID resolved by `speechResolver`. OpenAI model: `gpt-4o-mini-tts` |
| `voice` | `string` | provider default | Voice variant. OpenAI options: `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer` |
| `speed` | `number` | `1.0` | Playback speed multiplier (0.25–4.0) |

If `voice` is omitted from the flow definition entirely, no audio processing happens. The flow behaves exactly as before.

## How TTS works

When a flow has `voice.tts` configured, the server's TTS pipeline activates during action execution:

1. As the generator streams text via `content.delta` events, a sentence buffer collects the text
2. When a sentence boundary is detected (period, exclamation mark, or question mark followed by whitespace), the complete sentence is sent to `SpeechModel.generate()`
3. The synthesized audio comes back as an `OutputAudioContent` part, emitted via `content.added` on the same message item
4. When the generator finishes, any remaining buffered text gets flushed and synthesized

The client receives audio chunks interleaved with text deltas over the same SSE stream. Playback can start before the full response is generated.

Synthesis errors are non-fatal. If a sentence fails to synthesize, the framework logs it and continues. Text streaming is never interrupted by a TTS failure.

## React: `useVoice`

The `useVoice` hook composes with `useSession` to manage the full voice loop: microphone capture, transcription, and audio playback.

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
      <button
        onPointerDown={voice.startListening}
        onPointerUp={voice.stopListening}
      >
        {voice.isListening ? "Listening..." : "Hold to speak"}
      </button>

      {voice.interimTranscript && (
        <p className="interim">{voice.interimTranscript}</p>
      )}

      {voice.isSpeaking && (
        <button onClick={voice.stopSpeaking}>Stop</button>
      )}
    </div>
  );
}
```

### Options

| Option | Type | Description |
|--------|------|-------------|
| `action` | `string` | Action name to invoke with the transcribed text |
| `buildInput` | `(text: string) => object` | Builds the action input from the final transcript |

### Return value

| Property | Type | Description |
|----------|------|-------------|
| `isListening` | `boolean` | Microphone is recording |
| `isSpeaking` | `boolean` | Audio playback is active |
| `isProcessing` | `boolean` | Server is transcribing audio |
| `interimTranscript` | `string` | Browser's live speech recognition result (not final) |
| `startListening()` | `() => void` | Start recording |
| `stopListening()` | `() => void` | Stop recording and transcribe |
| `stopSpeaking()` | `() => void` | Stop audio playback |

### How input works

`useVoice` uses a hybrid approach for speech-to-text:

- **Browser SpeechRecognition** provides instant interim transcripts while the user is speaking. These show up in `interimTranscript` for visual feedback but aren't used as the final text.
- **Server transcription** (Whisper or similar) processes the full recorded audio when the user stops speaking. This is the authoritative transcript that gets passed to `buildInput` and sent as action input.

The browser's Web Speech API isn't available in all browsers. When it's missing, `useVoice` still works — you just won't see interim transcripts.

### How output works

When `OutputAudioContent` parts arrive on assistant message items during streaming, `useVoice` automatically queues and plays them through an `HTMLAudioElement`. Audio chunks play in order, one after another. Calling `stopSpeaking()` clears the queue and stops playback immediately.

## Transcription endpoint

The server exposes a transcription endpoint for converting audio to text:

```
POST /api/flows/transcribe
```

Send audio as base64 JSON:

```json
{
  "audio": "<base64-encoded audio bytes>",
  "mediaType": "audio/webm",
  "model": "gpt-4o-mini-transcribe",
  "language": "en"
}
```

Or as raw binary with the model as a query parameter:

```
POST /api/flows/transcribe?model=gpt-4o-mini-transcribe
Content-Type: audio/webm

<raw audio bytes>
```

Response:

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

OpenAI transcription models: `gpt-4o-mini-transcribe` (default) and `gpt-4o-transcribe`.

You don't need to call this endpoint directly when using `useVoice` — the hook handles it. It's useful if you're building a custom voice UI or using the client package without React.

### Client helper

The client package provides a typed wrapper:

```ts
import { transcribe } from "@flow-state-dev/client";

const result = await transcribe({
  audio: base64AudioString,
  mediaType: "audio/webm",
  model: "gpt-4o-mini-transcribe",
});
console.log(result.text);
```

## Content type: `OutputAudioContent`

Voice adds one new member to the `Content` union:

```ts
type OutputAudioContent = {
  type: "output_audio";
  audio: string;        // base64-encoded audio data
  mediaType: string;    // "audio/mp3", "audio/wav", etc.
  transcript?: string;  // the text that was synthesized
  duration?: number;    // duration in seconds
};
```

This sits alongside `OutputTextContent`, `ReasoningTextContent`, `RefusalContent`, and `FileContent`. If you're rendering content parts manually (not using `useVoice`), check for `type === "output_audio"` and handle it however you'd like.

## Custom providers

`SpeechModel` and `TranscriptionModel` are provider-agnostic interfaces. The AI SDK adapters are one implementation. You can write your own for ElevenLabs, Deepgram, or anything else.

```ts
import type { SpeechModel } from "@flow-state-dev/core";

const elevenLabsSpeech: SpeechModel = {
  modelId: "eleven-multilingual-v2",
  async generate(options) {
    const audio = await elevenLabs.textToSpeech(options.text, {
      voice: options.voice,
    });
    return { audio, mediaType: "audio/mp3" };
  },
};
```

You can pass a `SpeechModel` instance directly as `voice.tts.model` instead of a string:

```ts
defineFlow({
  voice: { tts: { model: elevenLabsSpeech } },
  // ...
});
```

When you pass an object, the `speechResolver` is bypassed for that flow.

## Environment variables

Voice uses the same `OPENAI_API_KEY` as text generation. No additional configuration needed.

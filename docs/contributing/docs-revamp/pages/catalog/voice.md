---
title: Voice
type: catalog
description: Speech in and audio out on a flow that already streams text.
---

# Voice

Add speech input and audio output to a flow. Users speak into a microphone, the framework transcribes the audio to text, runs the flow, then synthesizes the response back to speech. Text streams as usual. Audio is added alongside it, only on flows that ask for it.

## What you need

1. **A voice provider on the server.** A provider is one object that knows how to turn text into speech and speech into text. Install a provider package, such as `@flow-state-dev/voice-openai`.
2. **`voice.tts` on your flow definition**, so the server synthesizes that flow's responses.
3. **`useVoice()` in React**, so the browser records the user and plays the reply.

```bash
pnpm add @flow-state-dev/voice-openai
```

## Give the server a provider

Put the provider under `voice` in the app's config. `OpenAIVoiceProvider` needs a key when it is constructed, so pass one or set `OPENAI_API_KEY`.

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { OpenAIVoiceProvider } from "@flow-state-dev/voice-openai";
import { chat } from "./src/flows/chat/flow";

export default createFlowState({
  flows: [chat],
  voice: { provider: new OpenAIVoiceProvider({ apiKey: process.env.OPENAI_API_KEY }) },
});
```

Without a provider, a flow that asks for audio skips it and its text streams as normal. If you build the HTTP router yourself, the same provider goes in `createFlowApiRouter({ registry, voiceProvider })`. The [Voice reference](../reference/voice.md) lists both settings and the status codes.

## Turn on audio for a flow

Add `voice.tts` to the flow. The flow's blocks have no voice code in them.

```ts title="src/flows/chat/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { replySequencer } from "./blocks/reply-sequencer";

export const chat = defineFlow({
  kind: "chat",
  voice: {
    tts: { voice: "alloy" },
  },
  actions: {
    run: { block: replySequencer },
  },
});
```

`replySequencer` is the flow's block, in its own file beside the flow. `tts` takes an optional `model`, `voice` and `speed`, and each falls back to the provider's default. A flow with no `voice` gets no audio. A flow can also set its own `voice.provider`, which replaces the server's provider for that flow's speech output; transcription always uses the server's. Both are on the [reference](../reference/voice.md).

## Speak to it from React

`useVoice` takes a session and the name of the action that receives the user's words. `buildInput` turns the transcript into that action's input.

```tsx title="src/app/chat/voice-chat.tsx"
import { useSession, useVoice } from "@flow-state-dev/react";

export function VoiceChat({ sessionId }: { sessionId: string }) {
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
      {voice.interimTranscript && <p>{voice.interimTranscript}</p>}
      {voice.isSpeaking && <button onClick={voice.stopSpeaking}>Stop</button>}
    </div>
  );
}
```

Hold the button and the browser records. While you speak, `interimTranscript` shows the browser's live guess. Release and the recording goes to the server for transcription, the transcript is sent to `run`, and the reply is spoken as it streams in.

- **The client asks for audio.** `useVoice` requests speech with each action it sends. A message sent any other way gets text only. Set `autoPlayTTS: false` to turn speech off.
- **Check `isAvailable`.** It is `false` on the first render and when the browser cannot record.
- **The server's transcript wins.** If server transcription fails, the hook sends the interim text instead, when there is some.
- **Batch and streamed audio play the same.** Your component does not change if you switch providers.

The rest of the return value, the transcription endpoint and its status codes are on the [reference](../reference/voice.md).

## How a reply becomes audio

The server reads the text your flow streams, splits it into sentences, and synthesizes each one in order. A provider that streams audio sends each sentence as chunks, so playback starts before the sentence finishes. Any other provider sends each sentence whole. `OpenAIVoiceProvider` sends whole sentences.

If a sentence fails to synthesize, it is skipped and the text carries on. If a sentence produces no audio within 15 seconds, it is skipped the same way. Once audio starts, a long sentence is never cut off. A stream that stalls partway runs until the client disconnects, so set a reverse-proxy idle timeout to bound it. The sentence rule, error events and timeout details are on the [reference](../reference/voice.md).

Audio you synthesize is stored in the session's items with the reply. The framework does not keep a user's recording.

## Write your own provider

A provider declares what it can do in `abilities` and implements the matching methods. Implement only what you need.

```ts title="src/lib/my-voice-provider.ts"
import type { VoiceProvider } from "@flow-state-dev/core";
import { myApi } from "./my-tts-client";

export const myVoiceProvider: VoiceProvider = {
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

`myApi` is your own client for the speech service. The framework reads `abilities`, so `speakStream: true` gets the streaming path and `speak: true` alone gets whole sentences. On failure, throw `VoiceError` with a typed `kind`, and stop producing audio when `signal` aborts. To speak with one provider and transcribe with another, wrap them with `createCompositeVoiceProvider({ speak, transcribe })`. The [reference](../reference/voice.md) has the `VoiceProvider` fields.

## Next

- [Voice reference](../reference/voice.md): provider and flow settings, the `useVoice` return value, the transcription endpoint, errors and the audio content type.
